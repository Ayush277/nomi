import { useEffect, useState } from 'react';
import { geminiAvailable } from '../../lib/gemini';
import { ollamaAvailable } from '../../lib/ollama';
import { getSettings, saveSettings } from '../../lib/settings';
import { exportAll, wipeAll } from '../../lib/store';
import { DEFAULT_SETTINGS, type NomiSettings } from '../../lib/types';

export function App() {
  const [settings, setSettings] = useState<NomiSettings>(DEFAULT_SETTINGS);
  const [exclusionsText, setExclusionsText] = useState('');
  const [llmStatus, setLlmStatus] = useState<'unknown' | 'checking' | 'ok' | 'missing'>('unknown');
  const [gemStatus, setGemStatus] = useState<'unknown' | 'checking' | 'ok' | 'missing'>('unknown');
  const [wipeArmed, setWipeArmed] = useState(false);

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

  const quiet = settings.quietHours;

  return (
    <div className="page">
      <header>
        <div className="orb" aria-hidden="true">
          <span className="eye" />
          <span className="eye" />
        </div>
        <div>
          <h1>Nomi settings</h1>
          <p>Everything here — and everything Nomi remembers — lives only on this device.</p>
        </div>
      </header>

      <section>
        <h2>Presence</h2>
        <label className="row">
          <span>
            <strong>Pause Nomi</strong>
            <em>Nothing is remembered while paused. The orb dims.</em>
          </span>
          <input
            type="checkbox"
            checked={settings.paused}
            onChange={(e) => update({ paused: e.target.checked })}
          />
        </label>
      </section>

      <section>
        <h2>Speaking up</h2>
        <label className="row">
          <span>
            <strong>How chatty?</strong>
            <em>Most Nomi will say in a day. Silence is always an option.</em>
          </span>
          <select
            value={settings.maxNudgesPerDay}
            onChange={(e) => update({ maxNudgesPerDay: Number(e.target.value) })}
          >
            <option value={3}>Quiet (3/day)</option>
            <option value={6}>Normal (6/day)</option>
            <option value={10}>Chatty (10/day)</option>
          </select>
        </label>
        <label className="row">
          <span>
            <strong>Speak out loud</strong>
            <em>Nomi reads its notes in your system voice — nothing leaves the device.</em>
          </span>
          <input
            type="checkbox"
            checked={settings.voice}
            onChange={(e) => update({ voice: e.target.checked })}
          />
        </label>
        <label className="row">
          <span>
            <strong>Quiet hours</strong>
            <em>Nomi stays silent during these hours (wins still get a cheer).</em>
          </span>
          <span className="quiet-controls">
            <input
              type="checkbox"
              checked={quiet !== null}
              onChange={(e) =>
                update({ quietHours: e.target.checked ? { startHour: 22, endHour: 8 } : null })
              }
            />
            {quiet && (
              <>
                <select
                  value={quiet.startHour}
                  onChange={(e) =>
                    update({ quietHours: { ...quiet, startHour: Number(e.target.value) } })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{`${h}:00`}</option>
                  ))}
                </select>
                <span className="to">to</span>
                <select
                  value={quiet.endHour}
                  onChange={(e) =>
                    update({ quietHours: { ...quiet, endHour: Number(e.target.value) } })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{`${h}:00`}</option>
                  ))}
                </select>
              </>
            )}
          </span>
        </label>
      </section>

      <section>
        <h2>Privacy</h2>
        <label className="col">
          <span>
            <strong>Sites Nomi should never notice</strong>
            <em>
              One domain per line. Banking, health, and mail are already excluded by default.
            </em>
          </span>
          <textarea
            rows={4}
            placeholder={'example.com\nmyjournal.app'}
            value={exclusionsText}
            onChange={(e) => saveExclusions(e.target.value)}
          />
        </label>
        <div className="actions">
          <button onClick={doExport}>Export my data (JSON)</button>
          <button className={wipeArmed ? 'danger armed' : 'danger'} onClick={doWipe}>
            {wipeArmed ? 'Click again to erase everything' : 'Erase everything Nomi remembers'}
          </button>
        </div>
      </section>

      <section>
        <h2>Cloud AI — Gemini (optional)</h2>
        <p className="hint">
          The quickest way to open conversation: paste a free API key from{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
          <strong> Honest note:</strong> with this on, your chat messages (and a one-line
          today summary) are sent to Google — the only thing that ever leaves this device.
          Memory, browsing awareness, and reminders stay local regardless.
        </p>
        <label className="row">
          <span>
            <strong>Chat with Gemini</strong>
          </span>
          <input
            type="checkbox"
            checked={settings.gemini.enabled}
            onChange={(e) => update({ gemini: { ...settings.gemini, enabled: e.target.checked } })}
          />
        </label>
        <label className="row">
          <span>
            <strong>API key</strong>
          </span>
          <span className="quiet-controls">
            <input
              type="password"
              className="model"
              placeholder="AIza…"
              value={settings.gemini.apiKey}
              onChange={(e) => update({ gemini: { ...settings.gemini, apiKey: e.target.value } })}
            />
            <button onClick={testGemini} disabled={!settings.gemini.apiKey.trim()}>
              {gemStatus === 'checking' ? 'Checking…' : 'Test key'}
            </button>
            {gemStatus === 'ok' && <span className="ok">Connected ✓</span>}
            {gemStatus === 'missing' && <span className="bad">Key not working</span>}
          </span>
        </label>
        <label className="row">
          <span>
            <strong>Model</strong>
          </span>
          <input
            type="text"
            className="model"
            value={settings.gemini.model}
            onChange={(e) => update({ gemini: { ...settings.gemini, model: e.target.value } })}
          />
        </label>
      </section>

      <section>
        <h2>Local AI (optional)</h2>
        <p className="hint">
          Nomi works fully without this. With <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> installed,
          chat becomes freeform — still 100% on your machine. Run{' '}
          <code>ollama pull {settings.ollama.model}</code>, and allow this extension:{' '}
          <code>OLLAMA_ORIGINS=chrome-extension://{chrome.runtime.id}</code>
        </p>
        <label className="row">
          <span>
            <strong>Use a local model for chat</strong>
          </span>
          <input
            type="checkbox"
            checked={settings.ollama.enabled}
            onChange={(e) => update({ ollama: { ...settings.ollama, enabled: e.target.checked } })}
          />
        </label>
        <label className="row">
          <span>
            <strong>Model</strong>
          </span>
          <span className="quiet-controls">
            <input
              type="text"
              className="model"
              value={settings.ollama.model}
              onChange={(e) => update({ ollama: { ...settings.ollama, model: e.target.value } })}
            />
            <button onClick={testOllama}>
              {llmStatus === 'checking' ? 'Checking…' : 'Test connection'}
            </button>
            {llmStatus === 'ok' && <span className="ok">Connected ✓</span>}
            {llmStatus === 'missing' && <span className="bad">Not reachable</span>}
          </span>
        </label>
      </section>

      <footer>
        Nomi never clicks, never types, never takes control — and never sends your data anywhere.
      </footer>
    </div>
  );
}
