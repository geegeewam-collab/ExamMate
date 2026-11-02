'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from '../hooks/useEngine';
import { useAssistant } from '../hooks/useAssistant';
import { createRecognizer } from '../lib/voice/recognizer';
import { WAKE_PRESETS } from '../lib/voice/wake';
import { kv } from '../lib/storage';
import { windowAround, wordCount } from '../lib/text';
import { readTextFile } from '../lib/files';
import {
  bindMediaSession, deviceLang, getAudioRoutes, isAndroidNative, isNative, openNativeSpeechInstall, primeSpeech, setMediaInfo, speechSupported, startKeepAlive, stopKeepAlive, unwake, wake,
  watchVoices, type VoiceOption,
} from '../lib/platform';
import {
  loadHistory, loadResume, saveHistory, PACE_PRESETS, type HistoryItem, type Resume, type Settings,
} from '../lib/settings';
import { apiBase } from '../lib/config';
import { GeminiKey, maskKey } from '../services/gemini-key';
import { LicenseService } from '../services/license-service';
import { answerPhotos, AnswerError, KeyError, LicenseError, type AnswerProgress } from '../services/answer-service';
import ReadTab, { type Shot } from './ReadTab';
import HistoryTab from './HistoryTab';
import SettingsTab from './SettingsTab';
import Player from './Player';
import GeminiSetup from './GeminiSetup';
import { Icon, type IconName } from './ui';

type Tab = 'read' | 'history' | 'settings';
const MENU: { id: Tab; label: string; icon: IconName; description: string }[] = [
  { id: 'read', label: 'Read', icon: 'book', description: 'Current paper' },
  { id: 'settings', label: 'Settings', icon: 'sliders', description: 'Reading and voice' },
  { id: 'history', label: 'History', icon: 'clock', description: 'Saved papers' },
];

export default function Shell({
  settings, update, onLocked,
}: { settings: Settings; update(p: Partial<Settings>): void; onLocked(message: string): void }) {
  const [tab, setTab] = useState<Tab>('read');
  const [menuOpen, setMenuOpen] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [engine, snap] = useEngine(settings);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [resume, setResume] = useState<Resume | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [shot, setShot] = useState<Shot | null>(null);
  const [owner, setOwner] = useState<boolean | null>(null);
  const [geminiKey, setGeminiKey] = useState<string | null>(null); // null until loaded
  const [setup, setSetup] = useState<{ message?: string } | null>(null);
  const [assistMsg, setAssistMsg] = useState('');
  const [audioDevices, setAudioDevices] = useState<{ inputs: string[]; outputs: string[] } | null>(null);
  const [audioDevicesChecked, setAudioDevicesChecked] = useState(false);
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);

  const camRef = useRef<HTMLInputElement | null>(null);
  const galRef = useRef<HTMLInputElement | null>(null);
  const lastText = useRef('');
  const lastFiles = useRef<File[]>([]);
  const shotUrls = useRef<string[]>([]);
  const busy = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  const live = useRef({ text, snap, settings });
  useEffect(() => {
    live.current = { text, snap, settings };
  });

  const { assistant, state: voiceState } = useAssistant({
    settings, engine, snap,
    getContext: () => {
      const snapshot = live.current.snap;
      const cur = snapshot.phrases[snapshot.idx] ?? '';
      const preferredAt = snapshot.phrases.slice(0, snapshot.idx).reduce((n, phrase) => n + phrase.length + 1, 0);
      return { context: windowAround(lastText.current, cur, 3500, preferredAt), current: cur };
    },
    setRate: (rate) => update({ rate }),
    onAnswered: (q, a) =>
      setHistory((h) => {
        const entry = `You asked: ${q}\nAnswer: ${a}`;
        const n = [{ t: Date.now(), title: q.slice(0, 70) || 'Voice question', text: entry }, ...h].slice(0, 20);
        saveHistory(n);
        return n;
      }),
    onLicenseLost: () => { void LicenseService.clear().then(() => onLocked('This license is no longer valid. Enter a valid key to continue.')); },
  });
  const assistantRef = useRef(assistant);
  useEffect(() => { assistantRef.current = assistant; }, [assistant]);

  const checkAudioDevices = useCallback(async () => {
    setAudioDevicesLoading(true);
    try {
      setAudioDevices(await getAudioRoutes());
      setAudioDevicesChecked(true);
    } finally {
      setAudioDevicesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === 'settings' && isNative()) void checkAudioDevices();
  }, [tab, checkAudioDevices]);

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
    const savedDraft = kv.get<string>('draft_text', '');
    if (savedDraft) setText(savedDraft);
    return watchVoices(setVoices);
  }, []);
  useEffect(() => { kv.set('draft_text', text); }, [text]);
  useEffect(() => () => {
    ctl.current?.abort();
    shotUrls.current.forEach((url) => URL.revokeObjectURL(url));
    stopKeepAlive();
    unwake();
  }, []);

  const startReading = useCallback(
    (from = 0, body?: string) => {
      const t = (body ?? live.current.text).trim();
      if (!speechSupported()) return setMsg('Speech output is unavailable here. Use a supported browser or install the Exam Mate app on Android or iPhone.');
      if (!engine.start(t, from)) return setMsg('Add some text first, or take a photo of the questions.');
      assistantRef.current.resetConversation();
      lastText.current = t;
      setPlayerVisible(true);
      setTab('read');
      setMsg('');
      startKeepAlive();
    },
    [engine],
  );
  const startRef = useRef(startReading);
  startRef.current = startReading;

  /* keep the screen awake and the audio alive only while a session is running */
  const running = snap.active && !snap.finished;
  const currentPace: 'write' | 'balanced' | 'quick' | 'custom' =
    (Object.keys(PACE_PRESETS) as Array<keyof typeof PACE_PRESETS>).find((key) =>
      Object.entries(PACE_PRESETS[key]).every(([setting, value]) => settings[setting as keyof Settings] === value),
    ) ?? 'custom';
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
        play: () => { if (engine.getSnapshot().state === 'paused') engine.resume(); else if (engine.getSnapshot().state === 'idle') startRef.current(); },
        pause: () => engine.pause(),
        next: () => engine.next(),
        back: () => engine.back(),
        repeat: () => engine.repeat(),
        askOnPlayPause: () => live.current.settings.earbudAsk && live.current.settings.assist,
        isPlaying: () => { const state = engine.getSnapshot().state; return state === 'playing' || state === 'counting'; },
        ask: () => { void assistantRef.current.trigger('hold'); },
      }),
    [engine],
  );
  useEffect(() => {
    if (snap.active && !snap.finished) {
      setMediaInfo(snap.phrases[snap.idx] || 'Exam Mate', `${snap.idx + 1} of ${snap.phrases.length}`, snap.state === 'playing' || snap.state === 'counting');
    } else {
      setMediaInfo('Exam Mate', '', null);
    }
  }, [snap.active, snap.finished, snap.idx, snap.state, snap.phrases]);

  /* Photo-to-answer flow. Every selected page is retained and processed in request-sized batches. */
  const handlePhotos = useCallback(
    async (files: File[], again = false) => {
      if (!files.length || busy.current) return;
      lastFiles.current = [...files];
      busy.current = true;
      ctl.current?.abort();
      ctl.current = new AbortController();
      void wake();
      if (!again || !shotUrls.current.length) {
        shotUrls.current.forEach((url) => URL.revokeObjectURL(url));
        shotUrls.current = files.map((file) => URL.createObjectURL(file));
      }
      setShot({
        url: shotUrls.current[0], urls: [...shotUrls.current], busy: true, canRetry: false,
        totalPages: files.length, progress: 0, message: 'Preparing your pages',
        title: `Preparing ${files.length} page${files.length === 1 ? '' : 's'}…`,
        help: 'Keeping every selected page in the paper.',
      });
      setTab('read');
      setPlayerVisible(false);
      try {
        const updateProgress = (progress: AnswerProgress) => {
          setShot((current) => current && ({
            ...current,
            message: progress.message,
            help: progress.detail,
            progress: progress.progress,
            totalPages: progress.totalPages,
          }));
        };
        const result = await answerPhotos(files, live.current.settings.style, ctl.current.signal, updateProgress);
        if (!result.text) throw new AnswerError('No questions were found in those pages. Try a closer, clearer photograph.');
        setText(result.text);
        setHistory((h) => {
          const titleLine = result.text.split(/\r?\n/).find((line) => line.trim()) || 'Exam paper';
          const next = [{ t: Date.now(), title: titleLine.replace(/^\s*\d+[.)]\s*/, '').slice(0, 70) || 'Exam paper', text: result.text }, ...h].slice(0, 20);
          saveHistory(next);
          return next;
        });
        setShot((current) => current && ({
          ...current, busy: false, canRetry: false, progress: 100,
          title: 'Answers ready',
          help: `All ${result.questionCount} question${result.questionCount === 1 ? '' : 's'} answered from ${files.length} page${files.length === 1 ? '' : 's'}.`,
          message: 'Your complete paper is ready.', detail: undefined,
        }));
        if (live.current.settings.auto) startReading(0, result.text);
        else {
          unwake();
          setMediaInfo('Answers ready', `${result.questionCount} questions · Press play to read`, false);
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
        const error = e instanceof AnswerError ? e : null;
        setShot((current) => current && ({
          ...current, busy: false, canRetry: !aborted,
          title: aborted ? 'Processing stopped' : 'Could not complete the paper',
          help: aborted ? 'Your selected pages and current answer text are kept.' : (error?.message || 'Check your connection and try again.'),
          message: aborted ? 'Stopped by you' : 'The paper was not marked as complete',
          detail: error?.detail || undefined,
        }));
      } finally {
        busy.current = false;
        ctl.current = null;
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

  async function toggleAssist(on: boolean): Promise<string> {
    setAssistMsg('');
    if (!on) { update({ assist: false }); return ''; }
    const r = await createRecognizer(deviceLang());
    const native = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
    const fail = (m: string) => { setAssistMsg(m); return m; };
    if (!r) return fail(
      isAndroidNative()
        ? 'No speech-recognition service is available. Install or enable Google Speech Services (or your phone maker’s speech service), download the language you use, then reopen Exam Mate.'
        : native
          ? 'Speech recognition is unavailable on this iPhone. Check that Speech Recognition is available for your language and try again.'
          : 'This browser does not support speech recognition. Install the native Exam Mate app on iPhone or use a supported browser.'
    );
    if (!(await r.requestPermission())) return fail('Microphone or speech-recognition permission was denied. Allow both in your phone settings, then try again.');
    update({ assist: true });
    return '';
  }

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

  const navigate = (next: Tab) => {
    if (snap.active && !snap.finished && next !== tab) engine.pause();
    setPlayerVisible(false);
    setTab(next);
    setMenuOpen(false);
  };

  const continueSession = () => {
    setTab('read');
    setMenuOpen(false);
    if (snap.active && !snap.finished) {
      setPlayerVisible(true);
      if (snap.state === 'paused') engine.resume();
      return;
    }
    if (resume) {
      setText(resume.text);
      primeSpeech();
      startReading(resume.idx, resume.text);
    }
  };

  const backHandler = useRef<() => boolean>(() => false);
  backHandler.current = () => {
    if (menuOpen) { setMenuOpen(false); return true; }
    if (playerVisible) {
      // The first hardware/browser Back exits the full-screen reader, never the app.
      // The engine is paused at the current phrase and the session remains resumable.
      engine.pause();
      setPlayerVisible(false);
      setTab('read');
      return true;
    }
    if (tab !== 'read') {
      if (snap.active && !snap.finished) engine.pause();
      setPlayerVisible(false);
      setTab('read');
      return true;
    }
    return false;
  };

  useEffect(() => {
    const handleBack = () => backHandler.current();
    const onNativeBack = (event: Event) => {
      if (handleBack()) event.preventDefault();
    };
    const onPopState = () => {
      if (handleBack()) window.history.pushState({ __examMate: true }, '', window.location.href);
    };
    (window as any).__examMateHandleBack = handleBack;
    window.history.pushState({ __examMate: true }, '', window.location.href);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('exammate:back', onNativeBack);
    return () => {
      delete (window as any).__examMateHandleBack;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('exammate:back', onNativeBack);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuOpen) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <>
      <div className="app">
        <div className="app-topbar">
          <div className="brand-mark"><span className="brand-dot" /> ExamMate</div>
          <button className="menu-toggle" type="button" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((open) => !open)}>
            <Icon name="menu" size={22} />
          </button>
        </div>
        {menuOpen && <>
          <button className="menu-scrim" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} />
          <nav className="main-menu" id="main-navigation" aria-label="Main navigation">
            <div className="menu-heading">Workspace</div>
            {MENU.map((item) => <button type="button" key={item.id} className={'menu-item' + (tab === item.id ? ' selected' : '')} onClick={() => navigate(item.id)}>
              <span className="menu-icon"><Icon name={item.icon} size={19} /></span>
              <span><b>{item.label}</b><small>{item.description}</small></span>
            </button>)}
          </nav>
        </>}
        {snap.active && !snap.finished && !playerVisible && (
          <button className="session-banner" type="button" onClick={continueSession}>
            <span className="session-play"><Icon name="play" size={16} /></span>
            <span className="session-copy"><b>Reading session paused</b><small>Continue from phrase {snap.idx + 1} of {snap.phrases.length}</small></span>
            <span className="session-action">Continue</span>
          </button>
        )}
        {tab === 'read' && (
          <ReadTab
            settings={settings} setStyle={(style) => update({ style })}
            text={text} setText={setText} msg={msg} shot={shot} resume={resume}
            camRef={camRef} galRef={galRef}
            onCamera={() => { if (needsKeyFirst()) return; primeSpeech(); camRef.current?.click(); }}
            onGallery={() => { if (needsKeyFirst()) return; primeSpeech(); galRef.current?.click(); }}
            onPhotos={(f) => void handlePhotos(f)}
            onFile={(f) => void loadFile(f)}
            onStart={() => { primeSpeech(); startReading(); }}
            onResume={continueSession}
            onPaste={() => void pasteAndStart()}
            onRetry={() => void handlePhotos(lastFiles.current, true)}
            onCancel={() => ctl.current?.abort()}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            items={history}
            onOpen={(item) => { setText(item.text); setMsg('Loaded from history. Press Start.'); setTab('read'); setPlayerVisible(false); setMenuOpen(false); }}
            onRename={(t, title) => setHistory((current) => { const next = current.map((item) => item.t === t ? { ...item, title } : item); saveHistory(next); return next; })}
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
            onAssist={toggleAssist} assistMsg={assistMsg} showAndroidTtsInstall={isAndroidNative()} onOpenTtsInstall={() => {
              void openNativeSpeechInstall().then((opened) => {
                if (!opened) setAssistMsg('Open Android Settings > Text-to-speech output and install a voice for your language.');
              }).catch(() => setAssistMsg('Could not open Android speech voice settings. Open Settings > Text-to-speech output manually.'));
            }}
            showNativeAudioRoutes={isNative()} audioDevices={audioDevices} audioDevicesChecked={audioDevicesChecked} audioDevicesLoading={audioDevicesLoading} onCheckAudioDevices={() => void checkAudioDevices()}
          />
        )}
      </div>

      {tab === 'read' && playerVisible && snap.active && (
        <Player
          engine={engine} snap={snap}
          pace={currentPace}
          onPaceChange={(pace) => update(PACE_PRESETS[pace])}
          onMinimize={() => { engine.pause(); setPlayerVisible(false); setTab('read'); }}
          onOpenTtsInstall={isAndroidNative() ? () => {
            void openNativeSpeechInstall().then((opened) => {
              if (!opened) setMsg('Open Android Settings > Text-to-speech output and install a voice for your language.');
            }).catch(() => setMsg('Could not open Android speech voice settings. Open Settings > Text-to-speech output manually.'));
          } : undefined}
          voice={settings.assist ? { assistant, state: voiceState, holdMs: settings.holdMs, wakeLabel: settings.wake === 'custom' ? settings.wakeCustom || WAKE_PRESETS.exam.label : WAKE_PRESETS[settings.wake].label } : null}
        />
      )}
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
