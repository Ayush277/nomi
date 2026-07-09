/** At-rest encryption (ADR-3): AES-GCM 256 via WebCrypto. The key lives in
 * chrome.storage.local — honest caveat documented in ARCHITECTURE.md: this
 * protects against casual inspection and disk scraping, not a determined
 * local attacker. Real key custody arrives with the desktop app (Phase 2). */

export interface SealedBlob {
  iv: string; // base64
  ct: string; // base64
}

function toB64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export class Vault {
  constructor(private key: CryptoKey) {}

  static async generate(): Promise<{ vault: Vault; jwk: JsonWebKey }> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', key);
    return { vault: new Vault(key), jwk };
  }

  static async fromJwk(jwk: JsonWebKey): Promise<Vault> {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    return new Vault(key);
  }

  async seal(obj: unknown): Promise<SealedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, plaintext);
    return { iv: toB64(iv.buffer), ct: toB64(ct) };
  }

  async open<T>(blob: SealedBlob): Promise<T> {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(blob.iv) },
      this.key,
      fromB64(blob.ct),
    );
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  }
}
