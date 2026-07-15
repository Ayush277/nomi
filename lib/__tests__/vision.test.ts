import { describe, expect, it } from 'vitest';
import { describeVision, hasVisionSignal, parseVisionResult } from '../vision';

describe('parseVisionResult — defensive by design', () => {
  it('parses a well-formed structured reply', () => {
    const raw = JSON.stringify({
      application: 'GitHub',
      visibleText: 'Reviewing changes in dashboard.ts',
      buttons: ['Merge pull request', 'Close'],
      errors: [],
      editor: null,
      repository: 'ayush/nomi',
      pullRequest: 'Add Phase D vision',
      pdfTitle: null,
      forms: [],
    });
    const v = parseVisionResult(raw, 1000);
    expect(v.application).toBe('GitHub');
    expect(v.repository).toBe('ayush/nomi');
    expect(v.pullRequest).toBe('Add Phase D vision');
    expect(v.buttons).toEqual(['Merge pull request', 'Close']);
    expect(v.capturedTs).toBe(1000);
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here is the JSON:\n```json\n{"application":"VS Code","errors":["TS2345: type error"]}\n```';
    const v = parseVisionResult(raw);
    expect(v.application).toBe('VS Code');
    expect(v.errors).toEqual(['TS2345: type error']);
  });

  it('never throws on garbage — yields an empty snapshot', () => {
    expect(hasVisionSignal(parseVisionResult(''))).toBe(false);
    expect(hasVisionSignal(parseVisionResult('not json at all'))).toBe(false);
    expect(hasVisionSignal(parseVisionResult('{ broken'))).toBe(false);
  });

  it('clamps oversized/wrong-typed fields', () => {
    const raw = JSON.stringify({
      application: 'x'.repeat(500),
      buttons: ['ok', 123, null, 'go'], // non-strings dropped
      forms: 'not-an-array',
    });
    const v = parseVisionResult(raw);
    expect(v.application!.length).toBeLessThanOrEqual(80);
    expect(v.buttons).toEqual(['ok', 'go']);
    expect(v.forms).toEqual([]);
  });
});

describe('describeVision', () => {
  it('renders the salient structured bits', () => {
    const line = describeVision(
      parseVisionResult(
        JSON.stringify({ application: 'GitHub', repository: 'ayush/nomi', errors: ['build failed'] }),
      ),
    )!;
    expect(line).toContain('GitHub');
    expect(line).toContain('ayush/nomi');
    expect(line).toContain('build failed');
  });

  it('returns null when there is no signal', () => {
    expect(describeVision(parseVisionResult('{}'))).toBeNull();
  });
});
