'use client';
import { useState } from 'react';
import { LicenseService } from '../services/license-service';
import { SUPPORT_URL } from '../lib/config';
import { Icon, Spinner } from './ui';

export default function Activation({ notice, onActivated }: { notice?: string; onActivated(): void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (busy || !key.trim()) return;
    setBusy(true);
    setError('');
    const r = await LicenseService.validateLicense(key);
    setBusy(false);
    if (r.isValid) onActivated();
    else setError(r.error || 'Could not activate.');
  }

  return (
    <main className="auth">
      <section className="glass auth-card">
        <div className="logo" aria-hidden="true"><Icon name="book" size={32} /></div>
        <h1>Exam Mate</h1>
        <p className="sub">Enter your license key to activate this device.</p>

        <input
          className="field key" value={key} placeholder="EXAM-XXXX-XXXX-XXXX" aria-label="License key"
          autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn primary lg" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? <Spinner /> : 'Activate'}
        </button>

        <div aria-live="polite">
          {error && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          {!error && notice && <p className="notice">{notice}</p>}
        </div>

        {SUPPORT_URL && (
          <a className="link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Need a license? Get one</a>
        )}
        <p className="fine">Each license works on one device.</p>
      </section>
    </main>
  );
}
