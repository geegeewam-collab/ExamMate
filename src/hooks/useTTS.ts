import { useState, useEffect, useRef } from 'react';
import { TIMING_CONFIG, calculateGap } from '../lib/constants';
import { HapticPatterns } from '../lib/haptics';

export type PlaybackState = 'IDLE' | 'COUNTING' | 'PLAYING' | 'PAUSED' | 'INTERRUPTED';

interface TTSOptions {
  rate: number;
  gapS: number;
  pw: number;
  mode: string;
  twice: boolean;
  punct: boolean;
}

export function useTTS(phrases: string[], options: TTSOptions) {
  const [state, setState] = useState<PlaybackState>('IDLE');
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState('');
  const synth = useRef<SpeechSynthesis | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionRef = useRef(0);

  useEffect(() => {
    synth.current = window.speechSynthesis;
    return () => {
      if (synth.current) synth.current.cancel();
    };
  }, []);

  const stop = () => {
    if (synth.current) synth.current.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
    setState('IDLE');
  };

  const run = (index: number, pass: number = 1) => {
    if (index < 0) index = 0;
    if (index >= phrases.length) {
      finish();
      return;
    }

    setIdx(index);
    setState('PLAYING');
    const currentSession = ++sessionRef.current;

    if (synth.current) synth.current.cancel();

    let text = phrases[index];
    if (options.punct) {
      text = text.replace(/([,;:.?!])(?=\s|$)/g, m =>
        ' ' + ({',':'comma',';':'semicolon',':':'colon','.':'full stop','?':'question mark','!':'exclamation mark'}[m as string]) + ' '
      );
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate;

    utterance.onstart = () => {
      setProgress(`${index + 1} of ${phrases.length}`);
    };

    utterance.onend = () => {
      if (currentSession !== sessionRef.current || state !== 'PLAYING') return;

      const again = options.twice && pass === 1;
      let gap = calculateGap(options.gapS, phrases[index].split(/\s+/).length, options.pw);
      if (options.twice && pass === 2) gap = Math.max(1, gap / 2);

      const nextStep = () => run(again ? index : index + 1, again ? 2 : 1);

      timerRef.current = setTimeout(nextStep, gap * 1000);
    };

    synth.current?.speak(utterance);
  };

  const finish = () => {
    stop();
    setState('IDLE');
    setProgress(`${phrases.length} phrases read`);
  };

  const interrupt = () => {
    if (synth.current) synth.current.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
    setState('INTERRUPTED');
    return idx; // Return the current index to be resumed later
  };

  return {
    state,
    idx,
    progress,
    run,
    stop,
    interrupt,
    setState
  };
}
