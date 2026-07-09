import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, MoodState } from '../../lib/types';

interface Bubble {
  id: string;
  text: string;
}

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

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const SpeechRec: SpeechRecognitionCtor | undefined =
  (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;

export function Widget() {
  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [blink, setBlink] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [mood, setMood] = useState<MoodState>({ kind: 'idle' });
  const [chatOpen, setChatOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const orbRef = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const drag = useRef<{ startX: number; startY: number; origin: Pos; moved: boolean } | null>(null);

  // Initial state + follow changes from background/settings.
  useEffect(() => {
    chrome.storage.local.get([POS_KEY, SETTINGS_KEY]).then((stored) => {
      if (stored[POS_KEY]) setPos(stored[POS_KEY]);
      setPaused(Boolean(stored[SETTINGS_KEY]?.paused));
      setVoiceOn(stored[SETTINGS_KEY]?.voice ?? true);
    });
    chrome.storage.session.get([BUBBLE_KEY, CHAT_KEY, MOOD_KEY]).then((stored) => {
      if (stored[BUBBLE_KEY]) setBubble(stored[BUBBLE_KEY]);
      if (stored[CHAT_KEY]) setMessages(stored[CHAT_KEY]);
      if (stored[MOOD_KEY]) setMood(stored[MOOD_KEY]);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[BUBBLE_KEY]) setBubble(changes[BUBBLE_KEY].newValue ?? null);
      if (area === 'session' && changes[CHAT_KEY]) setMessages(changes[CHAT_KEY].newValue ?? []);
      if (area === 'session' && changes[MOOD_KEY]?.newValue) setMood(changes[MOOD_KEY].newValue);
      if (area === 'session' && changes[OPEN_CHAT_KEY]?.newValue) {
        // Keyboard shortcut: only the tab the user is looking at responds.
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          setChatOpen(true);
          if (changes[OPEN_CHAT_KEY].newValue.voice) startListening();
        }
      }
      if (area === 'local' && changes[SETTINGS_KEY]) {
        setPaused(Boolean(changes[SETTINGS_KEY].newValue?.paused));
        setVoiceOn(changes[SETTINGS_KEY].newValue?.voice ?? true);
      }
      if (area === 'local' && changes[POS_KEY]?.newValue) setPos(changes[POS_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Celebrations wind down on their own.
  useEffect(() => {
    if (mood.kind !== 'celebrate' || !mood.until) return;
    const t = setTimeout(() => setMood({ kind: 'idle' }), Math.max(0, mood.until - Date.now()));
    return () => clearTimeout(t);
  }, [mood]);

  const closeBubble = useCallback((b: Bubble, reason: 'dismissed' | 'expired') => {
    setBubble(null);
    speechSynthesis?.cancel();
    void chrome.runtime.sendMessage({ type: 'nomi:bubbleClosed', id: b.id, reason }).catch(() => {});
  }, []);

  // Bubbles dissolve on their own; never more than one exists (DESIGN.md).
  // If voice is on, the focused tab reads it aloud — local system voices only.
  useEffect(() => {
    if (!bubble) return;
    if (voiceOn && document.visibilityState === 'visible' && document.hasFocus() && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(bubble.text);
      u.rate = 1.03;
      u.pitch = 1.08;
      u.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
    const t = setTimeout(() => closeBubble(bubble, 'expired'), BUBBLE_LIFETIME_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble?.id]);

  // Blink every 4–8s.
  useEffect(() => {
    if (reducedMotion) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 4000 + Math.random() * 4000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Gaze: eyes drift a few px toward the cursor — glancing, not tracking.
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

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || thinking) return;
      setDraft('');
      const withUser: ChatMessage[] = [...messages, { role: 'user', text: q, ts: Date.now() }];
      setMessages(withUser);
      void chrome.storage.session.set({ [CHAT_KEY]: withUser });
      setThinking(true);
      let reply = 'Hmm, I lost my train of thought — try that again?';
      try {
        const res = await chrome.runtime.sendMessage({ type: 'nomi:chat', text: q, history: messages });
        if (res?.text) reply = res.text;
      } catch {}
      const withReply: ChatMessage[] = [...withUser, { role: 'nomi', text: reply, ts: Date.now() }];
      setThinking(false);
      setMessages(withReply);
      void chrome.storage.session.set({ [CHAT_KEY]: withReply });
      if (voiceOn && 'speechSynthesis' in window && document.hasFocus()) {
        const u = new SpeechSynthesisUtterance(reply);
        u.rate = 1.03;
        u.pitch = 1.08;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    },
    [messages, thinking, voiceOn],
  );

  const startListening = useCallback(() => {
    if (!SpeechRec) {
      setChatOpen(true);
      setMessages((prev) => {
        if (prev[prev.length - 1]?.text.includes('voice input')) return prev;
        return [
          ...prev,
          {
            role: 'nomi',
            text: "This browser doesn't offer voice input, so type to me instead — I'm listening either way.",
            ts: Date.now(),
          },
        ];
      });
      return;
    }
    if (recRef.current) return; // already listening
    const rec = new SpeechRec();
    recRef.current = rec;
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) void send(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

  const clampPos = (p: Pos): Pos => ({
    right: Math.min(Math.max(p.right, 8), Math.max(window.innerWidth - 140, 8)),
    bottom: Math.min(Math.max(p.bottom, 8), Math.max(window.innerHeight - 140, 8)),
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
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
        void chrome.storage.local.set({ [POS_KEY]: snapped });
        return snapped;
      });
    } else if (bubble) {
      closeBubble(bubble, 'dismissed');
    } else {
      setChatOpen((open) => !open);
    }
  }, [bubble, closeBubble]);

  const moodClass =
    mood.kind === 'celebrate' ? ' celebrate' : mood.kind === 'focus' ? ' focusing' : '';

  return (
    <div className={`nomi-root${reducedMotion ? ' reduced' : ''}`}>
      <div
        className={`nomi-anchor${dragging ? ' drag-live' : ''}`}
        style={{ right: `${pos.right}px`, bottom: `${pos.bottom}px` }}
      >
        {bubble && !chatOpen && (
          <div className="nomi-bubble" onClick={() => closeBubble(bubble, 'dismissed')}>
            {bubble.text}
          </div>
        )}

        {chatOpen && (
          <div className="nomi-chat">
            <div className="nomi-chat-head">
              <span>Nomi</span>
              <button className="nomi-chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">
                ×
              </button>
            </div>
            <div className="nomi-chat-list" ref={listRef}>
              {messages.length === 0 && (
                <div className="nomi-msg nomi">
                  Hey. Ask me anything — "how's today going?", "when did I last open leetcode?", or
                  "remind me to stretch in 20 minutes".
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`nomi-msg ${m.role}`}>
                  {m.text}
                </div>
              ))}
              {thinking && <div className="nomi-msg nomi nomi-thinking">…</div>}
            </div>
            <div className="nomi-chips">
              <button onClick={() => send("How's today going?")}>Today?</button>
              <button onClick={() => send('When did I last open leetcode?')}>Last seen…</button>
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
                placeholder={listening ? 'Listening…' : 'Say something…'}
                aria-label="Message Nomi"
              />
              <button
                type="button"
                className={`nomi-mic${listening ? ' live' : ''}`}
                aria-label="Voice input"
                title="Voice input (Alt+Shift+N from anywhere)"
                onClick={() => (listening ? recRef.current?.stop() : startListening())}
              >
                ●
              </button>
            </form>
          </div>
        )}

        <div
          ref={orbRef}
          className={`nomi-orb${blink ? ' blink' : ''}${paused ? ' paused' : ''}${
            bubble && !chatOpen ? ' glow' : ''
          }${moodClass}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="img"
          aria-label="Nomi companion"
        >
          <div className="nomi-eyes" ref={eyesRef}>
            <div className="nomi-eye" />
            <div className="nomi-eye" />
          </div>
        </div>
      </div>
    </div>
  );
}
