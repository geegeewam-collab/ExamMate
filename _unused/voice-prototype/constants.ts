export const TIMING_CONFIG = {
  DEFAULT_RATE: 0.5,
  DEFAULT_GAP: 2.0,
  DEFAULT_PW: 0.75,
  VAD_SILENCE_THRESHOLD: 1500, // ms
};

export function calculateGap(gapS: number, wordCount: number, pw: number): number {
  return gapS + (wordCount * pw);
}
