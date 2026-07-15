import { describe, expect, it } from 'vitest';
import {
  dayDigest,
  EMPTY_AUTODOC,
  renderAutodoc,
  withChange,
  withDay,
  withTold,
} from '../autodoc';
import { describeLearnedChanges, EMPTY_LEARNED } from '../learning';
import type { LearnedProfile } from '../types';

const TS = new Date('2026-07-14T10:00:00').getTime();

describe('autodoc reducers', () => {
  it('withTold appends, trims, and caps at 200', () => {
    let s = withTold(EMPTY_AUTODOC, '  applied to   a job  ', TS);
    expect(s.told).toEqual([{ ts: TS, text: 'applied to a job' }]);
    for (let i = 0; i < 250; i++) s = withTold(s, `entry ${i}`, TS + i);
    expect(s.told).toHaveLength(200);
    expect(s.told[199].text).toBe('entry 249');
  });

  it('withTold ignores empty text', () => {
    expect(withTold(EMPTY_AUTODOC, '   ', TS)).toBe(EMPTY_AUTODOC);
  });

  it('withDay replaces the same date instead of duplicating', () => {
    let s = withDay(EMPTY_AUTODOC, '2026-07-13', 'first version');
    s = withDay(s, '2026-07-13', 'second version');
    expect(s.days).toHaveLength(1);
    expect(s.days[0].digest).toBe('second version');
  });

  it('withDay keeps days sorted by date', () => {
    let s = withDay(EMPTY_AUTODOC, '2026-07-13', 'yesterday');
    s = withDay(s, '2026-07-11', 'earlier');
    expect(s.days.map((d) => d.date)).toEqual(['2026-07-11', '2026-07-13']);
  });

  it('withChange skips a back-to-back duplicate observation', () => {
    let s = withChange(EMPTY_AUTODOC, 'more Python lately', TS);
    s = withChange(s, 'more Python lately', TS + 1);
    expect(s.changes).toHaveLength(1);
  });
});

describe('renderAutodoc', () => {
  it('renders every section heading in order', () => {
    const md = renderAutodoc(EMPTY_AUTODOC);
    const order = [
      '# About you — kept by Nomi',
      '## Profile',
      '## How you work',
      '## How you are changing',
      '## Things you told me',
      '## Daily log',
    ];
    let last = -1;
    for (const h of order) {
      const at = md.indexOf(h);
      expect(at, h).toBeGreaterThan(last);
      last = at;
    }
  });

  it('renders told entries and daily digests newest first, with dates', () => {
    let s = withTold(EMPTY_AUTODOC, 'old thing', new Date('2026-07-10T09:00:00').getTime());
    s = withTold(s, 'new thing', TS);
    s = withDay(s, '2026-07-12', 'quiet day');
    s = withDay(s, '2026-07-13', 'busy day');
    const md = renderAutodoc(s);
    expect(md.indexOf('new thing')).toBeLessThan(md.indexOf('old thing'));
    expect(md).toContain('- 2026-07-14: new thing');
    expect(md.indexOf('### 2026-07-13')).toBeLessThan(md.indexOf('### 2026-07-12'));
  });

  it('uses the profile and learned lines when present', () => {
    const md = renderAutodoc({
      ...EMPTY_AUTODOC,
      profileLine: 'Name: Ayush.',
      learnedLine: 'most active around 10pm',
    });
    expect(md).toContain('Name: Ayush.');
    expect(md).toContain('most active around 10pm');
  });
});

describe('dayDigest', () => {
  it('summarises time, top sites, categories, and journal honestly', () => {
    const digest = dayDigest(
      {
        totalMs: 2 * 3600000 + 15 * 60000,
        topDomains: [
          { domain: 'leetcode.com', totalMs: 50 * 60000 },
          { domain: 'github.com', totalMs: 30 * 60000 },
        ],
        byCategory: { coding: 80 * 60000, social: 10 * 60000 },
        tabSwitches: 42,
      },
      ['applied to a job'],
    );
    expect(digest).toContain('Online 2h 15m.');
    expect(digest).toContain('leetcode.com (50m)');
    expect(digest).toContain('coding 80m');
    expect(digest).toContain('42 tab switches');
    expect(digest).toContain('applied to a job');
  });

  it('omits what the data does not support', () => {
    const digest = dayDigest({ totalMs: 9 * 60000, topDomains: [], byCategory: {}, tabSwitches: 0 });
    expect(digest).toBe('Online 9m.');
  });
});

describe('describeLearnedChanges', () => {
  const base: LearnedProfile = {
    ...EMPTY_LEARNED,
    daysObserved: 6,
    peakHours: [10, 21],
    favoriteTech: 'Python',
    mostActiveProject: 'portfolio',
    frequentSites: ['github.com', 'leetcode.com'],
    typicalDistractions: ['youtube.com'],
  };

  it('stays silent until both snapshots are confident', () => {
    expect(describeLearnedChanges(EMPTY_LEARNED, base)).toBeNull();
  });

  it('stays silent when nothing moved', () => {
    expect(describeLearnedChanges(base, { ...base })).toBeNull();
  });

  it('names hour, tech, project, and distraction shifts', () => {
    const curr: LearnedProfile = {
      ...base,
      peakHours: [22, 23],
      favoriteTech: 'React',
      mostActiveProject: 'hackathon',
      typicalDistractions: ['x.com'],
    };
    const text = describeLearnedChanges(base, curr)!;
    expect(text).toContain('active hours shifted');
    expect(text).toContain('from Python to React');
    expect(text).toContain('from "portfolio" to "hackathon"');
    expect(text).toContain('x.com became a regular distraction');
    expect(text).toContain('youtube.com less than before');
  });
});
