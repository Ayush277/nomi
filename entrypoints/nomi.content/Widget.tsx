import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../lib/types';

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
const DEFAULT_POS: Pos = { right: 24, bottom: 24 };
const BUBBLE_LIFETIME_MS = 8000;
const GAZE_TRAVEL_PX = 4;

const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Widget() {
  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [blink, setBlink] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const orbRef = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; origin: Pos; moved: boolean } | null>(null);

  // Initial state + follow changes from background/settings.
  useEffect(() => {
    chrome.storage.local.get([POS_KEY, SETTINGS_KEY]).then((stored) => {
      if (stored[POS_KEY]) setPos(stored[POS_KEY]);
      setPaused(Boolean(stored[SETTINGS_KEY]?.paused));
    });
    chrome.storage.session.get([BUBBLE_KEY, CHAT_KEY]).then((stored) => {
      if (stored[BUBBLE_KEY]) setBubble(stored[BUBBLE_KEY]);
      if (stored[CHAT_KEY]) setMessages(stored[CHAT_KEY]);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[BUBBLE_KEY]) setBubble(changes[BUBBLE_KEY].newValue ?? null);
      if (area === 'session' && changes[CHAT_KEY]) setMessages(changes[CHAT_KEY].newValue ?? []);
      if (area === 'local' && changes[SETTINGS_KEY]) {
        setPaused(Boolean(changes[SETTINGS_KEY].newValue?.paused));
      }
      if (area === 'local' && changes[POS_KEY]?.newValue) setPos(changes[POS_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const closeBubble = useCallback((b: Bubble, reason: 'dismissed' | 'expired') => {
    setBubble(null);
    void chrome.runtime.sendMessage({ type: 'nomi:bubbleClosed', id: b.id, reason }).catch(() => {});
  }, []);

  // Bubbles dissolve on their own; never more than one exists (DESIGN.md).
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => closeBubble(bubble, 'expired'), BUBBLE_LIFETIME_MS);
    return () => clearTimeout(t);
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
    if (Math.hypot(dx, dy) > 5) d.moved = true;
    if (d.moved) {
      setPos(clampPos({ right: d.origin.right - dx, bottom: d.origin.bottom - dy }));
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      setPos((p) => {
        void chrome.storage.local.set({ [POS_KEY]: p });
        return p;
      });
    } else if (bubble) {
      closeBubble(bubble, 'dismissed');
    } else {
      setChatOpen((open) => !open);
    }
  }, [bubble, closeBubble]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || thinking) return;
      setDraft('');
      const withUser: ChatMessage[] = [...messages, { role: 'user', text: q, ts: Date.now() }];
      setMessages(withUser);
      void chrome.storage.session.set({ [CHAT_KEY]: withUser });
      setThinking(true);
      let reply = "Hmm, I lost my train of thought — try that again?";
      try {
        const res = await chrome.runtime.sendMessage({ type: 'nomi:chat', text: q, history: messages });
        if (res?.text) reply = res.text;
      } catch {}
      const withReply: ChatMessage[] = [...withUser, { role: 'nomi', text: reply, ts: Date.now() }];
      setThinking(false);
      setMessages(withReply);
      void chrome.storage.session.set({ [CHAT_KEY]: withReply });
    },
    [messages, thinking],
  );

  return (
    <div className={`nomi-root${reducedMotion ? ' reduced' : ''}`}>
      <div className="nomi-anchor" style={{ right: `${pos.right}px`, bottom: `${pos.bottom}px` }}>
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
                  Hey. Ask me anything — like "how's today going?" or "when did I last open leetcode?"
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
                placeholder="Say something…"
                aria-label="Message Nomi"
              />
            </form>
          </div>
        )}

        <div
          ref={orbRef}
          className={`nomi-orb${blink ? ' blink' : ''}${paused ? ' paused' : ''}`}
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
