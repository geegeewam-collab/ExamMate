let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const C = window.AudioContext || (window as any).webkitAudioContext;
  if (!C) return null;
  try {
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, when = 0, vol = 0.12, type: OscillatorType = 'sine') {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

/** The "ding" that says "I'm listening", plus a soft two-note "done" and a low "didn't work". */
export const tones = {
  ding: () => tone(880, 0.5),
  dong: () => { tone(660, 0.18); tone(523, 0.3, 0.16, 0.1); },
  error: () => tone(220, 0.3, 0, 0.12, 'triangle'),
};
