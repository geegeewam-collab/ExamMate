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
  const [inUse, setInUse] = useState<{ canTransfer: boolean; retryAt?: string } | null>(null);
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
    setInUse(null);
    const r = ownerMode ? await LicenseService.activateOwner(key) : await LicenseService.validateLicense(key);
    setBusy(false);
    if (r.isValid) onActivated();
    else if (r.inUse) setInUse(r.inUse);
    else setError(r.error || 'Could not activate.');
  }

  async function moveHere() {
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await LicenseService.transferLicense(key);
    setBusy(false);
    if (r.isValid) onActivated();
    else if (r.inUse) setInUse(r.inUse);
    else { setInUse(null); setError(r.error || 'Could not move the license.'); }
  }

  const retryDate = inUse?.retryAt ? new Date(inUse.retryAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

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
            onChange={(e) => { setKey(e.target.value.toUpperCase()); setInUse(null); }} onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {inUse ? (
          inUse.canTransfer ? (
            <>
              <p className="notice">
                <b>This key is active on another phone.</b> Move it to this phone? The other phone will be signed out.
                You can move a key once every 30 days.
              </p>
              <button className="btn primary lg" onClick={moveHere} disabled={busy}>
                {busy ? <Spinner /> : 'Move to this phone'}
              </button>
              <button className="link" onClick={() => setInUse(null)} disabled={busy}>Cancel</button>
            </>
          ) : (
            <p className="notice">
              <b>This key is active on another phone</b> and was moved recently{retryDate ? `. It can be moved again on ${retryDate}` : ''}.
              To use it here sooner, ask the person who gave you the key to reset it.
            </p>
          )
        ) : (
          <button className="btn primary lg" onClick={submit} disabled={busy || !key.trim()}>
            {busy ? <Spinner /> : ownerMode ? 'Sign in' : 'Activate'}
          </button>
        )}

        <div aria-live="polite">
          {error && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          {!error && notice && <p className="notice">{notice}</p>}
        </div>

        {ownerMode ? (
          <button className="link" onClick={() => { setOwnerMode(false); setKey(''); setError(''); }}>Back to license key</button>
        ) : (
          <>
            {SUPPORT_URL && <a className="link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Need a license? Get one</a>}
            <p className="fine">Each license works on one phone. Got a new phone? Enter the same key and move it.</p>
          </>
        )}
      </section>
    </main>
  );
}
