import { describe, expect, it } from 'vitest';
import { Vault } from '../crypto';

describe('Vault (AES-GCM at rest)', () => {
  it('round-trips arbitrary objects', async () => {
    const { vault } = await Vault.generate();
    const original = { domain: 'leetcode.com', path: '/problems/two-sum', n: 42 };
    const sealed = await vault.seal(original);
    expect(sealed.ct).not.toContain('leetcode');
    expect(await vault.open(sealed)).toEqual(original);
  });

  it('ciphertext differs per call (fresh IV every time)', async () => {
    const { vault } = await Vault.generate();
    const a = await vault.seal({ x: 1 });
    const b = await vault.seal({ x: 1 });
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it('a different key cannot open the blob', async () => {
    const { vault } = await Vault.generate();
    const { vault: other } = await Vault.generate();
    const sealed = await vault.seal({ secret: true });
    await expect(other.open(sealed)).rejects.toThrow();
  });

  it('survives jwk export/import (the storage path)', async () => {
    const { vault, jwk } = await Vault.generate();
    const sealed = await vault.seal({ hello: 'again' });
    const restored = await Vault.fromJwk(jwk);
    expect(await restored.open(sealed)).toEqual({ hello: 'again' });
  });
});
