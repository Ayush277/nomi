import { useEffect, useMemo, useRef, useState } from 'react';
import { disconnect, syncGitHub, syncLeetCode } from '../../lib/connect';
import { loadDashboard, type DashboardData } from '../../lib/dashboard';
import { addDoc, getDocs, removeDoc, type NomiDoc } from '../../lib/docs';
import { narrate } from '../../lib/narrative';
import { formatClock, formatDuration } from '../../lib/time';
import type { SiteCategory } from '../../lib/types';
import { extractText } from './extract';

/** Category hues — fixed order, never cycled (dataviz rule). Labelled
 * everywhere they appear, so identity is never color-alone. */
const CAT_COLOR: Record<SiteCategory, string> = {
  coding: '#14b8a6',
  learning: '#8b7ae8',
  social: '#e0872a',
  entertainment: '#e5556e',
  shopping: '#2f9e6b',
  career: '#3b82c4',
  music: '#c9509e',
  other: '#8792a3',
};

const weekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short' });

/** Compact duration for stat tiles — "0m" / "45m" / "5h 40m", never a phrase. */
const compact = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return '0m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [query, setQuery] = useState('');
  const [lcUser, setLcUser] = useState('');
  const [ghUser, setGhUser] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [docs, setDocs] = useState<NomiDoc[]>([]);
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => loadDashboard().then(setData);
  useEffect(() => {
    reload();
    getDocs().then(setDocs);
  }, []);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setDocBusy(true);
    setDocErr(null);
    try {
      for (const file of Array.from(files)) {
        const { kind, text } = await extractText(file);
        if (text.trim().length < 5) throw new Error(`Couldn't read text from "${file.name}"`);
        await addDoc(file.name, kind, text);
      }
      setDocs(await getDocs());
    } catch (e) {
      setDocErr((e as Error).message);
    } finally {
      setDocBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const forgetDoc = async (id: string) => {
    await removeDoc(id);
    setDocs(await getDocs());
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!data) return null;
    if (!q) return data;
    const has = (s: string) => s.toLowerCase().includes(q);
    return {
      ...data,
      timeline: data.timeline.filter((t) => has(t.label) || has(t.meta ?? '')),
      solved: data.solved.filter((s) => has(s.slug) || has(s.difficulty)),
      videos: data.videos.filter((v) => has(v.title)),
      links: data.links.filter((l) => has(l.title) || has(l.domain)),
    };
  }, [data, q]);

  if (!data || !filtered) {
    return (
      <div className="loading">
        <div className="orb-lg" />
        <p>Gathering your day…</p>
      </div>
    );
  }

  const maxWeek = Math.max(...data.week.map((d) => d.totalMs), 1);
  const focusMs = (data.today.byCategory.coding ?? 0) + (data.today.byCategory.learning ?? 0);
  const catRows = (Object.entries(data.today.byCategory) as [SiteCategory, number][]).sort(
    (a, b) => b[1] - a[1],
  );

  const doSync = async (which: 'leetcode' | 'github', user: string) => {
    if (!user.trim()) return;
    setSyncing(which);
    setSyncErr(null);
    try {
      if (which === 'leetcode') await syncLeetCode(user.trim());
      else await syncGitHub(user.trim());
      await reload();
    } catch (e) {
      setSyncErr(`${which}: ${(e as Error).message}`);
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="who">
          <div className="orb-lg" aria-hidden="true">
            <span className="eye" />
            <span className="eye" />
          </div>
          <div>
            <h1>{data.profile.name ? `${data.profile.name}'s second brain` : 'Your second brain'}</h1>
            <p>{data.today.totalMs > 60000 ? narrate(data.today) : "Today's just getting started."}</p>
          </div>
        </div>
        <input
          className="search"
          placeholder="Search your memory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search memory"
        />
      </header>

      <section className="tiles">
        <Tile label="Together today" value={compact(data.today.totalMs)} accent="#8b7ae8" />
        <Tile label="Focused" value={compact(focusMs)} accent="#14b8a6" />
        <Tile label="Problems solved" value={String(data.today.accepted.length)} accent="#e0872a" sub="today" />
        <Tile label="Day streak" value={data.streak ? `${data.streak}` : '—'} accent="#e5556e" sub="active days" />
      </section>

      <section className="space">
        <div className="space-head">
          <div>
            <span className="label">Nomi Space</span>
            <h2>Your documents — Nomi answers from these first</h2>
            <p>
              Upload your resume, notes, meeting docs — anything. Ask Nomi about them in chat and it
              reads your own material before reaching for general knowledge. All kept on this device.
            </p>
          </div>
          <div className="space-actions">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.rtf,text/*"
              style={{ display: 'none' }}
              onChange={(e) => onUpload(e.target.files)}
            />
            <button className="upload" onClick={() => fileRef.current?.click()} disabled={docBusy}>
              {docBusy ? 'Reading…' : '+ Upload documents'}
            </button>
          </div>
        </div>
        {docErr && <p className="sync-err">{docErr}</p>}
        {docs.length === 0 ? (
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onUpload(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
          >
            Drop a PDF or text file here, or click to choose. Resume, notes, anything you want Nomi
            to know.
          </div>
        ) : (
          <ul className="docs">
            {docs.map((d) => (
              <li key={d.id}>
                <span className="doc-ic">{d.kind === 'pdf' ? '📄' : '📝'}</span>
                <span className="doc-name">{d.name}</span>
                <span className="doc-meta">{(d.chars / 1000).toFixed(1)}k chars</span>
                <button onClick={() => forgetDoc(d.id)} aria-label="Remove">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="cols">
        <div className="col">
          <Card title="This week">
            <div className="week" role="img" aria-label="Active time per day this week">
              {data.week.map((d) => (
                <div className="wbar" key={d.date} title={`${weekday(d.date)}: ${formatDuration(d.totalMs)}`}>
                  <div className="wbar-track">
                    <div
                      className="wbar-fill"
                      style={{ height: `${Math.max((d.totalMs / maxWeek) * 100, d.totalMs > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <span className="wbar-lbl">{weekday(d.date)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Today by category">
            {catRows.length === 0 ? (
              <p className="empty">No activity yet today.</p>
            ) : (
              <>
                <div className="catbar" role="img" aria-label="Time split by category today">
                  {catRows.map(([cat, ms]) => (
                    <div
                      key={cat}
                      className="catseg"
                      style={{ flexGrow: ms, background: CAT_COLOR[cat] }}
                      title={`${cat}: ${formatDuration(ms)}`}
                    />
                  ))}
                </div>
                <ul className="catlegend">
                  {catRows.map(([cat, ms]) => (
                    <li key={cat}>
                      <span className="dot" style={{ background: CAT_COLOR[cat] }} />
                      <span className="cl-name">{cat}</span>
                      <span className="cl-val">{formatDuration(ms)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Connected accounts" sub="public data, synced on-device">
            <Connect
              name="LeetCode"
              placeholder="leetcode username"
              user={lcUser}
              setUser={setLcUser}
              busy={syncing === 'leetcode'}
              onSync={() => doSync('leetcode', lcUser)}
              onRemove={data.connections.leetcode ? () => disconnect('leetcode').then(reload) : undefined}
            >
              {data.connections.leetcode && (
                <div className="stat-row">
                  <b>{data.connections.leetcode.total}</b> solved ·{' '}
                  <span className="lc easy">{data.connections.leetcode.easy} E</span>{' '}
                  <span className="lc med">{data.connections.leetcode.medium} M</span>{' '}
                  <span className="lc hard">{data.connections.leetcode.hard} H</span>
                </div>
              )}
            </Connect>
            <Connect
              name="GitHub"
              placeholder="github username"
              user={ghUser}
              setUser={setGhUser}
              busy={syncing === 'github'}
              onSync={() => doSync('github', ghUser)}
              onRemove={data.connections.github ? () => disconnect('github').then(reload) : undefined}
            >
              {data.connections.github && (
                <div className="stat-row">
                  <b>{data.connections.github.repos}</b> repos ·{' '}
                  <b>{data.connections.github.recentCommits}</b> recent commits ·{' '}
                  {data.connections.github.followers} followers
                </div>
              )}
            </Connect>
            {syncErr && <p className="sync-err">{syncErr}</p>}
          </Card>
        </div>

        <div className="col">
          <Card title="Today's timeline">
            {filtered.timeline.length === 0 ? (
              <p className="empty">{q ? 'No matches.' : 'Nothing yet today.'}</p>
            ) : (
              <ol className="timeline">
                {filtered.timeline.slice(0, 40).map((t, i) => (
                  <li key={i} className={`tl tl-${t.kind}`}>
                    <span className="tl-time">{formatClock(t.ts)}</span>
                    <span className="tl-dot" />
                    <span className="tl-body">
                      <span className="tl-label">
                        {t.kind === 'solved' ? '✓ ' : t.kind === 'video' ? '▶ ' : ''}
                        {t.label}
                      </span>
                      {t.meta && <span className="tl-meta">{t.meta}</span>}
                      {t.durationMs && <span className="tl-meta">{formatDuration(t.durationMs)}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Memory" sub="what Nomi is holding for you">
            {data.profile.facts.length > 0 && (
              <div className="mem-block">
                <h4>About you</h4>
                <ul className="chips">
                  {data.profile.facts.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {filtered.solved.length > 0 && (
              <div className="mem-block">
                <h4>Solved ({filtered.solved.length})</h4>
                <ul className="mem-list">
                  {filtered.solved.slice(0, 12).map((s, i) => (
                    <li key={i}>
                      <span>✓ {s.slug.replace(/-/g, ' ')}</span>
                      <span className={`badge ${s.difficulty.toLowerCase()}`}>{s.difficulty}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {filtered.videos.length > 0 && (
              <div className="mem-block">
                <h4>Watched ({filtered.videos.length})</h4>
                <ul className="mem-list">
                  {filtered.videos.slice(0, 8).map((v, i) => (
                    <li key={i}>
                      <span>▶ {v.title}</span>
                      <span className="ago">{new Date(v.ts).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {filtered.links.length > 0 && (
              <div className="mem-block">
                <h4>Saved links ({filtered.links.length})</h4>
                <ul className="mem-list">
                  {filtered.links.slice(0, 12).map((l) => (
                    <li key={l.id}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        🔖 {l.title}
                      </a>
                      <span className="ago">{l.domain}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.profile.facts.length === 0 &&
              filtered.solved.length === 0 &&
              filtered.videos.length === 0 &&
              filtered.links.length === 0 && (
                <p className="empty">
                  {q ? 'No matches.' : 'Your memory fills as you work — solved problems, videos, saved links, and anything you ask Nomi to remember.'}
                </p>
              )}
          </Card>
        </div>
      </div>

      <footer className="dash-foot">
        Everything here lives only on this device · Nomi v{chrome.runtime.getManifest?.().version ?? ''}
      </footer>
    </div>
  );
}

function Tile({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <b className="tile-value" style={{ color: accent }}>
        {value}
      </b>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Connect(props: {
  name: string;
  placeholder: string;
  user: string;
  setUser: (v: string) => void;
  busy: boolean;
  onSync: () => void;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="connect">
      <div className="connect-top">
        <strong>{props.name}</strong>
        {props.onRemove && (
          <button className="unlink" onClick={props.onRemove}>
            disconnect
          </button>
        )}
      </div>
      {props.children}
      <div className="connect-row">
        <input
          placeholder={props.placeholder}
          value={props.user}
          onChange={(e) => props.setUser(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onSync()}
        />
        <button onClick={props.onSync} disabled={props.busy}>
          {props.busy ? 'Syncing…' : 'Sync'}
        </button>
      </div>
    </div>
  );
}
