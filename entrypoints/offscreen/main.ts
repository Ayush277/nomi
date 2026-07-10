/** Offscreen voice capture: microphone + silence detection, nothing else.
 * The recorded clip goes to the background, which transcribes it via the
 * user's configured AI (Gemini). No model downloads, no WASM — tap, speak,
 * done. Mic is only open while actually listening. */

let stream: MediaStream | null = null;
let busy = false;

function report(status: string, extra: Record<string, unknown> = {}) {
  void chrome.runtime.sendMessage({ type: 'nomi:voiceStatus', status, ...extra }).catch(() => {});
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

/** Record one utterance: wait for voice (up to waitMs), stop after ~1.1s of
 * silence or maxMs. Returns the compressed audio blob, or null if silent. */
async function recordUtterance(maxMs = 10000, waitMs = 6000): Promise<Blob | null> {
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

    const speechStart = Date.now();
    let lastVoice = Date.now();
    while (Date.now() - speechStart < maxMs) {
      if (rms(analyser, buf) > SPEECH_RMS) lastVoice = Date.now();
      if (Date.now() - lastVoice > 1100) break;
      await sleep(80);
    }
    rec.stop();
    await stopped;
    return new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  } finally {
    void ac.close();
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function listenOnce(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    report('listening');
    const blob = await recordUtterance();
    if (!blob || blob.size < 1200) {
      report('idle');
      void chrome.runtime.sendMessage({ type: 'nomi:voiceText', text: '' }).catch(() => {});
      return;
    }
    report('transcribing');
    const b64 = toBase64(await blob.arrayBuffer());
    void chrome.runtime
      .sendMessage({ type: 'nomi:voiceAudio', b64, mime: blob.type.split(';')[0] || 'audio/webm' })
      .catch(() => {});
  } catch (err) {
    const e = err as Error;
    report(e?.name === 'NotAllowedError' ? 'denied' : 'error', {
      message: String(e?.message ?? e).slice(0, 160),
    });
  } finally {
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'nomi:offscreen:listenOnce') void listenOnce();
});

report('booted');
