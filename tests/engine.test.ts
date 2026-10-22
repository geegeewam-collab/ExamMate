import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderEngine } from '../src/lib/engine';
import { FakeClock, FakeSpeech, OPTS } from './helpers';

const make = (o = {}) => {
  const clock = new FakeClock(), speech = new FakeSpeech();
  const e = new ReaderEngine(speech, clock, { ...OPTS, ...o });
  return { e, clock, speech };
};

test('reads every phrase in order, with a gap of gapS + words * pw, then finishes', () => {
  const { e, clock, speech } = make();
  assert.equal(e.start('One two, three.', 0), true);
  assert.equal(speech.last, 'One two,');
  assert.equal(e.getSnapshot().state, 'playing');

  speech.finish(); // gap = 2 + 2*0.5 = 3s
  let s = e.getSnapshot();
  assert.equal(s.phase, 'write');
  assert.equal(s.gapMs, 3000);
  assert.equal(s.gapEndsAt, clock.now() + 3000);
  clock.advance(2999);
  assert.equal(speech.spoken.length, 1);
  clock.advance(1);
  assert.equal(speech.last, 'three.');
  assert.equal(e.getSnapshot().idx, 1);

  speech.finish();
  clock.advance(10_000);
  s = e.getSnapshot();
  assert.equal(s.finished, true);
  assert.equal(s.state, 'idle');
  assert.equal(s.phase, 'done');
  assert.equal(speech.spoken.length, 2, 'nothing spoken after the end');
});

test('uses live rate and voice options', () => {
  const { e, speech } = make();
  e.setOptions({ rate: 0.8, voice: 'v1' });
  e.start('Hello there.');
  assert.deepEqual([speech.spoken[0].rate, speech.spoken[0].voiceURI], [0.8, 'v1']);
});

test('start with empty or blank text does nothing', () => {
  const { e, speech } = make();
  assert.equal(e.start('   '), false);
  assert.equal(speech.spoken.length, 0);
  assert.equal(e.getSnapshot().active, false);
});

test('read twice: second pass has half the gap (min 1s)', () => {
  const { e, clock, speech } = make({ twice: true });
  e.start('Alpha beta.');
  speech.finish(); // gap = 2 + 2*0.5 = 3
  assert.equal(e.getSnapshot().gapMs, 3000);
  clock.advance(3000);
  assert.equal(speech.spoken.length, 2);
  assert.equal(speech.spoken[1].text, 'Alpha beta.');
  assert.equal(e.getSnapshot().idx, 0);
  speech.finish();
  assert.equal(e.getSnapshot().gapMs, 1500);
  clock.advance(1500);
  assert.equal(e.getSnapshot().finished, true);
});

test('tap mode waits for tap()', () => {
  const { e, clock, speech } = make({ advance: 'tap', mode: 'w2' });
  e.start('a b c d');
  speech.finish();
  assert.equal(e.getSnapshot().phase, 'tap');
  clock.advance(60_000);
  assert.equal(speech.spoken.length, 1);
  e.tap();
  assert.equal(speech.last, 'c d');
  e.tap(); // nothing waiting: ignored
  assert.equal(speech.spoken.length, 2);
});

test('pause ignores late speech events; resume re-reads the current phrase', () => {
  const { e, clock, speech } = make();
  e.start('One. Two. Three.', 0);
  e.pause();
  assert.equal(e.getSnapshot().state, 'paused');
  speech.finish(); // late onend from the cancelled utterance
  clock.advance(10_000);
  assert.equal(speech.spoken.length, 1);
  e.resume();
  assert.equal(speech.spoken.length, 2);
  assert.equal(speech.last, 'One.');
  assert.equal(e.getSnapshot().state, 'playing');
});

test('toggle pauses, resumes, and re-reads from the top after finishing', () => {
  const { e, speech } = make({ gapS: 0, pw: 0 });
  e.start('Only one.');
  e.toggle();
  assert.equal(e.getSnapshot().state, 'paused');
  e.toggle();
  assert.equal(e.getSnapshot().state, 'playing');
  speech.finish();
  const clock = (e as any).clock as FakeClock;
  clock.advance(1);
  assert.equal(e.getSnapshot().finished, true);
  e.toggle();
  assert.equal(e.getSnapshot().finished, false);
  assert.equal(e.getSnapshot().state, 'playing');
  assert.equal(speech.last, 'Only one.');
});

test('next, back and repeat; back clamps at the start, next past the end finishes', () => {
  const { e, speech } = make({ mode: 'sentence' });
  e.start('A. B. C.');
  e.next();
  assert.equal(speech.last, 'B.');
  e.back();
  e.back();
  assert.equal(speech.last, 'A.');
  assert.equal(e.getSnapshot().idx, 0);
  e.repeat();
  assert.equal(speech.spoken.filter((s) => s.text === 'A.').length, 4);
  e.jump(2);
  assert.equal(speech.last, 'C.');
  e.next();
  assert.equal(e.getSnapshot().finished, true);
});

test('jumpToLine starts at the first phrase of that question', () => {
  const { e, speech } = make();
  e.start('Q1. One.\nQ2. Two, three.\nQ3. Four.');
  e.jumpToLine(1);
  assert.equal(speech.last, 'Q2.');
  assert.equal(e.getSnapshot().idx, 2);
  e.jumpToLine(9); // nonexistent: ignored
  assert.equal(speech.last, 'Q2.');
});

test('start countdown speaks nothing until it reaches zero', () => {
  const { e, clock, speech } = make({ lead: 3 });
  e.start('Go now.');
  assert.equal(speech.primed, 1);
  assert.equal(e.getSnapshot().state, 'counting');
  assert.equal(e.getSnapshot().countdown, 3);
  clock.advance(1000);
  assert.equal(e.getSnapshot().countdown, 2);
  clock.advance(1000);
  assert.equal(e.getSnapshot().countdown, 1);
  assert.equal(speech.spoken.length, 0);
  clock.advance(1000);
  assert.equal(speech.last, 'Go now.');
  assert.equal(e.getSnapshot().state, 'playing');
});

test('stop during countdown cancels everything', () => {
  const { e, clock, speech } = make({ lead: 3 });
  e.start('Go now.');
  e.stop();
  clock.advance(10_000);
  assert.equal(speech.spoken.length, 0);
  assert.equal(e.getSnapshot().active, false);
  assert.equal(clock.pending, 0);
});

test('a real speech error skips ahead after 400ms; "interrupted" is ignored', () => {
  const { e, clock, speech } = make({ mode: 'sentence' });
  e.start('A. B.');
  speech.fail('interrupted');
  clock.advance(1000);
  assert.equal(speech.spoken.length, 1);
  speech.fail('synthesis-failed');
  clock.advance(399);
  assert.equal(speech.spoken.length, 1);
  clock.advance(1);
  assert.equal(speech.last, 'B.');
});

test('shows a hint when the voice never starts, clears it once it does', () => {
  const { e, clock, speech } = make();
  speech.autoStart = false;
  e.start('Silent.');
  clock.advance(3499);
  assert.equal(e.getSnapshot().hint, '');
  clock.advance(1);
  assert.match(e.getSnapshot().hint, /No sound/);
});

test('no hint when the voice starts normally', () => {
  const { e, clock } = make();
  e.start('Fine.');
  clock.advance(10_000);
  assert.equal(e.getSnapshot().hint, '');
});

test('say punctuation option', () => {
  const { e, speech } = make({ punct: true });
  e.start('Hello, world.');
  assert.match(speech.last!, /comma/);
});

test('subscribers are notified; unsubscribe works; destroy keeps subscribers', () => {
  const { e, speech } = make();
  let n = 0;
  const off = e.subscribe(() => n++);
  e.start('A.');
  assert.ok(n > 0);
  const seen = n;
  off();
  speech.finish();
  assert.equal(n, seen);
  let m = 0;
  e.subscribe(() => m++);
  e.destroy();
  e.start('B.');
  assert.ok(m > 0, 'still notifies after destroy (StrictMode remount)');
});

test('restarting while reading ignores the old session', () => {
  const { e, clock, speech } = make({ mode: 'sentence' });
  e.start('Old one. Old two.');
  speech.finish();
  e.start('New one.');
  clock.advance(10_000);
  assert.equal(speech.last, 'New one.');
  assert.equal(e.getSnapshot().phrases.length, 1);
});
