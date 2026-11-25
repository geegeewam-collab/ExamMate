import { kv } from './storage';

/** Compares dotted versions numerically: 2.1.10 is newer than 2.1.9. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The phone's local calendar day, e.g. 2026-11-25. */
export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export interface Snooze { version: string; day: string }
const SNOOZE_KEY = 'update_snooze';

/**
 * "Later" hides the prompt for the rest of the day, so the student is reminded on the first open of each new day.
 * A newer release than the one snoozed, or a required update, is shown straight away.
 */
export function shouldPrompt(version: string, required: boolean, day = localDay(), snooze = kv.get<Snooze | null>(SNOOZE_KEY, null)): boolean {
  if (required) return true;
  return !snooze || snooze.version !== version || snooze.day !== day;
}

export const snoozeUpdate = (version: string, day = localDay()) => kv.set(SNOOZE_KEY, { version, day } satisfies Snooze);
