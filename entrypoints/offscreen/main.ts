/** Offscreen voice engine: microphone + local Whisper (transformers.js).
 * Audio NEVER leaves the machine — transcription happens right here in
 * WASM. The one network fetch is the model download itself (~40 MB, once,
 * from HuggingFace's CDN), after which it's cached locally. */

import { env, pipeline } from '@huggingface/transformers';

// Extension pages can never load remote scripts, so onnxruntime's WASM
// loader must come from inside the extension — bundled from public/ort/.
const onnxWasm = env.backends?.onnx?.wasm;
if (onnxWasm) {
  onnxWasm.wasmPaths = chrome.runtime.getURL('/ort/');
  // Offscreen documents aren't cross-origin isolated → no SharedArrayBuffer.
  onnxWasm.numThreads = 1;
}

type Asr = (audio: Float32Array) => Promise<{ text?: string }>;

let asr: Asr | null = null;
let asrLoading: Promise<Asr> | null = null;
let stream: MediaStream | null = null;
let wakeEnabled = false;
let wakeLoopRunning = false;
let busy = false;

function report(status: string, extra: Record<string, unknown> = {}) {
  void chrome.runtime.sendMessage({ type: 'nomi:voiceStatus', status, ...extra }).catch(() => {});
}

async function getAsr(): Promise<Asr> {
  if (asr) return asr;
  asrLoading ??= (async () => {
    report('loading');
    const progress_callback = (d: any) => {
      if (d?.status === 'progress' && d.total) {
        report('progress', { pct: Math.round((d.loaded / d.total) * 100) });
      }
    };
    // Quantized first (fast, ~40 MB); if this ort build rejects the export,
    // fall back to fp32 rather than failing the feature.
    const attempts = [
      { model: 'Xenova/whisper-tiny.en', dtype: 'q8' as const },
      { model: 'Xenova/whisper-tiny.en', dtype: 'fp32' as const },
    ];
    let lastErr: unknown;
    for (const a of attempts) {
      try {
        const p = await pipeline('automatic-speech-recognition', a.model, {
          dtype: a.dtype,
          progress_callback,
        });
        report('ready');
        return p as unknown as Asr;
      } catch (err) {
        lastErr = err;
      }
    }
    asrLoading = null; // allow a retry on the next attempt
    throw lastErr;
  })();
  asr = await asrLoading;
  return asr;
}

async function getStream(): Promise<MediaStream> {
  if (stream?.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  return stream;
}

function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

const SPEECH_RMS = 0.015;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Record one utterance: wait for voice (up to waitMs), then stop after
 * ~1.1s of silence or maxMs. Returns 16kHz mono samples for Whisper. */
async function recordUtterance(maxMs = 8000, waitMs = 5000): Promise<Float32Array | null> {
  const s = await getStream();
  const ac = new AudioContext();
  try {
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    ac.createMediaStreamSource(s).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const rec = new MediaRecorder(s);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.start();

    // Phase 1: wait for the user to start talking.
    let started = false;
    const waitStart = Date.now();
    while (Date.now() - waitStart < waitMs) {
      if (rms(analyser, buf) > SPEECH_RMS) {
        started = true;
        void chrome.runtime.sendMessage({ type: 'nomi:userSpeaking' }).catch(() => {});
        break;
      }
      await sleep(80);
    }
    if (!started) {
      rec.stop();
      await stopped;
      return null;
    }

    // Phase 2: record until ~1.1s of silence (or the cap).
    const speechStart = Date.now();
    let lastVoice = Date.now();
    while (Date.now() - speechStart < maxMs) {
      if (rms(analyser, buf) > SPEECH_RMS) lastVoice = Date.now();
      if (Date.now() - lastVoice > 1100) break;
      await sleep(80);
    }
    rec.stop();
    await stopped;

    const decoded = await ac.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000) || 1, 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally {
    void ac.close();
  }
}

async function transcribe(audio: Float32Array): Promise<string> {
  const model = await getAsr();
  const out = await model(audio);
  const text = (out.text ?? '').trim();
  // Whisper hallucinates fillers on silence — drop the classics.
  if (/^[\s.!?]*$|^(you|thank you\.?|thanks for watching\.?)$/i.test(text)) return '';
  return text;
}

async function listenOnce(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await getAsr();
    report('listening');
    const audio = await recordUtterance();
    if (!audio) {
      report('idle');
      return;
    }
    report('transcribing');
    const text = await transcribe(audio);
    report('idle');
    void chrome.runtime.sendMessage({ type: 'nomi:voiceText', text }).catch(() => {});
  } catch (err) {
    const e = err as Error;
    report(e?.name === 'NotAllowedError' ? 'denied' : 'error', {
      message: String(e?.message ?? e).slice(0, 160),
    });
  } finally {
    busy = false;
  }
}

const WAKE_RE = /\b(nomi|naomi|know me|gnome me|no me)\b/i;

async function wakeLoop(): Promise<void> {
  if (wakeLoopRunning) return;
  wakeLoopRunning = true;
  try {
    await getAsr();
    const s = await getStream();
    const ac = new AudioContext();
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    ac.createMediaStreamSource(s).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    report('wake-on');

    while (wakeEnabled) {
      if (rms(analyser, buf) <= SPEECH_RMS || busy) {
        await sleep(150);
        continue;
      }
      busy = true;
      try {
        const audio = await recordUtterance(6000, 1500);
        if (!audio) continue;
        const text = await transcribe(audio);
        const m = text.match(WAKE_RE);
        if (!m) continue;
        const command = text
          .slice(text.toLowerCase().indexOf(m[0].toLowerCase()) + m[0].length)
          .replace(/^[,.!?\s]+/, '')
          .trim();
        if (command.split(/\s+/).filter(Boolean).length >= 2) {
          void chrome.runtime.sendMessage({ type: 'nomi:voiceText', text: command }).catch(() => {});
        } else {
          void chrome.runtime.sendMessage({ type: 'nomi:wakeHeard' }).catch(() => {});
          busy = false;
          await listenOnce();
        }
      } finally {
        busy = false;
      }
    }
    void ac.close();
    report('wake-off');
  } catch (err) {
    const e = err as Error;
    report(e?.name === 'NotAllowedError' ? 'denied' : 'error', {
      message: String(e?.message ?? e).slice(0, 160),
    });
  } finally {
    wakeLoopRunning = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case 'nomi:offscreen:listenOnce':
      void listenOnce();
      break;
    case 'nomi:offscreen:wake':
      wakeEnabled = Boolean(msg.enabled);
      if (wakeEnabled) void wakeLoop();
      break;
  }
});

report('booted');
