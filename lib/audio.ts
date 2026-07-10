/** Wrap raw PCM16 (base64) from Gemini TTS into a playable WAV data URL.
 * Runs in the background service worker (has atob/btoa/DataView). */
export function pcmToWavDataUrl(b64: string, sampleRate = 24000): string {
  const bin = atob(b64);
  const len = bin.length;
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, len, true);
  for (let i = 0; i < len; i++) view.setUint8(44 + i, bin.charCodeAt(i));

  // ArrayBuffer → base64 in chunks (avoid call-stack limits).
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return 'data:audio/wav;base64,' + btoa(out);
}
