import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './helpers';
import {
  FOREGROUND_GAP_MS, RECHECK_MS, SNOOZE_LATER_MS, SNOOZE_STARTED_MS, UpdateController,
  type CheckResult, type Snooze, type SnoozeStore, type UpdateInfo,
} from '../src/lib/update-controller';

const info = (version: string): UpdateInfo => ({ version, apkUrl: `https://github.com/a/b/releases/download/v${version}/ExamMate.apk`, releaseUrl: `https://github.com/a/b/releases/tag/v${version}`, size: 1000 });
const memorySnooze = (): SnoozeStore & { value: Snooze | null } => {
  const s = { value: null as Snooze | null, get() { return s.value; }, set(v: Snooze | null) { s.value = v; } };
  return s;
};
const setup = (first: CheckResult = { state: 'available', update: info('1.0.1') }) => {
  const clock = new FakeClock();
  const snooze = memorySnooze();
  const calls = { n: 0 };
  let next: CheckResult | (() => Promise<CheckResult>) = first;
  const check = async () => { calls.n++; return typeof next === 'function' ? next() : next; };
  const ctl = new UpdateController(check, clock, snooze);
  return { ctl, clock, snooze, calls, answer: (r: CheckResult | (() => Promise<CheckResult>)) => { next = r; } };
};
const settle = () => new Promise((r) => setImmediate(r));

test('opening the app checks straight away and shows the prompt when a newer version exists', async () => {
  const { ctl, calls } = setup();
  assert.equal(ctl.getSnapshot().prompt, false);
  ctl.start();
  await settle();
  assert.equal(calls.n, 1);
  assert.equal(ctl.getSnapshot().prompt, true);
  assert.equal(ctl.getSnapshot().update?.version, '1.0.1');
});

test('no prompt when the app is already current, and none when the check fails', async () => {
  const a = setup({ state: 'current' });
  a.ctl.start(); await settle();
  assert.equal(a.ctl.getSnapshot().prompt, false);
  const b = setup({ state: 'failed' });
  b.ctl.start(); await settle();
  assert.equal(b.ctl.getSnapshot().prompt, false);
  assert.equal(b.ctl.getSnapshot().manual, 'idle', 'a failed background check says nothing');
});

test('a check that throws is treated as failed, never as an unhandled error', async () => {
  const { ctl } = setup();
  const boom = new UpdateController(async () => { throw new Error('x'); }, new FakeClock(), memorySnooze());
  boom.start(); await settle();
  assert.equal(boom.getSnapshot().prompt, false);
  void ctl;
});

test('it checks again every 6 hours while the app stays open, and stops when stopped', async () => {
  const { ctl, clock, calls } = setup({ state: 'current' });
  ctl.start(); await settle();
  assert.equal(calls.n, 1);
  clock.advance(RECHECK_MS - 1); await settle();
  assert.equal(calls.n, 1);
  clock.advance(1); await settle();
  assert.equal(calls.n, 2);
  clock.advance(RECHECK_MS); await settle();
  assert.equal(calls.n, 3);
  ctl.stop();
  assert.equal(clock.pending, 0, 'no timer is left running');
  clock.advance(RECHECK_MS * 3); await settle();
  assert.equal(calls.n, 3);
});

test('a periodic check finds an update that appeared while the app was open', async () => {
  const { ctl, clock, answer } = setup({ state: 'current' });
  ctl.start(); await settle();
  answer({ state: 'available', update: info('1.0.2') });
  clock.advance(RECHECK_MS); await settle();
  assert.equal(ctl.getSnapshot().prompt, true);
  assert.equal(ctl.getSnapshot().update?.version, '1.0.2');
});

test('returning to the app checks again, but not more than every 30 minutes', async () => {
  const { ctl, clock, calls } = setup({ state: 'current' });
  ctl.start(); await settle();
  clock.advance(FOREGROUND_GAP_MS - 1000);
  ctl.foreground(); await settle();
  assert.equal(calls.n, 1);
  clock.advance(1000);
  ctl.foreground(); await settle();
  assert.equal(calls.n, 2);
  ctl.foreground(); await settle();
  assert.equal(calls.n, 2, 'just checked');
});

test('foreground does nothing before start or after stop', async () => {
  const { ctl, clock, calls } = setup({ state: 'current' });
  clock.advance(FOREGROUND_GAP_MS * 2);
  ctl.foreground(); await settle();
  assert.equal(calls.n, 0);
  ctl.start(); await settle(); ctl.stop();
  clock.advance(FOREGROUND_GAP_MS * 2);
  ctl.foreground(); await settle();
  assert.equal(calls.n, 1);
});

test('Later hides the prompt and the same version is not offered again for a day', async () => {
  const { ctl, clock, snooze } = setup();
  ctl.start(); await settle();
  ctl.later();
  assert.equal(ctl.getSnapshot().prompt, false);
  assert.equal(ctl.getSnapshot().update?.version, '1.0.1', 'the update is still known');
  assert.deepEqual(snooze.value, { version: '1.0.1', until: clock.now() + SNOOZE_LATER_MS });
  clock.advance(FOREGROUND_GAP_MS); ctl.foreground(); await settle();
  assert.equal(ctl.getSnapshot().prompt, false, 'still snoozed');
  clock.advance(SNOOZE_LATER_MS); ctl.foreground(); await settle();
  assert.equal(ctl.getSnapshot().prompt, true, 'a day later it asks again');
});

test('a snooze survives closing the app, but a newer version is offered immediately', async () => {
  const a = setup();
  a.ctl.start(); await settle(); a.ctl.later();
  const again = new UpdateController(async () => ({ state: 'available', update: info('1.0.1') }), a.clock, a.snooze);
  again.start(); await settle();
  assert.equal(again.getSnapshot().prompt, false, 'same version, still snoozed');
  const newer = new UpdateController(async () => ({ state: 'available', update: info('1.0.2') }), a.clock, a.snooze);
  newer.start(); await settle();
  assert.equal(newer.getSnapshot().prompt, true, 'a different version ignores the old snooze');
});

test('a snooze that lies far in the future (wrong phone clock) is ignored', async () => {
  const { ctl, clock, snooze } = setup();
  snooze.value = { version: '1.0.1', until: clock.now() + SNOOZE_LATER_MS * 30 };
  ctl.start(); await settle();
  assert.equal(ctl.getSnapshot().prompt, true);
});

test('Update Now keeps the dialog open for the install steps and snoozes for an hour; closing does not change that', async () => {
  const { ctl, clock, snooze } = setup();
  ctl.start(); await settle();
  ctl.started();
  assert.equal(ctl.getSnapshot().prompt, true, 'dialog stays up');
  assert.deepEqual(snooze.value, { version: '1.0.1', until: clock.now() + SNOOZE_STARTED_MS });
  clock.advance(FOREGROUND_GAP_MS); ctl.foreground(); await settle();
  assert.equal(ctl.getSnapshot().prompt, true, 'a background re-check does not pull the dialog away mid-install');
  ctl.close();
  assert.equal(ctl.getSnapshot().prompt, false);
  assert.equal(snooze.value!.until, clock.now() - FOREGROUND_GAP_MS + SNOOZE_STARTED_MS);
  clock.advance(SNOOZE_STARTED_MS); ctl.foreground(); await settle();
  assert.equal(ctl.getSnapshot().prompt, true, 'if the update never got installed, it asks again after the hour');
});

test('after the app is updated the new version is current and nothing is shown', async () => {
  const { ctl, answer } = setup();
  ctl.start(); await settle();
  assert.equal(ctl.getSnapshot().prompt, true);
  answer({ state: 'current' });
  ctl.stop(); ctl.start(); await settle();
  assert.equal(ctl.getSnapshot().prompt, false);
  assert.equal(ctl.getSnapshot().update, null);
});

test('Check for updates: current, failed, and found (which ignores a snooze)', async () => {
  const { ctl, answer } = setup({ state: 'current' });
  await ctl.checkNow();
  assert.equal(ctl.getSnapshot().manual, 'current');
  answer({ state: 'failed' });
  await ctl.checkNow();
  assert.equal(ctl.getSnapshot().manual, 'failed');
  answer({ state: 'available', update: info('1.0.1') });
  await ctl.checkNow();
  assert.equal(ctl.getSnapshot().manual, 'idle');
  assert.equal(ctl.getSnapshot().prompt, true);
  ctl.later();
  await ctl.checkNow();
  assert.equal(ctl.getSnapshot().prompt, true, 'the person asked, so it is shown even though they said Later');
});

test('Check for updates shows "checking" while waiting, and two checks at once make one request', async () => {
  let release!: (r: CheckResult) => void;
  const { ctl, calls, answer } = setup({ state: 'current' });
  answer(() => new Promise<CheckResult>((res) => { release = res; }));
  const a = ctl.checkNow();
  const b = ctl.checkNow();
  assert.equal(ctl.getSnapshot().manual, 'checking');
  release({ state: 'current' });
  await Promise.all([a, b]);
  assert.equal(calls.n, 1);
  assert.equal(ctl.getSnapshot().manual, 'current');
});

test('subscribers are told about changes, and not about no-ops', async () => {
  const { ctl } = setup();
  let n = 0;
  const off = ctl.subscribe(() => n++);
  ctl.start(); await settle();
  assert.equal(n, 1);
  ctl.close(); assert.equal(n, 2);
  ctl.close(); assert.equal(n, 2, 'closing twice changes nothing');
  off();
  ctl.later();
  assert.equal(n, 2, 'unsubscribed');
});
