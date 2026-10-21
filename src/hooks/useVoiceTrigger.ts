import { useState, useEffect, useRef } from 'react';
import { HapticPatterns } from '../lib/haptics';

// Extend the Window interface to include SpeechRecognition for TypeScript
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    WebAudioContext: any;
  }
}

export type TriggerMode = 'WAKE_WORD' | 'HOLD_DING';

export function useVoiceTrigger(onTrigger: (mode: TriggerMode) => void) {
  const [isListening, setIsListening] = useState(false);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('WAKE_WORD');
  const recognitionRef = useRef<any | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize Web Speech API
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript.toLowerCase().trim();

        // Check for Wake Word (simplified for now, to be integrated with custom recorded samples)
        if (text.includes('hey reader') || text.includes('exam mate')) {
          onTrigger('WAKE_WORD');
        }
      };

      recognitionRef.current = recognition;
    }
  }, [onTrigger]);

  const playDing = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).WebAudioContext)();
    }
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  const startHoldTrigger = () => {
    holdTimerRef.current = setTimeout(async () => {
      await HapticPatterns.triggerStart();
      await playDing();
      onTrigger('HOLD_DING');
    }, 3000);
  };

  const stopHoldTrigger = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }
  };

  const toggleListening = (active: boolean) => {
    if (!active) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error('Speech recognition already started');
      }
    }
  };

  return {
    isListening,
    toggleListening,
    startHoldTrigger,
    stopHoldTrigger
  };
}
