import test from 'node:test';
import assert from 'node:assert/strict';
import { matchWake, parseCommand, wakePhrase, normalize } from '../src/lib/voice/wake';
import { createNativeRecognizer, createWebRecognizer, type Recognizer, type RecognizerHandlers } from '../src/lib/voice/recognizer';
import { AskFailure, VoiceAssistant, type AskResult, type AssistantDeps, type ReaderControl } from '../src/lib/voice/assistant';
import { FakeClock } from './helpers';

/* ------------------------------ wake phrase ------------------------------ */
test('wake: matches the phrase and common mis-hearings', () => {
  for (const said of ['hey exam mate', 'Hey, Exam Mate!', 'exam mate', 'hello exam mate', 'hey exam mates', 'hey examate', 'hey x am mate', 'okay exam mate']) {
    assert.equal(matchWake(said, 'hey exam mate').matched, true, said);
  }
});

test('wake: does not trigger on ordinary speech or look-alike words', () => {
  for (const said of ['the exam is on monday', 'examination mate', 'example mate', 'hey there', 'my mate failed the exam', 'game mate', '']) {
    assert.equal(matchWake(said, 'hey exam mate').matched, false, said);
  }
});

test('wake: returns what was said after the phrase', () => {
  assert.equal(matchWake('hey exam mate what is mitosis', 'hey exam mate').rest, 'what is mitosis');
  assert.equal(matchWake('Okay, exam mate, repeat that please.', 'hey exam mate').rest, 'repeat that please');
  assert.equal(matchWake('hey exam mate', 'hey exam mate').rest, '');
});

test('wake: two-word phrases still need the greeting', () => {
  assert.equal(matchWake('hey reader', 'hey reader').matched, true);
  assert.equal(matchWake('reader', 'hey reader').matched, false);
  assert.equal(matchWake('hello mate', 'hello mate').matched, true);
});

test('wake: custom phrases are validated', () => {
  assert.equal(wakePhrase('custom', 'Study Buddy'), 'study buddy');
  assert.equal(wakePhrase('custom', 'hi'), 'hey exam mate', 'too short falls back to the default');
  assert.equal(wakePhrase('reader', ''), 'hey reader');
  assert.equal(matchWake('hey study buddy what is dna', 'study buddy').rest, 'what is dna');
});

test('wake: normalize strips punctuation, accents and apostrophes', () => {
  assert.equal(normalize("  Café, THAT's it! "), 'cafe thats it');
});

test('commands: whole-utterance commands only', () => {
  const cases: [string, string | null][] = [
    ['repeat', 'repeat'], ['repeat that please', 'repeat'], ['say that again', 'repeat'], ['next', 'next'], ['skip', 'next'], ['move on', 'next'],
    ['go back', 'back'], ['previous', 'back'], ['pause', 'pause'], ['hold on', 'pause'], ['wait a second', 'pause'],
    ['continue', 'resume'], ['carry on', 'resume'], ["that's enough", 'stop'], ['stop reading', 'stop'], ['slow down', 'slower'], ['faster', 'faster'],
    ['what is the next step in mitosis', null], ['why did the reader skip the question about water', null], ['explain photosynthesis', null], ['', null],
  ];
  for (const [said, want] of cases) assert.equal(parseCommand(said), want, said);
});

/* ------------------------------ assistant ------------------------------ */
class FakeRecognizer implements Recognizer {
  kind = 'web' as const;
  starts = 0; stops = 0;
  private h: RecognizerHandlers | null = null;
  async available() { return true; }
  async requestPermission() { return true; }
  async start(h: RecognizerHandlers) { this.starts++; this.h = h; }
  async stop() { this.stops++; }
  ready() { this.h?.onReady?.(); }
  say(text: string, final = false) { this.h?.onText(text, final); }
  end(reason: 'ended' | 'no-speech' | 'denied' | 'unavailable' | 'error' = 'ended') { const h = this.h; this.h = null; h?.onEnd(reason); }
}

const tick = () => new Promise<void>((r) => setImmediate(r));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const ANSWER: AskResult = { action: 'none', answer: 'It is cell division.' };

function setup(opts: { playing?: boolean; ask?: AssistantDeps['ask']; speak?: AssistantDeps['speak'] } = {}) {
  const clock = new FakeClock();
  const rec = new FakeRecognizer();
  const log: string[] = [];
  const reader: ReaderControl = {
    isPlaying: () => opts.playing ?? true,
    pause: () => log.push('pause'), resume: () => log.push('resume'), repeat: () => log.push('repeat'), next: () => log.push('next'),
    back: () => log.push('back'), stop: () => log.push('stop'), slower: () => log.push('slower'), faster: () => log.push('faster'),
  };
  const answered: string[][] = [];
  let licenseLost = 0;
  const deps: AssistantDeps = {
    recognizer: rec, reader, clock,
    speak: opts.speak ?? (async (t) => { log.push('speak:' + t); }),
    cancelSpeech: () => log.push('cancelSpeech'),
    ask: opts.ask ?? (async (q) => { log.push('ask:' + q); return ANSWER; }),
    warm: () => log.push('warm'),
    context: () => ({ context: 'Question 1. Mitosis is cell division.', current: 'Mitosis is' }),
    tones: { ding: () => log.push('ding'), dong: () => log.push('dong'), error: () => log.push('errtone') },
    onAnswered: (q, a) => answered.push([q, a]),
    onLicenseLost: () => { licenseLost++; },
  };
  const a = new VoiceAssistant(deps);
  return { a, rec, clock, log, answered, lost: () => licenseLost };
}

test('assistant: wake phrase -> pauses the reader -> listens -> answers -> carries on where it was', async () => {
  const { a, rec, clock, log, answered } = setup();
  await a.enable({ wake: true });
  assert.equal(a.getSnapshot().status, 'waiting');
  assert.equal(rec.starts, 1);

  rec.say('hey exam mate'); await settle();
  assert.equal(a.getSnapshot().status, 'listening');
  assert.deepEqual(log.filter((l) => l !== 'warm').slice(0, 3), ['pause', 'cancelSpeech', 'ding'], 'paused, then "go ahead"');
  assert.equal(rec.starts, 1, 'the same listening session is reused: no restart, no lost words');

  rec.say('what does mitosis mean'); await settle();
  assert.equal(a.getSnapshot().transcript, 'what does mitosis mean');
  clock.advance(1500); await settle();

  assert.deepEqual(log.filter((l) => !['warm', 'pause', 'cancelSpeech', 'ding'].includes(l)), ['ask:what does mitosis mean', 'speak:It is cell division.', 'dong', 'resume']);
  assert.deepEqual(answered, [['what does mitosis mean', 'It is cell division.']]);
  assert.equal(a.getSnapshot().status, 'waiting');
  assert.equal(a.getSnapshot().answer, 'It is cell division.');
  assert.equal(rec.starts, 2, 'wake listening started again afterwards');
});

test('assistant: the question follows the wake phrase in one breath, even across several partial results', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: true });
  rec.say('hey exam mate what'); await settle();
  rec.say('hey exam mate what is'); await settle();
  rec.say('hey exam mate what is mitosis'); await settle();
  assert.ok(!log.some((l) => l.startsWith('ask:')), 'it waits for the person to finish instead of asking with half a sentence');
  clock.advance(1500); await settle();
  assert.ok(log.includes('ask:what is mitosis'));
  assert.equal(rec.starts, 2, 'one wake session + one restart afterwards');
});

test('assistant: a pause between the wake phrase and the question works (the engine starts a new segment)', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: true });
  rec.say('hey exam mate', true); await settle();
  rec.say('what is dna'); await settle();
  clock.advance(1500); await settle();
  assert.ok(log.includes('ask:what is dna'));
});

test('assistant: if the engine closes the session right after the wake phrase, a fresh one is opened for the question', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle();
  rec.end('ended'); await settle();
  assert.equal(rec.starts, 2, 'new session for the question');
  assert.equal(log.filter((l) => l === 'ding').length, 1, 'only one ding');
  rec.say('what is dna', true); clock.advance(600); await settle();
  assert.ok(log.includes('ask:what is dna'));
});

test('assistant: the AI decides what is an instruction, however it is worded: no fixed phrases', async () => {
  const cases: [string, AskResult['action'], string[]][] = [
    ['could you try going faster', 'faster', ['faster', 'resume']],
    ["i didn't catch that", 'repeat', ['repeat']],
    ['ok i have that, skip ahead', 'next', ['next']],
    ['take me to the one before', 'back', ['back']],
    ['hold on a sec', 'pause', []],
    ['alright carry on', 'resume', ['resume']],
    ['that is enough for today', 'stop', ['stop']],
    ['you are going too quick for me', 'slower', ['slower', 'resume']],
  ];
  for (const [said, action, expected] of cases) {
    const { a, rec, clock, log } = setup({ ask: async (q) => { log.push('ask:' + q); return { action, answer: 'Okay.' }; } });
    await a.enable({ wake: true });
    rec.say('hey exam mate'); await settle();
    rec.say(said, true); clock.advance(600); await settle();
    assert.ok(log.includes('ask:' + said), 'the exact words go to the AI: ' + said);
    assert.deepEqual(log.filter((l) => ['next', 'repeat', 'back', 'stop', 'resume', 'slower', 'faster'].includes(l)), expected, said);
    assert.ok(!log.some((l) => l.startsWith('speak:')), 'an instruction is carried out, not talked about');
    assert.equal(a.getSnapshot().status, 'waiting');
  }
});

test('assistant: if the AI cannot be reached, plain commands still work offline', async () => {
  const { a, rec, clock, log } = setup({ ask: async () => { throw new AskFailure("I couldn't reach the internet."); } });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('next', true); clock.advance(600); await settle();
  assert.ok(log.includes('next') && !log.some((l) => l.startsWith('speak:')));
});

test('assistant: an unrecognised sentence with the AI down is answered honestly, not ignored', async () => {
  const { a, rec, clock, log } = setup({ ask: async () => { throw new AskFailure("I couldn't reach the internet."); } });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what does reconciliation mean', true); clock.advance(600); await settle();
  assert.ok(log.includes("speak:I couldn't reach the internet.") && log.includes('resume'));
});

test('assistant: silence after the trigger is spoken ("I didn\'t catch that") and reading carries on', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle();
  clock.advance(6000); await settle();
  assert.ok(log.includes('errtone') && log.includes("speak:Sorry, I didn't catch that.") && log.includes('resume'));
  assert.equal(a.getSnapshot().message, "I didn't catch that.");
  assert.equal(a.getSnapshot().status, 'waiting');
});

test('assistant: if the reader was already paused by the student it is left paused', async () => {
  const { a, rec, clock, log } = setup({ playing: false });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle();
  rec.say('what is dna', true); clock.advance(600); await settle();
  assert.ok(!log.includes('pause') && !log.includes('resume'));
  assert.ok(log.includes('ask:what is dna'));
});

test('assistant: AI failure is spoken kindly and reading carries on', async () => {
  const { a, rec, clock, log, answered } = setup({ ask: async () => { throw new AskFailure('Add your Gemini key in Settings to ask questions.', 'key'); } });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what is dna', true); clock.advance(600); await settle();
  assert.ok(log.includes('speak:Add your Gemini key in Settings to ask questions.'), 'the problem is spoken, so earbud users hear it');
  assert.ok(log.includes('resume'));
  assert.equal(answered.length, 0, 'not saved as an answer');
});

test('assistant: a revoked license stops everything and tells the app', async () => {
  const { a, rec, clock, log, lost } = setup({ ask: async () => { throw new AskFailure('License not valid.', 'license'); } });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what is dna', true); clock.advance(600); await settle();
  assert.equal(lost(), 1);
  assert.ok(!log.includes('resume'));
});

test('assistant: a hanging AI times out, says so, and the reader carries on', async () => {
  const { a, rec, clock, log } = setup({ ask: () => new Promise(() => {}) });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what is dna', true); clock.advance(600); await settle();
  assert.equal(a.getSnapshot().status, 'thinking');
  clock.advance(18_000); await settle();
  assert.ok(log.some((l) => l.startsWith('speak:Sorry, that took too long')));
  assert.ok(log.includes('resume'));
});

test('assistant: "still thinking" appears when the AI is slow, and goes away with the answer', async () => {
  let release!: (r: AskResult) => void;
  const { a, rec, clock } = setup({ ask: () => new Promise<AskResult>((r) => { release = r; }) });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what is dna', true); clock.advance(600); await settle();
  assert.equal(a.getSnapshot().slow, false);
  clock.advance(5000); await settle();
  assert.equal(a.getSnapshot().slow, true);
  release({ action: 'none', answer: 'Deoxyribonucleic acid.', ms: 6200 }); await settle();
  assert.equal(a.getSnapshot().slow, false);
  assert.equal(a.getSnapshot().ms, 6200);
});

test('assistant: wakes the server up as soon as it is triggered, while the person is still speaking', async () => {
  const { a, rec, log } = setup();
  await a.enable({ wake: true });
  const n = log.filter((l) => l === 'warm').length;
  rec.say('hey exam mate'); await settle();
  assert.equal(log.filter((l) => l === 'warm').length, n + 1);
});

test('assistant: in hold mode the ding means the microphone is really open', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: false });
  void a.trigger('hold'); await settle();
  assert.ok(!log.includes('ding'), 'no ding before the microphone is ready');
  rec.ready(); await settle();
  assert.equal(log.filter((l) => l === 'ding').length, 1);
  clock.advance(2000);
  assert.equal(log.filter((l) => l === 'ding').length, 1, 'never twice');
});

test('assistant: if the microphone never says it is ready, it dings anyway', async () => {
  const { a, clock, log } = setup();
  await a.enable({ wake: false });
  void a.trigger('hold'); await settle();
  clock.advance(900); await settle();
  assert.equal(log.filter((l) => l === 'ding').length, 1);
});

test('assistant: ignores new triggers while busy, and when switched off', async () => {
  const { a, rec, log } = setup();
  await a.trigger('hold');
  assert.deepEqual(log, [], 'not enabled: nothing happens');
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle();
  const n = log.length;
  await a.trigger('hold'); await settle();
  assert.equal(log.length, n, 'already listening: second trigger ignored');
});

test('assistant: disabling mid-question abandons it quietly', async () => {
  let release!: (r: AskResult) => void;
  const { a, rec, clock, log } = setup({ ask: () => new Promise<AskResult>((r) => { release = r; }) });
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle(); rec.say('what is dna', true); clock.advance(600); await settle();
  await a.disable();
  release({ action: 'none', answer: 'late answer' }); await settle();
  assert.ok(!log.some((l) => l.startsWith('speak:')));
  assert.equal(a.getSnapshot().status, 'off');
});

test('assistant: Cancel while listening resumes the reader', async () => {
  const { a, rec, log } = setup();
  await a.enable({ wake: true });
  rec.say('hey exam mate'); await settle();
  await a.cancel(); await settle();
  assert.ok(log.includes('resume'));
  assert.equal(a.getSnapshot().status, 'waiting');
});

test('assistant: hold-only mode (no wake listening) still answers', async () => {
  const { a, rec, clock, log } = setup();
  await a.enable({ wake: false });
  assert.equal(a.getSnapshot().status, 'idle');
  assert.equal(rec.starts, 0, 'microphone is not open until the hold button is used');
  void a.trigger('hold'); await settle();
  assert.equal(a.getSnapshot().status, 'listening');
  rec.say('what is dna', true); clock.advance(600); await settle();
  assert.ok(log.includes('ask:what is dna') && log.includes('resume'));
  assert.equal(a.getSnapshot().status, 'idle');
});

test('assistant: wake listening restarts after each session, backs off on errors, stops if denied', async () => {
  const { a, rec, clock } = setup();
  await a.enable({ wake: true });
  rec.end('ended'); clock.advance(300); await settle();
  assert.equal(rec.starts, 2);
  rec.end('error'); clock.advance(600); await settle();
  assert.equal(rec.starts, 3);
  rec.end('error'); clock.advance(600); await settle();
  assert.equal(rec.starts, 3, 'backoff: second error waits longer');
  clock.advance(600); await settle();
  assert.equal(rec.starts, 4);
  rec.end('denied'); await settle();
  assert.equal(a.getSnapshot().status, 'off');
  assert.match(a.getSnapshot().message, /Microphone access was denied/);
});

test('assistant: no recognizer means a clear message instead of a crash', async () => {
  const a = new VoiceAssistant({ ...setup().a['deps'], recognizer: null } as AssistantDeps);
  await a.enable({ wake: true });
  assert.match(a.getSnapshot().message, /not supported/);
  assert.equal(a.getSnapshot().enabled, false);
});

/* ------------------------------ recognizer adapters ------------------------------ */
test('web recognizer: maps results and errors', async () => {
  let inst: any;
  class Fake { lang = ''; continuous = false; interimResults = false; onresult: any; onerror: any; onend: any; constructor() { inst = this; } start() {} stop() {} abort() {} }
  const r = createWebRecognizer({ webkitSpeechRecognition: Fake, navigator: {} }, 'en-KE')!;
  const got: any[] = [];
  await r.start({ onText: (t, f) => got.push([t, f]), onEnd: (why) => got.push(['end', why]) });
  assert.equal(inst.lang, 'en-KE'); assert.equal(inst.continuous, true); assert.equal(inst.interimResults, true);
  inst.onresult({ results: [[{ transcript: 'hey exam' }]].map((x: any) => Object.assign(x, { isFinal: false })) });
  inst.onresult({ results: [Object.assign([{ transcript: 'hey exam mate' }], { isFinal: true })] });
  inst.onerror({ error: 'not-allowed' }); inst.onend();
  assert.deepEqual(got, [['hey exam', false], ['hey exam mate', true], ['end', 'denied']]);
  assert.equal(createWebRecognizer({}, 'en'), null, 'no Web Speech API: null');
});

test('native recognizer: partial results, stop event, final result, permissions', async () => {
  const listeners = new Map<string, (d: any) => void>();
  let startArgs: any; let startResult: any = {}; let startError: Error | null = null;
  const plugin = {
    available: async () => ({ available: true }),
    requestPermissions: async () => ({ speechRecognition: 'granted' }),
    start: async (o: any) => { startArgs = o; if (startError) throw startError; return startResult; },
    stop: async () => {},
    addListener: async (ev: string, cb: (d: any) => void) => { listeners.set(ev, cb); return { remove: async () => { listeners.delete(ev); } }; },
  };
  const r = createNativeRecognizer(plugin, 'en-US');
  assert.equal(await r.available(), true);
  assert.equal(await r.requestPermission(), true);
  const got: any[] = [];
  await r.start({ onText: (t, f) => got.push([t, f]), onEnd: (why) => got.push(['end', why]) });
  assert.deepEqual([startArgs.partialResults, startArgs.popup, startArgs.language], [true, false, 'en-US']);
  listeners.get('partialResults')!({ matches: ['hey exam'] });
  listeners.get('listeningState')!({ status: 'stopped' });
  assert.deepEqual(got, [['hey exam', false], ['end', 'ended']]);

  startResult = { matches: ['final words'] }; got.length = 0;
  await r.start({ onText: (t, f) => got.push([t, f]), onEnd: () => {} });
  assert.deepEqual(got, [['final words', true]]);

  startError = new Error('Missing permission'); got.length = 0;
  await r.start({ onText: () => {}, onEnd: (why) => got.push(why) });
  assert.deepEqual(got, ['denied']);

  plugin.requestPermissions = async () => ({ speechRecognition: 'denied' });
  assert.equal(await r.requestPermission(), false);
});
