'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GeminiKey, cleanKey, copiedKey, looksLikeKey, maskKey, openAiStudio } from '../services/gemini-key';
import { Icon, Spinner } from './ui';

/**
 * Connects the student's own free Google AI (Gemini) key. Shown the first time it is needed, not at first launch.
 * AI Studio opens inside the app; when the student copies the key and comes back, the app finds it on the clipboard
 * and connects it, so there is nothing to paste or type.
 */
export default function GeminiSetup({
  message, replacing, onSaved, onSkip,
}: { message?: string; replacing?: boolean; onSaved(key: string): void; onSkip(): void }) {
  const [value, setValue] = useState('');
  const [found, setFound] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fromStudio = useRef(false);
  const rejected = useRef(new Set<string>());
  const saving = useRef(false);

  const save = useCallback(async (raw: string) => {
    const k = cleanKey(raw);
    if (!looksLikeKey(k)) {
      setError("That doesn't look like a Google AI key. It is one long line of letters and numbers, usually starting with AIza.");
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    const r = await GeminiKey.check(k);
    saving.current = false;
    if (!r.ok) {
      rejected.current.add(k);
      setFound('');
      setBusy(false);
      setError(r.error);
      return;
    }
    await GeminiKey.set(k);
    setBusy(false);
    onSaved(k);
  }, [onSaved]);

  /** Looks for a copied key. Coming straight back from AI Studio connects it at once; otherwise it is offered. */
  const lookForKey = useCallback(async () => {
    const k = await copiedKey();
    if (!k || rejected.current.has(k)) return;
    setValue(k);
    if (fromStudio.current) {
      fromStudio.current = false;
      void save(k);
    } else {
      setFound(k);
    }
  }, [save]);

  useEffect(() => {
    void lookForKey();
    const onVisible = () => { if (document.visibilityState === 'visible') void lookForKey(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [lookForKey]);

  const openStudio = () => {
    setError('');
    fromStudio.current = true;
    // Android may need a moment to hand focus back before the clipboard can be read.
    void openAiStudio(() => { setTimeout(() => void lookForKey(), 400); });
  };

  const paste = async () => {
    const k = await copiedKey();
    if (k) { setValue(k); void save(k); }
    else setError('Nothing that looks like a key was copied. In AI Studio, tap the copy button next to your key, then come back.');
  };

  return (
    <div className="setup" role="dialog" aria-label="Connect Google AI">
      <div className="setup-scroll">
        <section className="glass setup-card">
          <div className="badge-icon" aria-hidden="true"><Icon name="key" size={28} /></div>
          <h1>Connect your free Google AI account</h1>
          <p className="sub">
            Exam Mate uses Google&rsquo;s free AI with your own Google account to read photos and answer questions.
            It takes about 30 seconds, once.
          </p>
          {message && <p className="notice">{message}</p>}

          {found && !busy ? (
            <>
              <p className="notice"><b>Found the key you copied</b> ({maskKey(found)}).</p>
              <button className="btn primary lg" onClick={() => void save(found)}>Connect this key</button>
            </>
          ) : (
            <>
              <ol className="steps">
                <li>
                  <span className="step-num">1</span>
                  <div><b>Tap the button below</b><p>Google AI Studio opens. Sign in with your Google account if asked.</p></div>
                </li>
                <li>
                  <span className="step-num">2</span>
                  <div><b>Tap &ldquo;Create API key&rdquo;, then the copy button</b><p>If it asks for a project, choose any or let it make one.</p></div>
                </li>
                <li>
                  <span className="step-num">3</span>
                  <div><b>Come back to Exam Mate</b><p>It finds the copied key and connects it for you.</p></div>
                </li>
              </ol>
              <button className="btn primary lg" onClick={openStudio} disabled={busy}>
                {busy ? <Spinner /> : <>Open Google AI Studio <Icon name="external" size={18} /></>}
              </button>
            </>
          )}

          <div aria-live="polite">
            {busy && <p className="fine">Checking your key with Google…</p>}
            {error && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}
          </div>

          <details>
            <summary className="fine">Paste or type the key yourself</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <input
                className="field mono" value={value} placeholder="Paste your key here" aria-label="Google AI key"
                autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
                onChange={(e) => { setValue(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && void save(value)}
              />
              <div className="row">
                <button className="btn secondary" onClick={() => void paste()} disabled={busy}><Icon name="clipboard" size={18} /> Paste</button>
                <button className="btn primary" onClick={() => void save(value)} disabled={busy || !value.trim()}>Save and test</button>
              </div>
            </div>
          </details>

          <p className="fine">
            Your key is saved only on this phone. It goes to Google to read your photos and is never stored on our server.
            If you see a limit message, the free plan is resting. Wait a bit and try again.
          </p>
          <button className="link" onClick={onSkip}>{replacing ? 'Cancel' : 'Not now'}</button>
        </section>
      </div>
    </div>
  );
}
