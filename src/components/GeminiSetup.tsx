'use client';
import { useState } from 'react';
import { AI_STUDIO_URL, GeminiKey, cleanKey, looksLikeKey } from '../services/gemini-key';
import { Icon, Spinner } from './ui';

/** First-launch (and Settings) guide: students use their own free Gemini key. */
export default function GeminiSetup({
  message, replacing, onSaved, onSkip,
}: { message?: string; replacing?: boolean; onSaved(key: string): void; onSkip(): void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const k = cleanKey(value);
    if (!looksLikeKey(k)) {
      setError("That doesn't look like a Gemini key. It is one long line of letters and numbers, usually starting with AIza.");
      return;
    }
    setBusy(true);
    setError('');
    const r = await GeminiKey.check(k);
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    await GeminiKey.set(k);
    setBusy(false);
    onSaved(k);
  }

  return (
    <div className="setup" role="dialog" aria-label="Connect your Gemini key">
      <div className="setup-scroll">
        <section className="glass setup-card">
          <div className="badge-icon" aria-hidden="true"><Icon name="key" size={28} /></div>
          <h1>Connect your free Gemini key</h1>
          <p className="sub">
            Exam Mate uses Google&rsquo;s Gemini AI to read your photos. It&rsquo;s free, and it uses your own Google
            account. It takes about a minute and you only do it once.
          </p>
          {message && <p className="notice">{message}</p>}

          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div><b>Open Google AI Studio</b><p>Sign in with any Google account.</p></div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div><b>Tap &ldquo;Create API key&rdquo;</b><p>Choose any project, or let it make one for you.</p></div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div><b>Copy the key and paste it below</b><p>It usually starts with &ldquo;AIza&rdquo;.</p></div>
            </li>
          </ol>

          <a className="btn secondary lg" href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer">
            Open Google AI Studio <Icon name="external" size={18} />
          </a>

          <input
            className="field mono" value={value} placeholder="Paste your key here" aria-label="Gemini API key"
            autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button className="btn primary lg" onClick={save} disabled={busy || !value.trim()}>
            {busy ? <Spinner /> : 'Save and test'}
          </button>

          <div aria-live="polite">
            {error && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          </div>

          <p className="fine">
            Your key is saved only on this phone. It is sent to Google to read your photos and is never stored on our
            server. If you ever see a limit message, the free plan is just resting. Wait a bit and try again.
          </p>
          <button className="link" onClick={onSkip}>{replacing ? 'Cancel' : 'Skip for now'}</button>
        </section>
      </div>
    </div>
  );
}
