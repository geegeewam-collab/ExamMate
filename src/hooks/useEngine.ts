import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { ReaderEngine, realClock, type EngineOptions, type Snapshot } from '../lib/engine';
import { createWebSpeech } from '../lib/platform';
import type { Settings } from '../lib/settings';

const toOptions = (s: Settings): EngineOptions => ({
  rate: s.rate, gapS: s.gapS, pw: s.pw, mode: s.mode, twice: s.twice, punct: s.punct,
  advance: s.advance, lead: s.lead, voice: s.voice,
});

export function useEngine(settings: Settings): [ReaderEngine, Snapshot] {
  const ref = useRef<ReaderEngine | null>(null);
  if (!ref.current) ref.current = new ReaderEngine(createWebSpeech(), realClock, toOptions(settings));
  const engine = ref.current;

  useEffect(() => {
    engine.setOptions(toOptions(settings));
  }, [engine, settings]);
  useEffect(() => () => engine.destroy(), [engine]);

  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  return [engine, snap];
}

/** Whole seconds left until `endsAt` (ms epoch). 0 when there is no gap running. */
export function useCountdown(endsAt: number): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
}
