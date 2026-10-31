import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeSpeech, openNativeSpeechInstall, type NativeTTS } from '../src/lib/platform';
import { ReaderEngine, NO_VOICE } from '../src/lib/engine';
import { FakeClock, FakeSpeech, OPTS } from './helpers';

const tick = () => new Promise<void>((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

function fakePlugin(over: Partial<NativeTTS> = {}) {
  const calls: string[] = [];
  const spoken: any[] = [];
  let finish: (() => void) | null = null;
  const plugin: NativeTTS = {
    isLanguageSupported: async ({ lang }) => { calls.push('lang:' + lang); return { supported: lang === 'en-US' || lang === 'en' }; },
    speak: (o) => { calls.push('speak'); spoken.push(o); return new Promise<void>((r) => { finish = r; }); },
    stop: async () => { calls.push('stop'); },
    ...over,
  };
  return { plugin, calls, spoken, done: () => finish?.() };
}
const handlers = () => {
  const ev: string[] = [];
  return { ev, h: { onstart: () => ev.push('start'), onend: () => ev.push('end'), onerror: (e: string) => ev.push('error:' + e) } };
};

test('native speech: speaks with the phone engine, flush strategy, and reports start and end', async () => {
  const f = fakePlugin(); const { ev, h } = handlers();
  const sp = createNativeSpeech(async () => f.plugin, ['en-KE', 'en', 'en-US']);
  sp.speak('Hello there.', { rate: 0.5, voiceURI: '' }, h);
  await settle();
  assert.deepEqual(ev, ['start']);
  assert.equal(f.spoken[0].text, 'Hello there.');
  assert.equal(f.spoken[0].rate, 0.5);
  assert.equal(f.spoken[0].queueStrategy, 0);
  assert.equal(f.spoken[0].category, 'playback', 'native iOS speech should use the playback audio session for headset/background routing');
  assert.equal(f.spoken[0].lang, 'en', 'first supported language from the phone settings');
  f.done(); await settle();
  assert.deepEqual(ev, ['start', 'end']);
});

test('native speech: falls back to en-US when the phone language has no voice, and remembers the choice', async () => {
  const f = fakePlugin(); const { h } = handlers();
  const sp = createNativeSpeech(async () => f.plugin, ['sw-KE', 'sw', 'en-US']);
  sp.speak('Habari', { rate: 1, voiceURI: '' }, h); await settle();
  assert.equal(f.spoken[0].lang, 'en-US');
  sp.speak('Again', { rate: 1, voiceURI: '' }, h); await settle();
  assert.equal(f.calls.filter((c) => c.startsWith('lang:')).length, 3, 'languages are only probed once');
});

test('native speech: a failed language lookup is retried instead of cached forever', async () => {
  let installed = false;
  const plugin = fakePlugin({
    getSupportedLanguages: async () => ({ languages: installed ? ['en-US'] : [] }),
    isLanguageSupported: async ({ lang }) => ({ supported: installed && lang === 'en-US' }),
  });
  const events: string[] = [];
  const sp = createNativeSpeech(async () => plugin.plugin, ['sw-KE', 'en-US']);
  const h = { onstart: () => events.push('start'), onend: () => events.push('end'), onerror: (e: string) => events.push(`error:${e}`) };
  sp.speak('First attempt', { rate: 1, voiceURI: '' }, h); await settle();
  assert.deepEqual(events, ['error:unsupported']);
  installed = true;
  sp.speak('After installing voice', { rate: 1, voiceURI: '' }, h); await settle();
  assert.equal(plugin.spoken[0].lang, 'en-US');
  assert.ok(events.includes('start'));
});

test('native speech: rate is kept in a safe range', async () => {
  const f = fakePlugin(); const { h } = handlers();
  const sp = createNativeSpeech(async () => f.plugin, ['en-US']);
  sp.speak('a', { rate: 0.01, voiceURI: '' }, h); await settle();
  sp.speak('b', { rate: 9, voiceURI: '' }, h); await settle();
  assert.deepEqual(f.spoken.map((s) => s.rate), [0.1, 2]);
});

test('native speech: cancel stops the engine, and stop is sent before the next phrase', async () => {
  const f = fakePlugin(); const { h } = handlers();
  const sp = createNativeSpeech(async () => f.plugin, ['en-US']);
  sp.speak('one', { rate: 1, voiceURI: '' }, h); await settle();
  sp.cancel(); sp.speak('two', { rate: 1, voiceURI: '' }, h); await settle();
  assert.deepEqual(f.calls.filter((c) => c === 'speak' || c === 'stop'), ['speak', 'stop', 'speak']);
});

test('native speech: missing plugin or missing voice engine is reported as "unsupported"', async () => {
  const a = handlers();
  createNativeSpeech(async () => null, ['en-US']).speak('x', { rate: 1, voiceURI: '' }, a.h); await settle();
  assert.deepEqual(a.ev, ['error:unsupported']);

  const b = handlers();
  const f = fakePlugin({ speak: async () => { throw new Error('Text-to-speech engine not available'); } });
  createNativeSpeech(async () => f.plugin, ['en-US']).speak('x', { rate: 1, voiceURI: '' }, b.h); await settle();
  assert.deepEqual(b.ev, ['start', 'error:unsupported']);

  const c = handlers();
  const g = fakePlugin({ speak: async () => { throw new Error('boom'); } });
  createNativeSpeech(async () => g.plugin, ['en-US']).speak('x', { rate: 1, voiceURI: '' }, c.h); await settle();
  assert.deepEqual(c.ev, ['start', 'error:boom']);
});

test('engine: no speech voice stops with an explanation instead of racing through the text', () => {
  const clock = new FakeClock(); const speech = new FakeSpeech();
  const e = new ReaderEngine(speech, clock, { ...OPTS, mode: 'sentence' });
  e.start('One. Two. Three.');
  speech.fail('unsupported');
  clock.advance(10_000);
  const s = e.getSnapshot();
  assert.equal(s.state, 'paused');
  assert.equal(s.hint, NO_VOICE);
  assert.equal(s.idx, 0, 'did not skip ahead');
  assert.equal(speech.spoken.length, 1, 'nothing else was attempted');
  e.resume();
  assert.equal(speech.spoken.length, 2, 'Resume tries again (after the person fixes their phone setting)');
});

import { deviceLang } from '../src/lib/platform';
test('deviceLang: cleans odd system locale values', () => {
  assert.equal(deviceLang('en-US'), 'en-US');
  assert.equal(deviceLang('en-US@posix'), 'en-US');
  assert.equal(deviceLang('sw_KE.UTF-8'), 'sw-KE');
  assert.equal(deviceLang(''), 'en-US');
  assert.equal(deviceLang('???'), 'en-US');
});

test('Android TTS installer helper is safe in the web build', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  try {
    assert.equal(await openNativeSpeechInstall(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete (globalThis as any).window;
  }
});


test('native speech: does not silently read with an unrelated installed language', async () => {
  const plugin = fakePlugin({
    getSupportedLanguages: async () => ({ languages: ['fr-FR'] }),
    isLanguageSupported: async () => ({ supported: false }),
  });
  const events: string[] = [];
  const sp = createNativeSpeech(async () => plugin.plugin, ['sw-KE', 'sw', 'en-US']);
  sp.speak('Habari', { rate: 1, voiceURI: '' }, {
    onstart: () => events.push('start'), onend: () => events.push('end'), onerror: (e) => events.push(`error:${e}`),
  });
  await settle();
  assert.deepEqual(events, ['error:unsupported']);
  assert.equal(plugin.spoken.length, 0, 'an unrelated French voice must never be used for Swahili/English text');
});
