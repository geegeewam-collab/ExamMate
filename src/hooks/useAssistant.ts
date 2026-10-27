import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { realClock, type ReaderEngine, type Snapshot } from '../lib/engine';
import { createSpeech, deviceLang } from '../lib/platform';
import type { Settings } from '../lib/settings';
import { DEFAULT_OPTIONS, VoiceAssistant, type AskContext, type AssistantSnapshot } from '../lib/voice/assistant';
import { haptics } from '../lib/voice/haptics';
import { createRecognizer, type Recognizer } from '../lib/voice/recognizer';
import { tones } from '../lib/voice/tones';
import { wakePhrase } from '../lib/voice/wake';
import { askQuestion } from '../services/ask-service';

interface Args {
  settings: Settings;
  engine: ReaderEngine;
  snap: Snapshot;
  getContext(): AskContext;
  setRate(rate: number): void;
  onAnswered(question: string, answer: string): void;
  onLicenseLost(): void;
}

/** Connects the voice assistant to the reader, the speech engine and the server. */
export function useAssistant(a: Args): { assistant: VoiceAssistant; state: AssistantSnapshot } {
  const live = useRef(a);
  useEffect(() => { live.current = a; });

  const [recognizer, setRecognizer] = useState<Recognizer | null>(null);
  useEffect(() => {
    if (!a.settings.assist) { setRecognizer(null); return; }
    let dead = false;
    void createRecognizer(deviceLang()).then((r) => { if (!dead) setRecognizer(r); });
    return () => { dead = true; };
  }, [a.settings.assist]);

  const speech = useMemo(() => createSpeech(), []);
  const { engine } = a;

  const assistant = useMemo(() => new VoiceAssistant({
    recognizer,
    clock: realClock,
    reader: {
      isPlaying: () => { const s = engine.getSnapshot().state; return s === 'playing' || s === 'counting'; },
      pause: () => engine.pause(),
      resume: () => engine.resume(),
      repeat: () => engine.repeat(),
      next: () => engine.next(),
      back: () => engine.back(),
      stop: () => engine.stop(),
      slower: () => live.current.setRate(Math.max(0.1, live.current.settings.rate - 0.1)),
      faster: () => live.current.setRate(Math.min(1.2, live.current.settings.rate + 0.1)),
    },
    speak: (text) => new Promise<void>((resolve) => {
      const safety = setTimeout(resolve, Math.max(6000, text.length * 110)); // never leave the reader stuck if speech fails silently
      const done = () => { clearTimeout(safety); resolve(); };
      speech.speak(text, { rate: 0.95, voiceURI: live.current.settings.voice }, { onstart: () => {}, onend: done, onerror: done });
    }),
    cancelSpeech: () => speech.cancel(),
    ask: (q, ctx) => askQuestion(q, ctx),
    context: () => live.current.getContext(),
    tones,
    haptics,
    onAnswered: (q, ans) => live.current.onAnswered(q, ans),
    onLicenseLost: () => live.current.onLicenseLost(),
  }, { ...DEFAULT_OPTIONS, wakePhrase: wakePhrase(a.settings.wake, a.settings.wakeCustom) }), [recognizer, engine, speech]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    assistant.setOptions({ wakePhrase: wakePhrase(a.settings.wake, a.settings.wakeCustom) });
  }, [assistant, a.settings.wake, a.settings.wakeCustom]);

  /* the microphone is only used while a reading session is open and the app is on screen */
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const active = a.settings.assist && !!recognizer && a.snap.active && !a.snap.finished && visible;
  useEffect(() => {
    if (active) void assistant.enable({ wake: a.settings.wakeListen });
    else void assistant.disable();
  }, [assistant, active, a.settings.wakeListen]);
  useEffect(() => () => { void assistant.disable(); }, [assistant]);

  const state = useSyncExternalStore(assistant.subscribe, assistant.getSnapshot, assistant.getSnapshot);
  return { assistant, state };
}
