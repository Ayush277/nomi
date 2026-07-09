import { useEffect, useState } from 'react';
import { narrate } from '../../lib/narrative';
import { getSettings, saveSettings } from '../../lib/settings';
import { sessionsSince } from '../../lib/store';
import { todayRollup } from '../../lib/summary';
import { formatClock, formatDuration, startOfDay } from '../../lib/time';
import type { DayRollup, VisitSession } from '../../lib/types';

export function App() {
  const [rollup, setRollup] = useState<DayRollup | null>(null);
  const [recent, setRecent] = useState<VisitSession[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    todayRollup().then(setRollup);
    sessionsSince(startOfDay()).then((s) => setRecent(s.slice(-6).reverse()));
    getSettings().then((s) => setPaused(s.paused));
  }, []);

  const togglePause = async () => {
    const settings = await getSettings();
    const next = { ...settings, paused: !settings.paused };
    await saveSettings(next);
    setPaused(next.paused);
  };

  const story =
    rollup === null
      ? '…'
      : paused
        ? 'Taking a break — nothing is being remembered.'
        : rollup.totalMs < 60000
          ? "Just getting started today. Once we spend some time together, today's story shows up here."
          : narrate(rollup);

  return (
    <div className="app">
      <header>
        <div className="orb" aria-hidden="true">
          <span className="eye" />
          <span className="eye" />
        </div>
        <div>
          <h1>Nomi</h1>
          <p className="sub">
            {rollup && rollup.totalMs >= 60000 && !paused
              ? `${formatDuration(rollup.totalMs)} together today`
              : 'your quiet companion'}
          </p>
        </div>
        <button
          className="gear"
          title="Settings"
          aria-label="Settings"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>

      <p className="story">{story}</p>

      {!paused && rollup !== null && rollup.accepted.length > 0 && (
        <div className="wins">
          {rollup.accepted.map((a, i) => (
            <span key={i} className={`win win-${a.difficulty.toLowerCase()}`}>
              ✓ {a.slug.replace(/-/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {!paused && rollup !== null && rollup.topDomains.length > 0 && (
        <ul className="sites">
          {rollup.topDomains.slice(0, 5).map((d) => (
            <li key={d.domain}>
              <span className="domain">{d.domain}</span>
              <span className="meta">
                <span className={`cat cat-${d.category}`}>{d.category}</span>
                <span className="time">{formatDuration(d.totalMs)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!paused && recent.length > 0 && (
        <div className="timeline">
          <h2>Today's path</h2>
          {recent.map((s) => (
            <div className="tl-row" key={s.id}>
              <span className="tl-time">{formatClock(s.startTs)}</span>
              <span className="tl-domain">{s.domain}</span>
              <span className="tl-dur">{formatDuration(s.durationMs)}</span>
            </div>
          ))}
        </div>
      )}

      <footer>
        <button onClick={togglePause}>{paused ? 'Resume' : 'Pause Nomi'}</button>
        <span className="privacy">All of this stays on your device.</span>
      </footer>
    </div>
  );
}
