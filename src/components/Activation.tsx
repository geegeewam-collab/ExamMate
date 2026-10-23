'use client';
import { useRef, useState } from 'react';
import { LicenseService } from '../services/license-service';
import { SUPPORT_URL } from '../lib/config';
import { Icon, Spinner } from './ui';

export default function Activation({ notice, onActivated }: { notice?: string; onActivated(): void }) {
  const [key, setKey] = useState('');
  const [ownerMode, setOwnerMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const taps = useRef({ n: 0, t: 0 });

  // Tap the app icon 5 times to reveal the owner sign-in (students never need it).
  function logoTap() {
    const now = Date.now();
    taps.current = { n: now - taps.current.t < 1500 ? taps.current.n + 1 : 1, t: now };
    if (taps.current.n >= 5) {
      taps.current.n = 0;
      setOwnerMode((o) => !o);
      setError('');
      setKey('');
    }
  }

  async function submit() {
    if (busy || !key.trim()) return;
    setBusy(true);
    setError('');
    const r = ownerMode ? await LicenseService.activateOwner(key) : await LicenseService.validateLicense(key);
    setBusy(false);
    if (r.isValid) onActivated();
    else setError(r.error || 'Could not activate.');
  }

  return (
    <main className="auth">
      <section className="glass auth-card">
        <div className="logo" onClick={logoTap} role="presentation">
          <img src="/icon-256.png" alt="" width={84} height={84} draggable={false} />
        </div>
        <h1>{ownerMode ? 'Owner sign-in' : 'Exam Mate'}</h1>
        <p className="sub">
          {ownerMode
            ? 'Enter your admin password. No license key needed.'
            : 'Enter your license key to activate this device. You only do this once.'}
        </p>

        {ownerMode ? (
          <input
            className="field" type="password" value={key} placeholder="Admin password" aria-label="Admin password"
            autoComplete="current-password"
            onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        ) : (
          <input
            className="field key" value={key} placeholder="EXAM-XXXX-XXXX-XXXX" aria-label="License key"
            autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
            onChange={(e) => setKey(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        <button className="btn primary lg" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? <Spinner /> : ownerMode ? 'Sign in' : 'Activate'}
        </button>

        <div aria-live="polite">
          {error && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          {!error && notice && <p className="notice">{notice}</p>}
        </div>

        {ownerMode ? (
          <button className="link" onClick={() => { setOwnerMode(false); setKey(''); setError(''); }}>Back to license key</button>
        ) : (
          <>
            {SUPPORT_URL && <a className="link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Need a license? Get one</a>}
            <p className="fine">Each license works on one device.</p>
          </>
        )}
      </section>
    </main>
  );
}
