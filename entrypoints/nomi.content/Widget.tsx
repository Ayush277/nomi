import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { PERSONALITIES } from '../../lib/persona';
import { DEFAULT_PROFILE, PROFILE_KEY, type NomiProfile } from '../../lib/profile';
import { DEFAULT_SETTINGS } from '../../lib/types';
import type { ChatMessage, MoodState } from '../../lib/types';

interface Bubble {
  id: string;
  text: string;
  fx?: string;
  /** True only for replies to a VOICE ask — those speak; everything else is
   * a silent notification (the user's rule: talk only when talked to). */
  speak?: boolean;
  /** After a spoken reply, open the mic once for a follow-up question. */
  followUp?: boolean;
}

type FxKind = 'electric' | 'flame' | 'water';

interface FxParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  r: number;
  color: string;
}

interface FxBolt {
  angle: number;
  life: number;
}

const FX_COLORS: Record<FxKind, string[]> = {
  electric: ['#c4b5fd', '#5eead4', '#ffffff', '#a78bfa'],
  flame: ['#ffd29d', '#ff8a5c', '#f472b6', '#c4b5fd'],
  water: ['#7dd3fc', '#38bdf8', '#a5f3fc', '#e0f2fe'],
};

interface Pos {
  right: number;
  bottom: number;
}

const POS_KEY = 'nomi:widgetPos';
const BUBBLE_KEY = 'nomi:bubble';
const SETTINGS_KEY = 'nomi:settings';
const CHAT_KEY = 'nomi:chatHistory';
const MOOD_KEY = 'nomi:mood';
const OPEN_CHAT_KEY = 'nomi:openChat';
const DEFAULT_POS: Pos = { right: 24, bottom: 24 };
const BUBBLE_LIFETIME_MS = 8000;
const GAZE_TRAVEL_PX = 4;

const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '?';
  }
})();

/** Soft two-note chime for focus timers — WebAudio, quiet by design. */
function chime(kind: 'start' | 'end'): void {
  try {
    const ac = new AudioContext();
    const notes = kind === 'start' ? [523.25, 659.25] : [659.25, 523.25, 783.99];
    let t = ac.currentTime + 0.02;
    for (const freq of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.05, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.35);
      t += 0.15;
    }
    setTimeout(() => void ac.close(), 1500);
  } catch {
    // audio blocked — silence is fine
  }
}

/** Soft, warm delivery: prefer the natural system voices, strip emoji,
 * slow down a touch. Voices load async, so re-pick until they exist. */
let cachedVoice: SpeechSynthesisVoice | null | undefined;
let voiceHinglish = false; // kept in sync with settings.language by the widget
if ('speechSynthesis' in globalThis) {
  speechSynthesis.addEventListener?.('voiceschanged', () => (cachedVoice = undefined));
}

/** Switch the spoken voice between English and Hinglish (Indian) presets. */
function setVoiceLanguage(hinglish: boolean): void {
  if (hinglish !== voiceHinglish) {
    voiceHinglish = hinglish;
    cachedVoice = undefined; // re-pick against the new preference
  }
}

function pickVoice(hinglish = false): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null; // not loaded yet — retry next time

  if (hinglish) {
    // Indian voices read romanized Hinglish far more naturally. Prefer an
    // Indian-English voice, then a Hindi voice, then any en-IN, then fall back.
    const preferIn = ['Rishi', 'Isha', 'Veena', 'Lekha', 'Google हिन्दी', 'Google Hindi'];
    cachedVoice =
      voices.find((v) => preferIn.some((p) => v.name.includes(p))) ??
      voices.find((v) => v.lang === 'en-IN' || v.lang === 'hi-IN') ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0] ??
      null;
    return cachedVoice;
  }

  const en = voices.filter((v) => v.lang.startsWith('en'));
  // Named warm female voices, best first.
  const prefer = [
    'Ava', 'Samantha', 'Zoe', 'Allison', 'Serena', 'Nicky', 'Susan', 'Karen',
    'Google US English', 'Google UK English Female',
  ];
  cachedVoice =
    // 1) a downloaded high-quality pack (macOS "Premium"/"Enhanced", neural)
    en.find((v) => /premium|enhanced|neural/i.test(v.name) && prefer.some((p) => v.name.includes(p))) ??
    en.find((v) => /premium|enhanced|neural/i.test(v.name)) ??
    // 2) a good default female voice
    en.find((v) => prefer.some((p) => v.name.includes(p))) ??
    en[0] ??
    voices[0] ??
    null;
  return cachedVoice;
}

interface SpeakCbs {
  onStart?: () => void;
  onEnd?: () => void;
}

/** System-voice fallback. Chrome cuts speech off after ~15s, so we split into
 * sentence-sized utterances queued back-to-back (each well under the cap) —
 * no pause/resume hack, which is what caused the "cracking". */
function speak(text: string, cbs: SpeakCbs = {}): void {
  if (!('speechSynthesis' in window)) return;
  const clean = text
    // Markdown links [label](url) → just say the label.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    // Read a URL as the site's NAME, never "h-t-t-p-s-colon-slash-slash-w-w-w".
    .replace(
      /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]{2,})\.(?:com|org|net|io|dev|ai|co|in|so|app|md|gov|edu|xyz|me|tv|us|uk|gg)\b(?:\/\S*)?/gi,
      '$1',
    )
    .replace(/\bhttps?:\/\/\S+/gi, 'a link') // any leftover URL
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) {
    cbs.onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const v = pickVoice(voiceHinglish);
  const chunks = (clean.match(/[^.!?\n]+[.!?]*/g) ?? [clean])
    .flatMap((s) => (s.length > 180 ? s.split(/,\s*/) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    if (v) u.voice = v;
    u.rate = 0.92;
    u.pitch = 1.05; // a touch higher — a lighter, warmer read
    u.volume = 0.85;
    if (i === 0) u.onstart = () => cbs.onStart?.();
    if (i === chunks.length - 1) {
      u.onend = () => cbs.onEnd?.();
      u.onerror = () => cbs.onEnd?.();
    }
    speechSynthesis.speak(u);
  });
}

/** Classify a bubble by its text so it gets the right icon + accent colour —
 * turns plain nudges into little typed notification popups. */
function bubbleKind(text: string): string {
  const t = text.toLowerCase();
  if (/time'?s up|\btimer\b|⏲/.test(t)) return 'timer';
  if (/\bremind|you asked me to|you wanted to|don'?t forget|still on your list/.test(t)) return 'remind';
  if (/accepted|solved|nice work|🎉|in a row|milestone|crushed|good stuff/.test(t)) return 'win';
  if (/\bbreak\b|step away|stretch|water|breather|pause|late one|call it|rest\b|wrap up/.test(t)) return 'care';
  if (/^(hey|hi+|hello|welcome back|morning)|right here|i'?m listening|i'?m around|beside you/.test(t)) return 'hi';
  return 'say';
}
const BUBBLE_ICONS: Record<string, string> = {
  timer: '⏲️', remind: '🔔', win: '🎉', care: '💜', hi: '👋', say: '💬',
};
function bubbleIcon(text: string): string {
  return BUBBLE_ICONS[bubbleKind(text)] ?? '💬';
}

/** Render a chat message with clickable links — supports [label](url) and bare
 * URLs — so saved links (the bag) can be opened with a tap. */
function renderMessage(text: string): ReactNode[] {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const label = m[1] ?? m[3];
    const url = m[2] ?? m[3];
    out.push(
      <a
        key={k++}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="nomi-link"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Widget() {
  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [blink, setBlink] = useState(false);
  const [taskFx, setTaskFx] = useState<'store' | 'accept' | 'done' | null>(null);
  const [paused, setPaused] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [alwaysVisible, setAlwaysVisible] = useState(DEFAULT_SETTINGS.alwaysVisible);
  const [widgetScale, setWidgetScale] = useState(DEFAULT_SETTINGS.widgetScale);
  const [orbTheme, setOrbTheme] = useState<string>(DEFAULT_SETTINGS.orbTheme);
  const alwaysVisibleRef = useRef(DEFAULT_SETTINGS.alwaysVisible);
  const [mood, setMood] = useState<MoodState>({ kind: 'idle' });
  const [chatOpen, setChatOpen] = useState(false);
  // Satellites: collapsed to one concise chip by default; a tap unfolds them.
  const [orbitOpen, setOrbitOpen] = useState(false);
  useEffect(() => {
    if (!orbitOpen) return;
    const t = setTimeout(() => setOrbitOpen(false), 10000); // fold back on their own
    return () => clearTimeout(t);
  }, [orbitOpen]);
  const [dragging, setDragging] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<{
    status: string;
    pct?: number;
    message?: string;
  }>({ status: 'idle' });
  const [docked, setDocked] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [stretching, setStretching] = useState(false);
  const [aqua, setAqua] = useState(false);
  const [hop, setHop] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const fxRaf = useRef(0);

  /** Particle bursts drawn behind the orb: electric arcs for wins, plasma
   * flame for the big ones, falling drops for water time. Pure canvas —
   * no page layout is ever touched. */
  const runFx = useCallback((kind: FxKind) => {
    if (reducedMotion) return;
    const cv = fxRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const W = (cv.width = 300);
    const H = (cv.height = 300);
    const cx = W / 2;
    const cy = H / 2;
    const colors = FX_COLORS[kind];
    const parts: FxParticle[] = [];
    const count = kind === 'water' ? 22 : 52;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === 'water' ? 0.6 + Math.random() * 1.4 : 2 + Math.random() * 4.5;
      parts.push({
        x: cx + (kind === 'water' ? (Math.random() - 0.5) * 60 : 0),
        y: kind === 'water' ? cy - 78 : cy,
        vx: Math.cos(a) * sp * (kind === 'water' ? 0.3 : 1),
        vy: kind === 'water' ? 0.8 + Math.random() * 1.6 : Math.sin(a) * sp - (kind === 'flame' ? 1.6 : 0),
        life: 1,
        decay: kind === 'water' ? 0.012 + Math.random() * 0.02 : 0.006 + Math.random() * 0.011,
        r: 1.6 + Math.random() * 2.6,
        color: colors[i % colors.length],
      });
    }
    const bolts: FxBolt[] =
      kind === 'electric'
        ? [0, 1, 2, 3].map(() => ({ angle: Math.random() * Math.PI * 2, life: 1 }))
        : [];

    cancelAnimationFrame(fxRaf.current);
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bolts) {
        if (b.life <= 0) continue;
        b.life -= 0.045;
        if (Math.random() < 0.4) b.angle += (Math.random() - 0.5) * 0.6;
        ctx.strokeStyle = `rgba(200,220,255,${Math.max(b.life, 0)})`;
        ctx.lineWidth = 1.6;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#8b5cf6';
        ctx.beginPath();
        let x = cx + Math.cos(b.angle) * 62;
        let y = cy + Math.sin(b.angle) * 62;
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
          x += Math.cos(b.angle) * 13 + (Math.random() - 0.5) * 16;
          y += Math.sin(b.angle) * 13 + (Math.random() - 0.5) * 16;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      let alive = false;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        if (kind === 'flame') p.vy -= 0.05;
        else if (kind === 'water') p.vy += 0.09;
        else {
          p.vx *= 0.96;
          p.vy *= 0.96;
        }
        p.life -= p.decay;
        ctx.shadowBlur = 16;
        ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive || bolts.some((b) => b.life > 0)) fxRaf.current = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    fxRaf.current = requestAnimationFrame(tick);
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [reminders, setReminders] = useState<Record<string, { what: string; at: number }>>({});
  const [bagCount, setBagCount] = useState(0);
  const [intentCount, setIntentCount] = useState(0);
  const [currentVisit, setCurrentVisit] = useState<{ domain: string; startTs: number } | null>(null);
  const [, setTick] = useState(0); // 1s heartbeat so live time/timer chips update
  const [focusSess, setFocusSess] = useState<{ until: number; minutes: number } | null>(null);
  const [, setClockTick] = useState(0); // re-render for countdown chips
  const [profile, setProfile] = useState<NomiProfile>(DEFAULT_PROFILE);
  const [seeing, setSeeing] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [stats, setStats] = useState<{
    streak: number;
    codingMs: number;
    learningMs: number;
    totalMs: number;
    accepted: number;
  } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<{ until: number } | null>(null);
  const ttsAudio = useRef<HTMLAudioElement | null>(null);
  const drag = useRef<{ startX: number; startY: number; origin: Pos; moved: boolean } | null>(null);

  // Stop whatever voice is playing (system or Gemini audio) — for barge-in.
  const stopSpeaking = useCallback(() => {
    speechSynthesis?.cancel();
    if (ttsAudio.current) {
      ttsAudio.current.pause();
      ttsAudio.current.src = '';
      ttsAudio.current = null;
    }
    setSpeaking(false);
  }, []);

  // Speak with the best local system voice (prefers a downloaded Enhanced/
  // Premium female pack). Gemini is used to answer & transcribe, not to talk.
  const speakSmart = useCallback(
    (text: string, onDone?: () => void) => {
      stopSpeaking();
      speak(text, {
        onStart: () => setSpeaking(true),
        onEnd: () => {
          setSpeaking(false);
          onDone?.();
        },
      });
    },
    [stopSpeaking],
  );

  const listening = voiceStatus.status === 'listening';

  // Initial state + follow changes from background/settings.
  useEffect(() => {
    chrome.storage.local
      .get([POS_KEY, SETTINGS_KEY, 'nomi:reminders', 'nomi:focusSession', 'nomi:bag', 'nomi:intentions'])
      .then((stored) => {
        if (stored[POS_KEY]) setPos(stored[POS_KEY]);
        setPaused(Boolean(stored[SETTINGS_KEY]?.paused));
        setVoiceOn(stored[SETTINGS_KEY]?.voice ?? true);
        setAlwaysVisible(stored[SETTINGS_KEY]?.alwaysVisible ?? DEFAULT_SETTINGS.alwaysVisible);
        setWidgetScale(stored[SETTINGS_KEY]?.widgetScale ?? DEFAULT_SETTINGS.widgetScale);
        setOrbTheme(stored[SETTINGS_KEY]?.orbTheme ?? DEFAULT_SETTINGS.orbTheme);
        setVoiceLanguage(stored[SETTINGS_KEY]?.language === 'hinglish');
        if (stored['nomi:reminders']) setReminders(stored['nomi:reminders']);
        if (stored['nomi:focusSession']) setFocusSess(stored['nomi:focusSession']);
        setBagCount(Array.isArray(stored['nomi:bag']) ? stored['nomi:bag'].length : 0);
        setIntentCount(
          Array.isArray(stored['nomi:intentions'])
            ? stored['nomi:intentions'].filter((i: { status?: string }) => i.status === 'open').length
            : 0,
        );
      })
      .catch(() => {}); // orphaned after an extension reload — stay quiet
    chrome.storage.local
      .get(PROFILE_KEY)
      .then((s) => s[PROFILE_KEY] && setProfile({ ...DEFAULT_PROFILE, ...s[PROFILE_KEY] }))
      .catch(() => {});
    const loadStats = () =>
      chrome.runtime
        .sendMessage({ type: 'nomi:stats' })
        .then((s) => s && setStats(s))
        .catch(() => {});
    loadStats();
    const statsTimer = setInterval(loadStats, 60000);
    chrome.storage.session
      .get([BUBBLE_KEY, CHAT_KEY, MOOD_KEY, 'nomi:currentVisit'])
      .then((stored) => {
        if (stored[BUBBLE_KEY]) setBubble(stored[BUBBLE_KEY]);
        if (stored[CHAT_KEY]) setMessages(stored[CHAT_KEY]);
        if (stored[MOOD_KEY]) setMood(stored[MOOD_KEY]);
        if (stored['nomi:currentVisit']) setCurrentVisit(stored['nomi:currentVisit']);
      })
      .catch(() => {});
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[BUBBLE_KEY]) setBubble(changes[BUBBLE_KEY].newValue ?? null);
      if (area === 'session' && changes[CHAT_KEY]) setMessages(changes[CHAT_KEY].newValue ?? []);
      if (area === 'session' && changes[MOOD_KEY]?.newValue) setMood(changes[MOOD_KEY].newValue);
      if (area === 'session' && changes['nomi:currentVisit']) setCurrentVisit(changes['nomi:currentVisit'].newValue ?? null);
      if (area === 'session' && changes['nomi:voiceStatus']?.newValue) {
        const vs = changes['nomi:voiceStatus'].newValue;
        setVoiceStatus(vs);
        // Nomi yields the floor the moment the human is being heard.
        if (vs.status === 'listening') stopSpeaking();
      }
      if (area === 'session' && changes['nomi:ttsStop']) stopSpeaking();
      if (area === 'session' && changes[OPEN_CHAT_KEY]?.newValue) {
        // Keyboard shortcut: only the tab the user is looking at responds.
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          setChatOpen(true);
          if (changes[OPEN_CHAT_KEY].newValue.voice) startListening();
        }
      }
      if (area === 'local' && changes[SETTINGS_KEY]) {
        const s = changes[SETTINGS_KEY].newValue;
        setPaused(Boolean(s?.paused));
        setVoiceOn(s?.voice ?? true);
        setAlwaysVisible(s?.alwaysVisible ?? DEFAULT_SETTINGS.alwaysVisible);
        setWidgetScale(s?.widgetScale ?? DEFAULT_SETTINGS.widgetScale);
        setOrbTheme(s?.orbTheme ?? DEFAULT_SETTINGS.orbTheme);
        setVoiceLanguage(s?.language === 'hinglish');
      }
      if (area === 'local' && changes[POS_KEY]?.newValue) setPos(changes[POS_KEY].newValue);
      if (area === 'local' && changes['nomi:reminders']) {
        setReminders(changes['nomi:reminders'].newValue ?? {});
      }
      if (area === 'local' && changes['nomi:bag']) {
        setBagCount(Array.isArray(changes['nomi:bag'].newValue) ? changes['nomi:bag'].newValue.length : 0);
      }
      if (area === 'local' && changes['nomi:intentions']) {
        const v = changes['nomi:intentions'].newValue;
        setIntentCount(Array.isArray(v) ? v.filter((i: { status?: string }) => i.status === 'open').length : 0);
      }
      if (area === 'local' && changes['nomi:focusSession']) {
        setFocusSess(changes['nomi:focusSession'].newValue ?? null);
      }
      if (area === 'local' && changes[PROFILE_KEY]?.newValue) {
        setProfile({ ...DEFAULT_PROFILE, ...changes[PROFILE_KEY].newValue });
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearInterval(statsTimer);
      try {
        chrome.storage.onChanged.removeListener(onChanged);
      } catch {
        // extension reloaded from under us — nothing to detach from
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buddy behavior: tuck away small after 30s of being ignored; come back
  // out when hovered, spoken to, or when there's something to say.
  const wake = useCallback(() => {
    setDocked(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    // When the owner asked Nomi to stay put, never arm the tuck-away timer.
    if (alwaysVisibleRef.current) return;
    idleTimer.current = setTimeout(() => setDocked(true), 30000);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  // 1s heartbeat so the live chips (time on this site, timer countdown) update.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the tuck behavior in sync when the setting flips at runtime: staying
  // visible pops it back out and disarms the timer; turning it off re-arms.
  useEffect(() => {
    alwaysVisibleRef.current = alwaysVisible;
    if (alwaysVisible) {
      setDocked(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    } else {
      wake();
    }
  }, [alwaysVisible, wake]);

  useEffect(() => {
    if (bubble || chatOpen || listening || mood.kind === 'celebrate') wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble?.id, chatOpen, listening, mood.kind]);

  // Celebrations wind down on their own — and fire the matching burst.
  useEffect(() => {
    if (mood.kind !== 'celebrate' || !mood.until) return;
    runFx(mood.flavor === 'flame' ? 'flame' : 'electric');
    const t = setTimeout(() => setMood({ kind: 'idle' }), Math.max(0, mood.until - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood]);

  // Physical actions that arrive attached to bubbles.
  useEffect(() => {
    if (!bubble?.fx) return;
    // Water/stretch decorative particle "bubbles" removed — kept the note,
    // dropped the gimmick. Meaningful wins still celebrate (electric/flame).
    void setAqua;
    void setStretching;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble?.id]);

  // While tucked away, peek out now and then — checking on you, quietly.
  useEffect(() => {
    if (!docked) return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = () => {
      t = setTimeout(() => {
        if (!alive) return;
        setPeeking(true);
        setTimeout(() => setPeeking(false), 2600);
        loop();
      }, 40000 + Math.random() * 45000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [docked]);

  // A little hop when you come back after being away a while.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        stopSpeaking(); // switched away — stop talking mid-sentence
      } else if (hiddenAt && Date.now() - hiddenAt > 20 * 60000) {
        setHop(true);
        setTimeout(() => setHop(false), 1600);
        wake();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [wake]);

  const closeBubble = useCallback((b: Bubble, reason: 'dismissed' | 'expired') => {
    setBubble(null);
    stopSpeaking();
    void chrome.runtime.sendMessage({ type: 'nomi:bubbleClosed', id: b.id, reason }).catch(() => {});
  }, []);

  // Bubbles dissolve on their own; never more than one exists (DESIGN.md).
  // Bubbles are SILENT notifications — with ONE exception: a reply to a
  // question the user asked BY VOICE (bubble.speak). That one talks back, and
  // then listens once for a follow-up, so a spoken exchange flows like a
  // conversation. Silence ends it. Proactive bubbles never speak.
  useEffect(() => {
    if (!bubble) return;
    // A reminder/task surfacing → red "done / needs you" pulse.
    if (/\b(you wanted to|you asked me to|reminder|remind you|time —|you're on)\b/i.test(bubble.text)) {
      fireTaskFx('done');
    }
    if (bubble.speak && voiceOn && document.visibilityState === 'visible' && document.hasFocus()) {
      speakSmart(bubble.text, () => {
        if (bubble.followUp) {
          void chrome.runtime.sendMessage({ type: 'nomi:listenOnce' }).catch(() => {});
        }
      });
    }
    // Spoken replies get room to finish talking + the follow-up listen window.
    const t = setTimeout(
      () => closeBubble(bubble, 'expired'),
      bubble.speak ? Math.max(BUBBLE_LIFETIME_MS, 4000 + bubble.text.length * 70) : BUBBLE_LIFETIME_MS,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble?.id]);

  // Blink the little white eyes every 4–7s.
  useEffect(() => {
    if (reducedMotion) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        setTimeout(() => setBlink(false), 150);
        loop();
      }, 4000 + Math.random() * 3000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  // A transient task effect that colours the aura: purple when storing,
  // green when a task is accepted, red when one is done / needs you.
  const fireTaskFx = useCallback((kind: 'store' | 'accept' | 'done') => {
    setTaskFx(kind);
    setTimeout(() => setTaskFx((k) => (k === kind ? null : k)), 2400);
  }, []);

  // Gaze: the eyes drift a few px toward the cursor — subtle parallax.
  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: MouseEvent) => {
      const orb = orbRef.current;
      const eyes = eyesRef.current;
      if (!orb || !eyes || drag.current) return;
      const r = orb.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const pull = Math.min(dist / 80, 1) * GAZE_TRAVEL_PX;
      eyes.style.transform = `translate(${(dx / dist) * pull}px, ${(dy / dist) * pull}px)`;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, thinking, chatOpen]);

  // Keep countdown chips honest while the chat is open.
  useEffect(() => {
    if (!chatOpen) return;
    const t = setInterval(() => setClockTick((n) => n + 1), 20000);
    return () => clearInterval(t);
  }, [chatOpen]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || thinking) return;
      setDraft('');
      const withUser: ChatMessage[] = [...messages, { role: 'user', text: q, ts: Date.now() }];
      setMessages(withUser);
      void chrome.storage.session.set({ [CHAT_KEY]: withUser }).catch(() => {});
      setThinking(true);
      let reply = 'Hmm, I lost my train of thought — try that again?';
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'nomi:chat',
          text: q,
          history: messages,
          // The page the user is ACTUALLY chatting from — so "save this page"
          // can never grab the wrong tab (or none) via focus-dependent queries.
          page: { url: location.href, title: document.title },
        });
        if (res?.text) reply = res.text;
        if ('seeing' in (res ?? {})) setSeeing(res.seeing ?? null);
      } catch {}
      setThinking(false);

      // Colour the aura by what Nomi just did with your words.
      if (/\b(saved|stored|remember(ed)?|bag|kept it)\b/i.test(reply)) fireTaskFx('store');
      else if (/\b(got it|on it|done|i'?ll (nudge|remind)|reminder set|next time you)\b/i.test(reply))
        fireTaskFx('accept');

      if (voiceOn && document.hasFocus()) speakSmart(reply);

      const ts = Date.now();
      const persist = (full: string) =>
        void chrome.storage.session
          .set({ [CHAT_KEY]: [...withUser, { role: 'nomi', text: full, ts }] })
          .catch(() => {});

      // Reveal the reply word-by-word — a buddy talks, it doesn't paste.
      if (reducedMotion) {
        setMessages([...withUser, { role: 'nomi', text: reply, ts }]);
        persist(reply);
        return;
      }
      const words = reply.split(' ');
      let i = 0;
      if (revealTimer.current) clearInterval(revealTimer.current);
      revealTimer.current = setInterval(() => {
        i = Math.min(i + (i < 4 ? 1 : 2), words.length);
        setMessages([...withUser, { role: 'nomi', text: words.slice(0, i).join(' '), ts }]);
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
        if (i >= words.length) {
          clearInterval(revealTimer.current!);
          revealTimer.current = null;
          persist(reply);
        }
      }, 32);
    },
    [messages, thinking, voiceOn],
  );

  // Voice input runs through the extension's own ears: local Whisper in an
  // offscreen document. Works in any Chromium browser — no Google service.
  const startListening = useCallback(() => {
    setChatOpen(true);
    stopSpeaking();
    void chrome.runtime.sendMessage({ type: 'nomi:listenOnce' }).catch(() => {});
  }, [stopSpeaking]);

  // Focus timer chimes: soft note at the start, soft resolve at the end.
  useEffect(() => {
    const now = Date.now();
    const live = focusSess && focusSess.until > now ? focusSess : null;
    const prev = prevFocus.current;
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      if (live && !prev) chime('start');
      if (!live && prev && prev.until <= now + 3000) chime('end');
    }
    prevFocus.current = live;
  }, [focusSess]);

  // Tick every second while a focus timer runs — the orb face IS the timer.
  useEffect(() => {
    if (!focusSess || focusSess.until <= Date.now()) return;
    const t = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [focusSess]);

  const clampPos = (p: Pos): Pos => ({
    right: Math.min(Math.max(p.right, 8), Math.max(window.innerWidth - 140, 8)),
    bottom: Math.min(Math.max(p.bottom, 8), Math.max(window.innerHeight - 140, 8)),
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // some environments reject capture — dragging degrades, taps still work
      }
      drag.current = { startX: e.clientX, startY: e.clientY, origin: pos, moved: false };
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 5) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) {
      setPos(clampPos({ right: d.origin.right - dx, bottom: d.origin.bottom - dy }));
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.moved) {
      // Settle toward the nearest edge when close — a companion tidies itself up.
      setPos((p) => {
        const snapped = {
          right: p.right < 80 ? 24 : p.right,
          bottom: p.bottom < 80 ? 24 : p.bottom,
        };
        void chrome.storage.local.set({ [POS_KEY]: snapped }).catch(() => {});
        return snapped;
      });
    } else {
      // While Nomi is talking, a tap on the ball means "stop" — pause the
      // voice right there and consume the tap. Nothing else happens.
      if (speaking) {
        stopSpeaking();
        return;
      }
      // A tap always reaches the chat — a bubble in the way gets dismissed
      // on the same tap, never swallowing the interaction.
      if (bubble) closeBubble(bubble, 'dismissed');
      const nowTs = Date.now();
      const doubleTap = nowTs - lastTap.current < 400;
      lastTap.current = nowTs;
      if (!chatOpen) {
        setChatOpen(true);
      } else if (doubleTap) {
        startListening();
      } else if (!bubble) {
        setChatOpen(false);
      }
    }
    wake();
  }, [bubble, closeBubble, chatOpen, startListening, wake, speaking, stopSpeaking]);

  const moodClass =
    mood.kind === 'celebrate' ? ' celebrate' : mood.kind === 'focus' ? ' focusing' : '';
  const focusLive = focusSess && focusSess.until > Date.now() ? focusSess : null;
  const timerText = focusLive
    ? (() => {
        const left = Math.max(0, focusLive.until - Date.now());
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        return `${m}:${String(s).padStart(2, '0')}`;
      })()
    : null;
  const tucked =
    docked &&
    !chatOpen &&
    !bubble &&
    !listening &&
    !focusLive &&
    mood.kind !== 'celebrate' &&
    !dragging;

  // Buddy status orbiting the orb: live, useful, prioritized — at most four.
  const nowMs = Date.now();
  const pending = Object.values(reminders).filter((r) => r && r.at > nowMs);
  const timers = pending.filter((r) => /timer|⏲/i.test(r.what ?? ''));
  const plainReminders = pending.filter((r) => !/timer|⏲/i.test(r.what ?? ''));
  const nextTimer = timers.slice().sort((a, b) => a.at - b.at)[0];
  const nextTimerMs = nextTimer ? nextTimer.at - nowMs : 0;
  const siteMin = currentVisit ? Math.floor((nowMs - currentVisit.startTs) / 60000) : 0;
  const fmtLeft = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.ceil(ms / 1000))}s` : `${Math.round(ms / 60000)}m`);

  type Chip = { icon: string; label: string; title: string; query: string };
  const candidates: Chip[] = [];
  if (nextTimer)
    candidates.push({ icon: '⏲️', label: fmtLeft(nextTimerMs), title: `timer — ${fmtLeft(nextTimerMs)} left`, query: 'what are my reminders?' });
  if (siteMin >= 1 && currentVisit)
    candidates.push({ icon: '🌐', label: `${siteMin}m`, title: `${siteMin} min on ${currentVisit.domain}`, query: "how's today going?" });
  if (plainReminders.length)
    candidates.push({ icon: '🔔', label: String(plainReminders.length), title: `${plainReminders.length} reminder(s)`, query: 'what are my reminders?' });
  if (bagCount)
    candidates.push({ icon: '🔖', label: String(bagCount), title: `${bagCount} saved — tap to see`, query: 'what did I save?' });
  if (intentCount)
    candidates.push({ icon: '📌', label: String(intentCount), title: `${intentCount} open intention(s)`, query: 'what am I putting off?' });
  const positions = ['nw', 'ne', 'sw', 'se'];
  const orbitChips = candidates.slice(0, 4).map((c, i) => ({ ...c, pos: positions[i] }));
  // Satellites step aside while a bubble is talking — never overlap words.
  const showOrbit = !tucked && !chatOpen && !bubble && orbitChips.length > 0;
  // One concise satellite by default; tapping it unfolds the rest.
  const summaryChip = orbitChips[0];

  return (
    <div className={`nomi-root${reducedMotion ? ' reduced' : ''}`}>
      <div
        className={`nomi-anchor${dragging ? ' drag-live' : ''}${tucked ? ' docked' : ''}${
          tucked && peeking ? ' peeking' : ''
        }`}
        style={
          {
            right: `${pos.right}px`,
            bottom: `${pos.bottom}px`,
            '--nomi-scale': widgetScale,
          } as CSSProperties
        }
        onPointerEnter={wake}
      >
        {bubble && !chatOpen && (
          <div
            className={`nomi-bubble kind-${bubbleKind(bubble.text)}`}
            onClick={() => closeBubble(bubble, 'dismissed')}
          >
            <span className="nomi-bubble-icon" aria-hidden="true">{bubbleIcon(bubble.text)}</span>
            {bubble.text}
          </div>
        )}

        {chatOpen && (
          <div className="nomi-chat">
            <div className="nomi-chat-head">
              <span>
                <i className="nomi-status" aria-hidden="true" />
                Nomi
              </span>
              <button
                className={`nomi-eye-btn${showContext ? ' on' : ''}`}
                onClick={() => setShowContext((v) => !v)}
                title="What Nomi can see & remember"
                aria-label="What Nomi can see"
              >
                👁 what I see
              </button>
              <button className="nomi-chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">
                ×
              </button>
            </div>
            {showContext && (
              <div className="nomi-context">
                <div>
                  <b>Seeing</b>{' '}
                  {seeing ??
                    (paused
                      ? 'nothing — paused'
                      : (document.title || 'this page').slice(0, 70))}
                </div>
                <div>
                  <b>Remembers</b>{' '}
                  {profile.name ? `you're ${profile.name}` : 'getting to know you'}
                  {profile.goal ? ` · goal: ${profile.goal.slice(0, 40)}` : ''}
                  {profile.facts.length ? ` · ${profile.facts.length} note${profile.facts.length > 1 ? 's' : ''}` : ''}
                </div>
                <div>
                  <b>Mode</b> {PERSONALITIES[profile.personality]?.label ?? 'Friend'} ·{' '}
                  <span className="nomi-ctx-ver">v{VERSION} · on-device</span>
                </div>
              </div>
            )}
            <div className="nomi-chat-list" ref={listRef}>
              {messages.length === 0 && (
                <div className="nomi-msg nomi">
                  {profile.name ? `Hey ${profile.name}. ` : 'Hey. '}I can see the page you're on and I
                  remember what matters. Try "analyze this page", "how's today going?", or "remember
                  I'm prepping for interviews".
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`nomi-msg ${m.role}`}>
                  {m.role === 'nomi' ? renderMessage(m.text) : m.text}
                </div>
              ))}
              {thinking && <div className="nomi-msg nomi nomi-thinking">…</div>}
            </div>
            {voiceStatus.status !== 'idle' && voiceStatus.status !== 'booted' && (
              <div
                className={`nomi-voice-note${
                  voiceStatus.status === 'error' || voiceStatus.status === 'denied' ? ' bad' : ''
                }`}
              >
                {listening
                  ? '● Listening — speak now'
                  : voiceStatus.status === 'transcribing'
                    ? 'Heard you — thinking…'
                    : voiceStatus.status === 'denied'
                      ? 'Microphone blocked. Settings → Voice → Enable microphone, then try again.'
                      : `Voice failed: ${voiceStatus.message ?? 'unknown'}`}
              </div>
            )}
            {(() => {
              const nowTs = Date.now();
              const minsLeft = (t: number) => Math.max(1, Math.ceil((t - nowTs) / 60000));
              const pending = Object.entries(reminders).filter(
                ([, r]) => r && typeof r === 'object' && r.at > nowTs,
              );
              const focusLive = focusSess && focusSess.until > nowTs;
              if (!focusLive && pending.length === 0) return null;
              return (
                <div className="nomi-holds">
                  {focusLive && (
                    <span className="nomi-hold focus">
                      focus · {minsLeft(focusSess.until)}m left
                      <button
                        aria-label="End focus early"
                        onClick={() =>
                          void chrome.runtime.sendMessage({ type: 'nomi:endFocus' }).catch(() => {})
                        }
                      >
                        ×
                      </button>
                    </span>
                  )}
                  {pending.map(([id, r]) => (
                    <span key={id} className="nomi-hold">
                      ⏳ {r.what} · {minsLeft(r.at)}m
                      <button
                        aria-label={`Cancel reminder: ${r.what}`}
                        onClick={() =>
                          void chrome.runtime
                            .sendMessage({ type: 'nomi:cancelReminder', id })
                            .catch(() => {})
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              );
            })()}
            <div className="nomi-chips">
              <button onClick={() => send('Analyze this page')}>Analyze this</button>
              <button onClick={() => send("How's today going?")}>Today?</button>
              <button onClick={() => send('Remember this link')}>Save link</button>
              <button onClick={() => send('Focus with me for 25 minutes')}>Focus</button>
            </div>
            <form
              className="nomi-chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  listening
                    ? 'Listening…'
                    : voiceStatus.status === 'transcribing'
                      ? 'Heard you — thinking…'
                      : 'Say something…'
                }
                aria-label="Message Nomi"
              />
              <button
                type="button"
                className={`nomi-mic${listening ? ' live' : ''}`}
                aria-label="Voice input"
                title="Voice input — local Whisper (Alt+Shift+N from anywhere)"
                onClick={startListening}
              >
                ●
              </button>
            </form>
          </div>
        )}

        <div className="nomi-orbwrap">
          <canvas ref={fxRef} className="nomi-fx" width={300} height={300} aria-hidden="true" />
          <div className="nomi-air" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          {showOrbit && !orbitOpen && summaryChip && (
            <div className="nomi-orbit">
              <span
                className="nomi-orbit-chip pos-ne oc-summary"
                title={
                  orbitChips.length > 1
                    ? `${summaryChip.title} — tap for ${orbitChips.length - 1} more`
                    : summaryChip.title
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (orbitChips.length > 1) setOrbitOpen(true);
                  else {
                    setChatOpen(true);
                    void send(summaryChip.query);
                  }
                }}
              >
                <span className="oc-ico" aria-hidden="true">{summaryChip.icon}</span>
                <span className="oc-lbl">{summaryChip.label}</span>
                {orbitChips.length > 1 && <span className="oc-more">+{orbitChips.length - 1}</span>}
              </span>
            </div>
          )}
          {showOrbit && orbitOpen && (
            <div className="nomi-orbit">
              {orbitChips.map((c) => (
                <span
                  key={c.pos}
                  className={`nomi-orbit-chip pos-${c.pos} oc-in`}
                  title={c.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOrbitOpen(false);
                    setChatOpen(true);
                    void send(c.query);
                  }}
                >
                  <span className="oc-ico" aria-hidden="true">{c.icon}</span>
                  <span className="oc-lbl">{c.label}</span>
                </span>
              ))}
            </div>
          )}
          {(() => {
            // Productivity rings — live coding & learning progress around the
            // avatar (Core Vision #10). Two Apple-Watch-style arcs.
            const codingPct = stats ? Math.min(stats.codingMs / (3 * 3600000), 1) : 0;
            const learningPct = stats ? Math.min(stats.learningMs / (2 * 3600000), 1) : 0;
            const show = stats && !tucked && (codingPct > 0.01 || learningPct > 0.01);
            if (!show) return null;
            const arc = (r: number, pct: number) => {
              const c = 2 * Math.PI * r;
              return { r, c, off: c * (1 - pct) };
            };
            const outer = arc(69, codingPct);
            const inner = arc(60, learningPct);
            return (
              <svg className="nomi-rings" viewBox="0 0 150 150" aria-hidden="true">
                <defs>
                  <linearGradient id="ringTeal" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#5eead4" />
                    <stop offset="1" stopColor="#22d3ee" />
                  </linearGradient>
                  <linearGradient id="ringLav" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#c4b5fd" />
                    <stop offset="1" stopColor="#a78bfa" />
                  </linearGradient>
                </defs>
                <circle className="ring-bg" cx="75" cy="75" r={outer.r} />
                <circle
                  className="ring-fg"
                  cx="75"
                  cy="75"
                  r={outer.r}
                  stroke="url(#ringTeal)"
                  strokeDasharray={outer.c}
                  strokeDashoffset={outer.off}
                />
                <circle className="ring-bg" cx="75" cy="75" r={inner.r} />
                <circle
                  className="ring-fg"
                  cx="75"
                  cy="75"
                  r={inner.r}
                  stroke="url(#ringLav)"
                  strokeDasharray={inner.c}
                  strokeDashoffset={inner.off}
                />
              </svg>
            );
          })()}
          {stats && stats.streak >= 2 && !tucked && (
            <span className="nomi-streak-badge" title={`${stats.streak}-day streak`}>
              ⚡{stats.streak}
            </span>
          )}
          <div
            className={`nomi-ring${mood.kind === 'focus' ? ' fast' : ''}${listening ? ' hot' : ''}`}
            aria-hidden="true"
          />
          <div
            ref={orbRef}
            className={`nomi-orb${blink ? ' blink' : ''}${paused ? ' paused' : ''}${
              bubble && !chatOpen ? ' glow' : ''
            }${moodClass}${stretching ? ' stretching' : ''}${aqua ? ' aqua' : ''}${hop ? ' hop' : ''}${
              speaking ? ' speaking' : ''
            }${listening ? ' listening' : ''}${thinking ? ' thinking' : ''}${
              taskFx ? ` fx-${taskFx}` : ''
            }${orbTheme && orbTheme !== 'aurora' ? ` theme-${orbTheme}` : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="img"
            aria-label="Nomi"
          >
            <span className="nomi-aura" aria-hidden="true" />
            {timerText ? (
              <div className="nomi-timer" aria-label={`Focus timer: ${timerText} remaining`}>
                {timerText}
              </div>
            ) : (
              <div className="nomi-eyes" ref={eyesRef} aria-hidden="true">
                <span className="nomi-eye" />
                <span className="nomi-eye" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
