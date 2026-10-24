'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../hooks/useEngine';
import { kv } from '../lib/storage';
import { wordCount } from '../lib/text';
import { readTextFile } from '../lib/files';
import {
  bindMediaSession, primeSpeech, setMediaInfo, speechSupported, startKeepAlive, stopKeepAlive, unwake, wake,
  watchVoices, type VoiceOption,
} from '../lib/platform';
import {
  loadHistory, loadResume, photosToday, saveHistory, type HistoryItem, type Resume, type Settings,
} from '../lib/settings';
import { apiBase } from '../lib/config';
import type { Updater } from '../hooks/useUpdater';
import { GeminiKey, maskKey } from '../services/gemini-key';
import { LicenseService } from '../services/license-service';
import { answerPhotos, AnswerError, KeyError, LicenseError } from '../services/answer-service';
import ReadTab, { type Shot } from './ReadTab';
import HistoryTab from './HistoryTab';
import SettingsTab from './SettingsTab';
import Player from './Player';
import GeminiSetup from './GeminiSetup';
import { Icon, type IconName } from './ui';

type Tab = 'read' | 'history' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'read', label: 'Read', icon: 'book' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

export default function Shell({
  settings, update, onLocked, updater, onBusy,
}: {
  settings: Settings; update(p: Partial<Settings>): void; onLocked(message: string): void;
  updater: Updater; onBusy(busy: boolean): void;
}) {
  const [tab, setTab] = useState<Tab>('read');
  const [engine, snap] = useEngine(settings);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [resume, setResume] = useState<Resume | null>(null);
  const [count, setCount] = useState(0);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [shot, setShot] = useState<Shot | null>(null);
  const [owner, setOwner] = useState<boolean | null>(null);
  const [geminiKey, setGeminiKey] = useState<string | null>(null); // null until loaded
  const [setup, setSetup] = useState<{ message?: string } | null>(null);

  const camRef = useRef<HTMLInputElement | null>(null);
  const galRef = useRef<HTMLInputElement | null>(null);
  const lastText = useRef('');
  const lastFiles = useRef<File[]>([]);
  const shotUrl = useRef('');
  const busy = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  const live = useRef({ text, snap, settings });
  useEffect(() => {
    live.current = { text, snap, settings };
  });

  /* who is this device? students need their own Gemini key; the owner uses the server's */
  useEffect(() => {
    void (async () => {
      const [o, k] = await Promise.all([LicenseService.isOwner(), GeminiKey.get()]);
      setOwner(o);
      setGeminiKey(k);
      if (!o && !k && !kv.get('key_prompted', false)) {
        kv.set('key_prompted', true);
        setSetup({}); // first launch: walk the student through getting a free key
      }
    })();
  }, []);

  useEffect(() => {
    setHistory(loadHistory());
    setResume(loadResume());
    setCount(photosToday());
    return watchVoices(setVoices);
  }, []);

  const startReading = useCallback(
    (from = 0, body?: string) => {
      const t = (body ?? live.current.text).trim();
      if (!speechSupported()) return setMsg('This device has no speech support, so it cannot read aloud.');
      if (!engine.start(t, from)) return setMsg('Add some text first, or take a photo of the questions.');
      lastText.current = t;
      setMsg('');
      startKeepAlive();
    },
    [engine],
  );
  const startRef = useRef(startReading);
  startRef.current = startReading;

  /* keep the screen awake and the audio alive only while a session is running */
  const running = snap.active && !snap.finished;
  const working = running || !!setup || !!shot?.busy;
  useEffect(() => onBusy(working), [onBusy, working]);
  useEffect(() => () => onBusy(false), [onBusy]);
  useEffect(() => {
    if (running) void wake();
    else unwake();
    if (!snap.active || snap.finished) stopKeepAlive();
  }, [running, snap.active, snap.finished]);
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'visible' && live.current.snap.state === 'playing') void wake();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  /* remember where the person got to, so Resume works after Stop or closing the app */
  useEffect(() => {
    if (snap.active && !snap.finished) kv.set('resume', { text: lastText.current, idx: snap.idx });
    else if (snap.finished) {
      kv.del('resume');
      setResume(null);
    } else setResume(loadResume());
  }, [snap.active, snap.finished, snap.idx]);

  /* lock-screen and earbud controls */
  useEffect(
    () =>
      bindMediaSession({
        active: () => live.current.snap.active && !live.current.snap.finished,
        hasText: () => !!live.current.text.trim(),
        startFromText: () => startRef.current(),
        toggle: () => engine.toggle(),
        next: () => engine.next(),
        back: () => engine.back(),
        repeat: () => engine.repeat(),
      }),
    [engine],
  );
  useEffect(() => {
    if (snap.active) {
      setMediaInfo(snap.phrases[snap.idx] || 'Exam Mate', `${snap.idx + 1} of ${snap.phrases.length}`, snap.state === 'playing' || snap.state === 'counting');
    }
  }, [snap.active, snap.idx, snap.state, snap.phrases]);

  /* photo to answers */
  const handlePhotos = useCallback(
    async (files: File[], again = false) => {
      if (!files.length || busy.current) return;
      lastFiles.current = files;
      busy.current = true;
      ctl.current = new AbortController();
      void wake();
      if (!again || !shotUrl.current) {
        if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
        shotUrl.current = URL.createObjectURL(files[0]);
      }
      setShot({
        url: shotUrl.current, busy: true, canRetry: false,
        title: 'Reading your photo…', help: 'Photo received. This takes 10 to 30 seconds.',
      });
      try {
        const res = await answerPhotos(files, live.current.settings.style, ctl.current.signal);
        if (!res.text) throw new AnswerError('No questions were found in that photo. Try a clearer, closer shot.');
        setText(res.text);
        setHistory((h) => {
          const n = [{ t: Date.now(), text: res.text }, ...h].slice(0, 20);
          saveHistory(n);
          return n;
        });
        setCount(photosToday(true));
        setShot((s) => s && { ...s, busy: false, canRetry: false, title: 'Answers ready', help: 'They are in the text box below.', detail: undefined });
        if (live.current.settings.auto) startReading(0, res.text);
        else {
          unwake();
          setMediaInfo('Answers ready', 'Press play to start reading', false);
        }
      } catch (e) {
        unwake();
        if (e instanceof LicenseError) {
          await LicenseService.clear();
          onLocked('This license is no longer valid. Enter a valid key to continue.');
          return;
        }
        if (e instanceof KeyError) {
          setShot(null);
          setSetup({ message: e.message });
          return;
        }
        const aborted = (e as Error).name === 'AbortError';
        const a = e instanceof AnswerError ? e : null;
        setShot((s) => s && {
          ...s, busy: false, canRetry: true,
          title: aborted ? 'Stopped' : "Couldn't get answers",
          help: aborted ? '' : (a?.message || 'Check your connection and try again.'),
          detail: a?.detail || undefined,
        });
      } finally {
        busy.current = false;
      }
    },
    [onLocked, startReading],
  );

  /** Students must connect their Gemini key before the first photo. Returns true when it opened the guide. */
  const needsKeyFirst = () => {
    if (owner === false && !geminiKey) {
      setSetup({ message: 'Add your free Gemini key first. It lets Exam Mate read your photos.' });
      return true;
    }
    return false;
  };

  async function pasteAndStart() {
    primeSpeech();
    try {
      const c = await navigator.clipboard.readText();
      if (c && c.trim()) {
        setText(c);
        startReading(0, c);
        return;
      }
    } catch {
      /* clipboard blocked */
    }
    if (text.trim()) startReading();
    else setMsg('Your phone blocked clipboard access. Press and hold in the box, choose Paste, then press Start.');
  }

  async function loadFile(f: File) {
    setMsg(`Reading ${f.name}…`);
    try {
      const t = await readTextFile(f);
      if (!t) return setMsg('No readable text found. A scanned PDF is only a picture and cannot be read.');
      setText(t);
      setMsg(`Loaded ${wordCount(t)} words. Press Start.`);
    } catch {
      setMsg('Could not read that file. Copy the text and paste it into the box instead.');
    }
  }

  return (
    <>
      <div className="app">
        {tab === 'read' && (
          <ReadTab
            settings={settings} setStyle={(style) => update({ style })}
            text={text} setText={setText} msg={msg} shot={shot} count={count} resume={resume}
            camRef={camRef} galRef={galRef}
            onCamera={() => { if (needsKeyFirst()) return; primeSpeech(); camRef.current?.click(); }}
            onGallery={() => { if (needsKeyFirst()) return; primeSpeech(); galRef.current?.click(); }}
            onPhotos={(f) => void handlePhotos(f)}
            onFile={(f) => void loadFile(f)}
            onStart={() => { primeSpeech(); startReading(); }}
            onResume={() => { if (resume) { setText(resume.text); primeSpeech(); startReading(resume.idx, resume.text); } }}
            onPaste={() => void pasteAndStart()}
            onRetry={() => void handlePhotos(lastFiles.current, true)}
            onCancel={() => ctl.current?.abort()}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            items={history}
            onOpen={(t) => { setText(t); setMsg('Loaded from history. Press Start.'); setTab('read'); }}
            onClear={() => { setHistory([]); saveHistory([]); }}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab
            s={settings} set={update} voices={voices} speech={speechSupported()}
            owner={owner} keyMask={geminiKey ? maskKey(geminiKey) : ''}
            onKey={() => setSetup({})}
            onRemoveKey={async () => { await GeminiKey.clear(); setGeminiKey(''); }}
            adminUrl={`${apiBase() ?? ''}/admin`}
            updater={updater}
          />
        )}
      </div>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {snap.active && <Player engine={engine} snap={snap} />}
      {setup && (
        <GeminiSetup
          message={setup.message} replacing={!!geminiKey}
          onSaved={(k) => { setGeminiKey(k); setSetup(null); }}
          onSkip={() => setSetup(null)}
        />
      )}
    </>
  );
}
