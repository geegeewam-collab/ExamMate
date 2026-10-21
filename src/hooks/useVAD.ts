import { useState, useEffect, useRef } from 'react';

export function useVAD(onSilence: () => void, threshold: number = 0.02, silenceDuration: number = 1500) {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).WebAudioContext)();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsMonitoring(true);
      monitor();
    } catch (e) {
      console.error('VAD Error:', e);
    }
  };

  const monitor = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length / 255;

    if (average > threshold) {
      // User is speaking, reset silence timer
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    } else {
      // Silence detected, start timer
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          onSilence();
          stopMonitoring();
        }, silenceDuration);
      }
    }

    if (isMonitoring) {
      requestAnimationFrame(monitor);
    }
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
    }
  };

  return {
    isMonitoring,
    startMonitoring,
    stopMonitoring
  };
}
