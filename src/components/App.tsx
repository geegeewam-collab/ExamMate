'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULTS, loadSettings, saveSettings, type Settings } from '../lib/settings';
import { LicenseService } from '../services/license-service';
import Activation from './Activation';
import Shell from './Shell';
import { Spinner } from './ui';

type Phase = 'loading' | 'locked' | 'ready';

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  const gate = useCallback(async () => {
    const s = await LicenseService.checkLocalBinding();
    if (s === 'valid' || s === 'offline') {
      setPhase('ready');
      return;
    }
    setNotice(
      s === 'invalid' ? 'This license is no longer valid. Enter a valid key to continue.'
      : s === 'stale' ? 'Connect to the internet to verify your license.'
      : '',
    );
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
      {phase === 'locked' && <Activation notice={notice} onActivated={() => { setNotice(''); setPhase('ready'); }} />}
      {phase === 'ready' && <Shell settings={settings} update={update} onLocked={lock} />}
    </>
  );
}
