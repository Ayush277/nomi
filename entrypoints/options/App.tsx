import { useEffect, useState } from 'react';
import { geminiAvailable } from '../../lib/gemini';
import { ollamaAvailable } from '../../lib/ollama';
import { PERSONALITIES } from '../../lib/persona';
import {
  DEFAULT_PROFILE,
  getProfile,
  removeFact,
  saveProfile,
  type NomiProfile,
  type PersonalityId,
} from '../../lib/profile';
import { getSettings, saveSettings } from '../../lib/settings';
import { exportAll, wipeAll } from '../../lib/store';
import { DEFAULT_SETTINGS, type NomiSettings } from '../../lib/types';

/* Phone-style settings: grouped lists of rows — icon chip, label, control on
 * the right; rows with more inside open like a drawer. Same behaviour as the
 * old page, arranged like a settings app. */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sgroup">
      <h2>{title}</h2>
      <div className="slist">{children}</div>
    </section>
  );
}

function Row(props: {
  icon: string;
  tint: string;
  label: string;
  sub?: string;
  children?: React.ReactNode; // the right-side control
}) {
  return (
    <div className="srow">
      <span className="sicon" style={{ background: props.tint }} aria-hidden="true">
        {props.icon}
      </span>
      <span className="stext">
        <strong>{props.label}</strong>
        {props.sub && <em>{props.sub}</em>}
      </span>
      <span className="sctrl">{props.children}</span>
    </div>
  );
}

function Drawer(props: {
  icon: string;
  tint: string;
  label: string;
  sub?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="sdrawer">
      <summary className="srow">
        <span className="sicon" style={{ background: props.tint }} aria-hidden="true">
          {props.icon}
        </span>
        <span className="stext">
          <strong>{props.label}</strong>
          {props.sub && <em>{props.sub}</em>}
        </span>
        <span className="sctrl">
          {props.badge && <span className="sbadge">{props.badge}</span>}
          <span className="chev">›</span>
        </span>
      </summary>
      <div className="sdetail">{props.children}</div>
    </details>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

export function App() {
  const [settings, setSettings] = useState<NomiSettings>(DEFAULT_SETTINGS);
  const [exclusionsText, setExclusionsText] = useState('');
  const [llmStatus, setLlmStatus] = useState<'unknown' | 'checking' | 'ok' | 'missing'>('unknown');
  const [gemStatus, setGemStatus] = useState<'unknown' | 'checking' | 'ok' | 'missing'>('unknown');
  const [wipeArmed, setWipeArmed] = useState(false);
  const [micStatus, setMicStatus] = useState<'unknown' | 'granted' | 'denied' | 'nodevice'>(
    'unknown',
  );

  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((p) => setMicStatus(p.state === 'granted' ? 'granted' : 'unknown'))
      .catch(() => {});
  }, []);

  const enableMic = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMicStatus('granted');
    } catch (err) {
      setMicStatus((err as Error)?.name === 'NotFoundError' ? 'nodevice' : 'denied');
    }
  };

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setExclusionsText(s.exclusions.join('\n'));
    });
  }, []);

  const update = (patch: Partial<NomiSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  };

  const saveExclusions = (text: string) => {
    setExclusionsText(text);
    update({
      exclusions: text
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    });
  };

  const testOllama = async () => {
    setLlmStatus('checking');
    setLlmStatus((await ollamaAvailable()) ? 'ok' : 'missing');
  };

  const testGemini = async () => {
    setGemStatus('checking');
    setGemStatus(
      (await geminiAvailable(settings.gemini.apiKey.trim(), settings.gemini.model))
        ? 'ok'
        : 'missing',
    );
  };

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nomi-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doWipe = async () => {
    if (!wipeArmed) {
      setWipeArmed(true);
      setTimeout(() => setWipeArmed(false), 4000);
      return;
    }
    await wipeAll();
    setWipeArmed(false);
  };

  const [profile, setProfile] = useState<NomiProfile>(DEFAULT_PROFILE);
  useEffect(() => {
    getProfile().then(setProfile);
  }, []);
  const updateProfile = (patch: Partial<NomiProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      void saveProfile(next);
      return next;
    });
  };
  const forgetFact = async (id: string) => {
    await removeFact(id);
    setProfile(await getProfile());
  };

  const quiet = settings.quietHours;

  return (
    <div className="page phone">
      <header>
        <div className="orb" aria-hidden="true">
          <span className="eye" />
          <span className="eye" />
        </div>
        <div>
          <h1>Settings</h1>
          <p>Everything here — and everything Nomi remembers — lives only on this device.</p>
        </div>
      </header>

      <Group title="You & Nomi">
        <Row icon="👤" tint="#8b5cf6" label="Your name" sub="so Nomi talks to you like a person">
          <input
            type="text"
            placeholder="what should I call you?"
            value={profile.name}
            onChange={(e) => updateProfile({ name: e.target.value.slice(0, 24) })}
          />
        </Row>
        <Row icon="🎯" tint="#3b82f6" label="Your goal" sub="Nomi keeps it in mind">
          <input
            type="text"
            placeholder="e.g. cracking FAANG interviews"
            value={profile.goal}
            onChange={(e) => updateProfile({ goal: e.target.value.slice(0, 120) })}
          />
        </Row>
        <Drawer
          icon="🎭"
          tint="#d946ef"
          label="Personality"
          sub="same companion, different tone"
          badge={PERSONALITIES[profile.personality]?.label ?? 'Friend'}
        >
          <div className="persona-grid">
            {(Object.keys(PERSONALITIES) as PersonalityId[]).map((id) => (
              <button
                key={id}
                className={`persona${profile.personality === id ? ' on' : ''}`}
                onClick={() => updateProfile({ personality: id })}
              >
                <strong>{PERSONALITIES[id].label}</strong>
                <span>{PERSONALITIES[id].blurb}</span>
              </button>
            ))}
          </div>
        </Drawer>
        <Drawer
          icon="🧠"
          tint="#14b8a6"
          label="What Nomi remembers"
          sub='say "remember …" in chat to add'
          badge={String(profile.facts.length)}
        >
          {profile.facts.length === 0 ? (
            <p className="hint">Nothing saved yet. In chat, try "remember I'm preparing for interviews".</p>
          ) : (
            <ul className="facts">
              {profile.facts.map((f) => (
                <li key={f.id}>
                  <span>{f.text}</span>
                  <button onClick={() => forgetFact(f.id)} aria-label="Forget this">
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Drawer>
      </Group>

      <Group title="Presence">
        <Row icon="⏸️" tint="#64748b" label="Pause Nomi" sub="nothing is remembered while paused">
          <Toggle on={settings.paused} onChange={(v) => update({ paused: v })} />
        </Row>
        <Row icon="👁️" tint="#0ea5e9" label="Always visible" sub="don't tuck small at the edge when idle">
          <Toggle on={settings.alwaysVisible} onChange={(v) => update({ alwaysVisible: v })} />
        </Row>
        <Row icon="📐" tint="#f59e0b" label="Companion size">
          <select
            value={settings.widgetScale}
            onChange={(e) => update({ widgetScale: Number(e.target.value) })}
          >
            <option value={0.75}>Small</option>
            <option value={1}>Medium</option>
            <option value={1.35}>Large</option>
            <option value={1.7}>Extra large</option>
          </select>
        </Row>
        <Row icon="🎨" tint="#8b5cf6" label="Orb colour">
          <select
            value={settings.orbTheme}
            onChange={(e) => update({ orbTheme: e.target.value as typeof settings.orbTheme })}
          >
            <option value="aurora">Aurora (coral · violet)</option>
            <option value="ember">Ember (warm red)</option>
            <option value="ocean">Ocean (blue · cyan)</option>
            <option value="forest">Forest (green)</option>
            <option value="mono">Mono (silver)</option>
          </select>
        </Row>
      </Group>

      <Group title="Speaking up">
        <Row icon="💬" tint="#22c55e" label="How chatty?" sub="most Nomi will say in a day">
          <select
            value={settings.maxNudgesPerDay}
            onChange={(e) => update({ maxNudgesPerDay: Number(e.target.value) })}
          >
            <option value={3}>Quiet (3/day)</option>
            <option value={6}>Normal (6/day)</option>
            <option value={10}>Chatty (10/day)</option>
          </select>
        </Row>
        <Row icon="🔊" tint="#f97316" label="Speak out loud" sub="only when you ask it something">
          <Toggle on={settings.voice} onChange={(v) => update({ voice: v })} />
        </Row>
        <Row icon="🌏" tint="#eab308" label="Language">
          <select
            value={settings.language}
            onChange={(e) => update({ language: e.target.value as 'en' | 'hinglish' })}
          >
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
          </select>
        </Row>
        <Row
          icon="✨"
          tint="#a855f7"
          label="Proactive companion"
          sub="speaks up on its own about the page you're on"
        >
          <Toggle on={settings.proactive} onChange={(v) => update({ proactive: v })} />
        </Row>
        <Drawer
          icon="🌙"
          tint="#475569"
          label="Quiet hours"
          sub="Nomi stays silent during these hours"
          badge={quiet ? `${quiet.startHour}:00–${quiet.endHour}:00` : 'Off'}
        >
          <div className="drawer-row">
            <span>Enabled</span>
            <Toggle
              on={quiet !== null}
              onChange={(v) => update({ quietHours: v ? { startHour: 22, endHour: 8 } : null })}
            />
          </div>
          {quiet && (
            <div className="drawer-row">
              <span>From</span>
              <select
                value={quiet.startHour}
                onChange={(e) => update({ quietHours: { ...quiet, startHour: Number(e.target.value) } })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
              <span>to</span>
              <select
                value={quiet.endHour}
                onChange={(e) => update({ quietHours: { ...quiet, endHour: Number(e.target.value) } })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
            </div>
          )}
        </Drawer>
        <Drawer
          icon="👓"
          tint="#06b6d4"
          label="Vision understanding"
          sub="reads a snapshot of the tab; image discarded immediately"
          badge={settings.vision ? 'On' : 'Off'}
        >
          <div className="drawer-row">
            <span>Enabled (needs a Gemini key; skips sensitive & incognito pages)</span>
            <Toggle on={settings.vision} onChange={(v) => update({ vision: v })} />
          </div>
          {settings.vision && (
            <div className="drawer-row">
              <span>Snapshot every</span>
              <select
                value={settings.visionIntervalSec}
                onChange={(e) => update({ visionIntervalSec: Number(e.target.value) })}
              >
                <option value={60}>minute</option>
                <option value={180}>3 minutes</option>
                <option value={300}>5 minutes</option>
                <option value={600}>10 minutes</option>
              </select>
            </div>
          )}
        </Drawer>
      </Group>

      <Group title="Voice & microphone">
        <Row
          icon="🎙️"
          tint="#ef4444"
          label="Microphone"
          sub="grant once; the mic button and double-tap use it"
        >
          <button className="pill" onClick={enableMic}>
            {micStatus === 'granted' ? 'Enabled ✓' : 'Enable'}
          </button>
        </Row>
        {micStatus === 'denied' && (
          <p className="hint warn">
            <strong>Blocked.</strong> macOS System Settings → Privacy &amp; Security → Microphone —
            turn on your browser; then click the 🔒 icon in the address bar of this page and set
            Microphone to Allow, and try again.
          </p>
        )}
        {micStatus === 'nodevice' && (
          <p className="hint warn">No microphone found — check one is connected and allowed in macOS.</p>
        )}
        <Drawer icon="🗣️" tint="#f43f5e" label="Natural voice" sub="one-time free download for a much better voice">
          <p className="hint">
            <strong>System Settings → Accessibility → Spoken Content → System Voice → Manage
            Voices</strong>, download <strong>Ava, Zoe, or Samantha (Enhanced/Premium)</strong>.
            Nomi picks the best one automatically. Speech itself never leaves the device; the mic
            clip goes to Gemini only for transcription.
          </p>
        </Drawer>
      </Group>

      <Group title="AI brains">
        <Drawer
          icon="☁️"
          tint="#3b82f6"
          label="Gemini (cloud)"
          sub="chat, voice transcription, vision"
          badge={settings.gemini.enabled && settings.gemini.apiKey.trim() ? 'On' : 'Off'}
        >
          <p className="hint">
            Paste a free key from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            . <strong>Honest note:</strong> with this on, your chat messages (and a one-line today
            summary) go to Google — the only thing that ever leaves this device.
          </p>
          <div className="drawer-row">
            <span>Chat with Gemini</span>
            <Toggle
              on={settings.gemini.enabled}
              onChange={(v) => update({ gemini: { ...settings.gemini, enabled: v } })}
            />
          </div>
          <div className="drawer-row">
            <span>API key</span>
            <input
              type="password"
              placeholder="AIza…"
              value={settings.gemini.apiKey}
              onChange={(e) => update({ gemini: { ...settings.gemini, apiKey: e.target.value } })}
            />
            <button className="pill" onClick={testGemini} disabled={!settings.gemini.apiKey.trim()}>
              {gemStatus === 'checking' ? '…' : 'Test'}
            </button>
            {gemStatus === 'ok' && <span className="ok">✓</span>}
            {gemStatus === 'missing' && <span className="bad">✗</span>}
          </div>
          <div className="drawer-row">
            <span>Model</span>
            <input
              type="text"
              value={settings.gemini.model}
              onChange={(e) => update({ gemini: { ...settings.gemini, model: e.target.value } })}
            />
          </div>
        </Drawer>
        <Drawer
          icon="💻"
          tint="#10b981"
          label="Ollama (local)"
          sub="100% on your machine"
          badge={settings.ollama.enabled ? 'On' : 'Off'}
        >
          <p className="hint">
            With <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> installed:{' '}
            <code>ollama pull {settings.ollama.model}</code>, then allow this extension with{' '}
            <code>OLLAMA_ORIGINS=chrome-extension://{chrome.runtime.id}</code>. Also{' '}
            <code>ollama pull nomic-embed-text</code> for local semantic search.
          </p>
          <div className="drawer-row">
            <span>Use for chat</span>
            <Toggle
              on={settings.ollama.enabled}
              onChange={(v) => update({ ollama: { ...settings.ollama, enabled: v } })}
            />
          </div>
          <div className="drawer-row">
            <span>Model</span>
            <input
              type="text"
              value={settings.ollama.model}
              onChange={(e) => update({ ollama: { ...settings.ollama, model: e.target.value } })}
            />
            <button className="pill" onClick={testOllama}>
              {llmStatus === 'checking' ? '…' : 'Test'}
            </button>
            {llmStatus === 'ok' && <span className="ok">✓</span>}
            {llmStatus === 'missing' && <span className="bad">✗</span>}
          </div>
        </Drawer>
        <Row
          icon="🆓"
          tint="#84cc16"
          label="Free fallback chat"
          sub="pollinations.ai when Gemini/Ollama can't answer"
        >
          <Toggle on={settings.freeChat} onChange={(v) => update({ freeChat: v })} />
        </Row>
      </Group>

      <Group title="Privacy & data">
        <Drawer
          icon="🚫"
          tint="#dc2626"
          label="Excluded sites"
          sub="Nomi never notices these; banking, health & mail are built-in"
          badge={String(settings.exclusions.length)}
        >
          <textarea
            rows={4}
            placeholder={'example.com\nmyjournal.app'}
            value={exclusionsText}
            onChange={(e) => saveExclusions(e.target.value)}
          />
        </Drawer>
        <Row icon="📦" tint="#0891b2" label="Export my data" sub="one JSON file, yours">
          <button className="pill" onClick={doExport}>
            Export
          </button>
        </Row>
        <Row icon="🗑️" tint="#991b1b" label="Erase everything" sub="every memory, gone for good">
          <button className={`pill danger${wipeArmed ? ' armed' : ''}`} onClick={doWipe}>
            {wipeArmed ? 'Click again to confirm' : 'Erase'}
          </button>
        </Row>
      </Group>

      <footer>
        Nomi never clicks, never types, never takes control — and never sends your data anywhere.
      </footer>
    </div>
  );
}
