import type { Clock } from './engine';

export interface UpdateInfo {
  version: string;
  apkUrl: string;
  releaseUrl: string;
  size: number | null;
}

export type CheckResult = { state: 'available'; update: UpdateInfo } | { state: 'current' } | { state: 'failed' };

export interface Snooze { version: string; until: number }
export interface SnoozeStore { get(): Snooze | null; set(s: Snooze | null): void }

/** Result of a check the person asked for from Settings. */
export type Manual = 'idle' | 'checking' | 'current' | 'failed';

export interface UpdateSnapshot {
  /** The newest update known to exist, even while its prompt is snoozed. */
  update: UpdateInfo | null;
  /** True when the update dialog should be on screen. */
  prompt: boolean;
  manual: Manual;
}

export const RECHECK_MS = 6 * 60 * 60_000; // while the app stays open
export const FOREGROUND_GAP_MS = 30 * 60_000; // when the app comes back to the front
export const SNOOZE_LATER_MS = 24 * 60 * 60_000; // after "Later"
export const SNOOZE_STARTED_MS = 60 * 60_000; // after "Update Now", while the download and install happen

/**
 * Decides when to look for a new version and when to tell the person about it. No React and no network in here:
 * the check, the clock and the "remind me later" storage are handed in, so the rules can be tested directly.
 *
 * - start(): checks now, then every 6 hours while the app is open.
 * - foreground(): checks when the app returns to the front, at most every 30 minutes.
 * - A prompt is not repeated for the same version after "Later" (24 h) or "Update Now" (1 h). A newer version always prompts.
 * - checkNow(): the person asked, so the answer is always shown and any snooze is ignored.
 */
export class UpdateController {
  private snap: UpdateSnapshot = { update: null, prompt: false, manual: 'idle' };
  private subs = new Set<() => void>();
  private timer: unknown = null;
  private running = false;
  private lastAt = 0;
  private inflight: Promise<CheckResult> | null = null;

  constructor(
    private readonly check: () => Promise<CheckResult>,
    private readonly clock: Clock,
    private readonly snooze: SnoozeStore,
  ) {}

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
  getSnapshot = () => this.snap;

  start() {
    if (this.running) return;
    this.running = true;
    void this.auto();
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  foreground() {
    if (this.running && this.clock.now() - this.lastAt >= FOREGROUND_GAP_MS) void this.auto();
  }

  async checkNow() {
    this.set({ manual: 'checking' });
    this.apply(await this.run(), true);
  }

  /** "Later": do not ask again about this version for a day. */
  later() {
    this.remember(SNOOZE_LATER_MS);
    this.set({ prompt: false });
  }

  /** "Update Now" was tapped: the download is starting, so do not ask again for a little while. The dialog stays until closed. */
  started() {
    this.remember(SNOOZE_STARTED_MS);
  }

  /** Close the dialog without changing any reminder. */
  close() {
    this.set({ prompt: false });
  }

  private remember(ms: number) {
    const u = this.snap.update;
    if (u) this.snooze.set({ version: u.version, until: this.clock.now() + ms });
  }

  private isSnoozed(version: string) {
    const s = this.snooze.get();
    const now = this.clock.now();
    // An "until" further away than the longest snooze can only come from a wrong phone clock: ignore it.
    return !!s && s.version === version && s.until > now && s.until - now <= SNOOZE_LATER_MS;
  }

  private schedule() {
    this.timer = this.clock.setTimeout(() => {
      if (!this.running) return;
      void this.auto();
      this.schedule();
    }, RECHECK_MS);
  }

  private async auto() {
    const r = await this.run();
    if (this.running) this.apply(r, false);
  }

  private run(): Promise<CheckResult> {
    if (this.inflight) return this.inflight;
    this.lastAt = this.clock.now();
    const p = this.check()
      .catch((): CheckResult => ({ state: 'failed' }))
      .finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }

  private apply(r: CheckResult, manual: boolean) {
    if (r.state === 'available') {
      // A dialog that is already open for this version stays open (it may be showing the install steps).
      const open = this.snap.prompt && this.snap.update?.version === r.update.version;
      this.set({ update: r.update, prompt: manual || open || !this.isSnoozed(r.update.version), manual: manual ? 'idle' : this.snap.manual });
    } else if (r.state === 'current') {
      this.set({ update: null, prompt: false, manual: manual ? 'current' : this.snap.manual });
    } else if (manual) {
      this.set({ manual: 'failed' });
    }
  }

  private set(p: Partial<UpdateSnapshot>) {
    const next = { ...this.snap, ...p };
    if (next.update === this.snap.update && next.prompt === this.snap.prompt && next.manual === this.snap.manual) return;
    this.snap = next;
    this.subs.forEach((fn) => fn());
  }
}
