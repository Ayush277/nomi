import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { describeSnapshot, extractVisibleText } from '../screen';

function docFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('extractVisibleText', () => {
  it('pulls headings and prose, marking headings with ##', () => {
    const doc = docFrom(`
      <main>
        <h1>Two Sum</h1>
        <p>Given an array of integers, return indices of the two numbers.</p>
        <li>Example: nums = [2,7,11,15]</li>
      </main>`);
    const snap = extractVisibleText(doc);
    expect(snap.heading).toBe('Two Sum');
    expect(snap.text).toMatch(/## Two Sum/);
    expect(snap.text).toMatch(/two numbers/);
    expect(snap.text).toMatch(/nums = \[2,7,11,15\]/);
  });

  it('never reads input, textarea, or password values', () => {
    const doc = docFrom(`
      <main>
        <p>Log in below</p>
        <input value="SECRETPASSWORD" />
        <textarea>my private draft</textarea>
      </main>`);
    const snap = extractVisibleText(doc);
    expect(snap.text).toMatch(/Log in below/);
    expect(snap.text).not.toMatch(/SECRETPASSWORD/);
    expect(snap.text).not.toMatch(/private draft/);
  });

  it('skips nav, footer, and script noise', () => {
    const doc = docFrom(`
      <body>
        <nav><a>Home</a><a>About</a></nav>
        <article><p>The real content is here.</p></article>
        <footer>copyright junk</footer>
        <script>console.log('nope')</script>
      </body>`);
    const snap = extractVisibleText(doc);
    expect(snap.text).toMatch(/real content is here/);
    expect(snap.text).not.toMatch(/copyright junk/);
    expect(snap.text).not.toMatch(/nope/);
  });

  it('caps length', () => {
    const doc = docFrom(`<main>${'<p>word word word</p>'.repeat(500)}</main>`);
    expect(extractVisibleText(doc, 500).text.length).toBeLessThanOrEqual(500);
  });
});

describe('describeSnapshot', () => {
  it('prefers heading, falls back to domain', () => {
    expect(describeSnapshot('leetcode.com', { title: 't', heading: 'Two Sum', text: '' })).toBe(
      'leetcode.com — "Two Sum"',
    );
    expect(describeSnapshot('example.com', { title: '', heading: '', text: '' })).toBe('example.com');
  });
});
