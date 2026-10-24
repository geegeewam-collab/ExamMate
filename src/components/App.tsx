'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULTS, loadSettings, saveSettings, type Settings } from '../lib/settings';
import { useUpdater } from '../hooks/useUpdater';
import { installedVersion } from '../services/update-service';
import { LicenseService } from '../services/license-service';
import Activation from './Activation';
import Shell from './Shell';
import UpdatePrompt from './UpdatePrompt';
import { Spinner } from './ui';

type Phase = 'loading' | 'locked' | 'stale' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false); // reading aloud or answering a photo: never interrupt that with a dialog
  const updater = useUpdater();

  const gate = useCallback(async () => {
    const s = await LicenseService.checkLocalBinding();
    if (s === 'valid' || s === 'offline') {
      setPhase('ready');
      return;
    }
    if (s === 'stale') {
      setPhase('stale');
      return;
    }
    setNotice(s === 'invalid' ? 'This license is no longer valid. Enter a valid key to continue.' : '');
    setPhase('locked');
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    void gate();
  }, [gate]);

  /* re-check the license when the app comes back to the foreground (at most once a minute) */
  useEffect(() => {
    let last = Date.now();
    const on = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 60_000) {
        last = Date.now();
        void gate();
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [gate]);

  const update = useCallback((p: Partial<Settings>) => {
    setSettings((s) => {
      const n = { ...s, ...p };
      saveSettings(n);
      return n;
    });
  }, []);

  const lock = useCallback((message: string) => {
    setNotice(message);
    setPhase('locked');
  }, []);

  return (
    <>
      <div className="bg" aria-hidden="true" />
      {phase === 'loading' && <div className="splash"><Spinner /></div>}
      {phase === 'stale' && (
        <main className="auth">
          <section className="glass auth-card">
            <div className="logo"><img src="/icon-256.png" alt="" width={84} height={84} /></div>
            <h1>Can&rsquo;t check your license</h1>
            <p className="sub">You have been offline for a while. Connect to the internet and try again. You will not need to enter your key again.</p>
            <button className="btn primary lg" disabled={retrying}
              onClick={async () => { setRetrying(true); await gate(); setRetrying(false); }}>
              {retrying ? <Spinner /> : 'Try again'}
            </button>
          </section>
        </main>
      )}
      {phase === 'locked' && <Activation notice={notice} onActivated={() => { setNotice(''); setPhase('ready'); }} />}
      {phase === 'ready' && <Shell settings={settings} update={update} onLocked={lock} updater={updater} onBusy={setBusy} />}
      {phase !== 'loading' && !busy && updater.snap.prompt && updater.snap.update && (
        <UpdatePrompt
          update={updater.snap.update} installed={installedVersion()}
          onLater={updater.later} onStarted={updater.started} onClose={updater.close}
        />
      )}
    </>
  );
}
