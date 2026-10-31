import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMediaAction, type MediaHandlers } from '../src/lib/platform';

function makeHandlers() {
  const calls: string[] = [];
  const handlers: MediaHandlers = {
    active: () => true,
    hasText: () => true,
    startFromText: () => calls.push('start'),
    toggle: () => calls.push('toggle'),
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    next: () => calls.push('next'),
    back: () => calls.push('back'),
    repeat: () => calls.push('repeat'),
    ask: () => calls.push('ask'),
    askOnPlayPause: () => false,
    isPlaying: () => true,
  };
  return { handlers, calls };
}

test('native and browser media actions map to deterministic reader commands', () => {
  const { handlers, calls } = makeHandlers();
  const actions: Array<[string, string]> = [
    ['play', 'play'], ['pause', 'pause'], ['toggle', 'toggle'],
    ['next', 'next'], ['nexttrack', 'next'], ['fastforward', 'next'], ['seekforward', 'next'],
    ['previous', 'back'], ['previoustrack', 'back'], ['back', 'back'],
    ['rewind', 'repeat'], ['seekbackward', 'repeat'], ['repeat', 'repeat'],
  ];
  for (const [input, expected] of actions) {
    routeMediaAction(input, handlers);
    assert.equal(calls.at(-1), expected, `${input} should map to ${expected}`);
  }
});

test('play starts from the editor when no reader session is active', () => {
  const { handlers, calls } = makeHandlers();
  handlers.active = () => false;
  routeMediaAction('play', handlers);
  assert.deepEqual(calls, ['start']);
});

test('toggle starts from the editor when no reader session is active', () => {
  const { handlers, calls } = makeHandlers();
  handlers.active = () => false;
  routeMediaAction('toggle', handlers);
  assert.deepEqual(calls, ['start']);
});

test('headset play/pause opens Ask while reading when the shortcut is enabled', () => {
  const { handlers, calls } = makeHandlers();
  handlers.askOnPlayPause = () => true;
  routeMediaAction('pause', handlers);
  routeMediaAction('play', handlers);
  routeMediaAction('toggle', handlers);
  routeMediaAction('playpause', handlers);
  assert.deepEqual(calls, ['ask', 'ask', 'ask', 'ask']);
});

test('headset play starts the reader rather than Ask when no reading session exists', () => {
  const { handlers, calls } = makeHandlers();
  handlers.askOnPlayPause = () => true;
  handlers.active = () => false;
  routeMediaAction('play', handlers);
  assert.deepEqual(calls, ['start']);
});

test('headset play resumes normally when the reader is paused', () => {
  const { handlers, calls } = makeHandlers();
  handlers.askOnPlayPause = () => true;
  handlers.isPlaying = () => false;
  routeMediaAction('play', handlers);
  routeMediaAction('toggle', handlers);
  assert.deepEqual(calls, ['play', 'toggle']);
});

test('previous-track remains reader Back even when the Ask shortcut is enabled', () => {
  const { handlers, calls } = makeHandlers();
  handlers.askOnPlayPause = () => true;
  routeMediaAction('previoustrack', handlers);
  assert.deepEqual(calls, ['back']);
});

test('play/pause shortcut disabled retains normal reader controls', () => {
  const { handlers, calls } = makeHandlers();
  routeMediaAction('pause', handlers);
  routeMediaAction('toggle', handlers);
  routeMediaAction('play', handlers);
  assert.deepEqual(calls, ['pause', 'toggle', 'play']);
});

test('play/pause safely falls back to pause if Ask handler is unavailable', () => {
  const { handlers, calls } = makeHandlers();
  handlers.askOnPlayPause = () => true;
  handlers.ask = undefined;
  routeMediaAction('pause', handlers);
  assert.deepEqual(calls, ['pause']);
});
