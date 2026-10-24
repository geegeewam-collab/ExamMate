'use client';
import { useEffect, useRef, useState } from 'react';
import type { UpdateInfo } from '../lib/update-controller';
import { Icon } from './ui';

const mb = (n: number) => `${(n / 1_048_576).toFixed(n >= 10_485_760 ? 0 : 1)} MB`;

/**
 * "A new version is available." Update Now opens the APK download in the phone's browser. Android then asks the person to
 * allow installs from that browser the first time; we explain that here and never try to get around it.
 * The dialog stays open after Update Now to show what to do next.
 */
export default function UpdatePrompt({
  update, installed, onLater, onStarted, onClose,
}: { update: UpdateInfo; installed: string | null; onLater(): void; onStarted(): void; onClose(): void }) {
  const [started, setStarted] = useState(false);
  const card = useRef<HTMLElement | null>(null);
  const updateBtn = useRef<HTMLAnchorElement | null>(null);
  const doneBtn = useRef<HTMLButtonElement | null>(null);
  const leave = started ? onClose : onLater;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  /* the main button gets focus, again when the dialog changes to the install steps */
  useEffect(() => {
    (started ? doneBtn : updateBtn).current?.focus();
  }, [started]);

  /* focus comes back to where it was when the dialog closes; Tab stays inside; Escape closes */
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        leaveRef.current();
      } else if (e.key === 'Tab' && card.current) {
        const items = Array.from(card.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) leave(); }}>
      <section ref={card} className="glass modal-card" role="dialog" aria-modal="true" aria-labelledby="upd-title" aria-describedby="upd-desc">
        <div className="badge-icon" aria-hidden="true"><Icon name="download" size={28} /></div>

        {!started ? (
          <>
            <h2 id="upd-title">Exam Mate Update Available</h2>
            <p id="upd-desc" className="sub">
              A newer version of Exam Mate is ready. This update includes improvements and bug fixes.
            </p>
            <p className="ver">
              Version {update.version}{update.size ? ` · ${mb(update.size)}` : ''}
              {installed && <span> (you have {installed})</span>}
            </p>
            <a ref={updateBtn} className="btn primary lg" href={update.apkUrl} target="_blank" rel="noopener noreferrer"
              onClick={() => { setStarted(true); onStarted(); }}>
              Update Now
            </a>
            <button className="btn secondary lg" onClick={onLater}>Later</button>
            <p className="fine">Your license, settings and history are kept when you update.</p>
          </>
        ) : (
          <>
            <h2 id="upd-title">Finish the update</h2>
            <p id="upd-desc" className="sub">Your phone is downloading Exam Mate {update.version}. Then:</p>
            <ol className="steps">
              <li><span className="step-num">1</span><div><b>Open the downloaded file</b><p>Tap the download notification, or find it in your browser&rsquo;s downloads or the Files app.</p></div></li>
              <li><span className="step-num">2</span><div><b>Allow the install if Android asks</b><p>The first time, Android asks you to allow installs from your browser. Turn it on, then go back and tap Install.</p></div></li>
              <li><span className="step-num">3</span><div><b>Tap Install, then Open</b><p>If Play Protect warns about the app, tap More details, then Install anyway.</p></div></li>
            </ol>
            <button ref={doneBtn} className="btn primary lg" onClick={onClose}>Done</button>
            <a className="link" href={update.releaseUrl} target="_blank" rel="noopener noreferrer">Download did not start? Open the release page</a>
          </>
        )}
      </section>
    </div>
  );
}
