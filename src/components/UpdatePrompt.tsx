'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localDay, shouldPrompt, snoozeUpdate } from '../lib/update';
import { UpdateService, type UpdateInfo } from '../services/update-service';
import { Icon, Spinner } from './ui';

type Step = 'offer' | 'permission' | 'downloading' | 'installing' | 'error';
const RECHECK_MS = 60 * 60_000;

/**
 * Checks for a newer Android release when the app opens and when it returns to the foreground (at most hourly).
 * "Update now" downloads and opens Android's installer, which updates in place and keeps all data.
 * "Later" hides the prompt until the first open of the next day.
 */
export default function UpdatePrompt() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [step, setStep] = useState<Step>('offer');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const lastCheck = useRef(0);
  const waitingForPermission = useRef(false);

  const check = useCallback(async () => {
    lastCheck.current = Date.now();
    const found = await UpdateService.check();
    if (found && shouldPrompt(found.version, found.required, localDay())) {
      setInfo(found);
      setStep('offer');
    }
  }, []);

  const install = useCallback(async (update: UpdateInfo) => {
    setError('');
    if (!(await UpdateService.canInstall())) {
      setStep('permission');
      return;
    }
    setPercent(0);
    setStep('downloading');
    try {
      await UpdateService.install(update.apkUrl, setPercent);
      setStep('installing');
    } catch (e) {
      setError((e as Error)?.message || 'The update could not be downloaded.');
      setStep('error');
    }
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Back from the "allow installs" settings screen: carry on with the update automatically.
      if (waitingForPermission.current && info) {
        waitingForPermission.current = false;
        void install(info);
        return;
      }
      // Reopening the app from the background on a new day counts as that day's first open.
      if (!info && Date.now() - lastCheck.current > RECHECK_MS) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check, install, info]);

  if (!info) return null;

  const later = () => {
    snoozeUpdate(info.version);
    setInfo(null);
  };

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-label="Update available">
      <div className="setup-scroll">
        <section className="glass setup-card">
          <div className="badge-icon" aria-hidden="true"><Icon name="check" size={28} /></div>
          <h1>{info.required ? 'Update required' : 'Update available'}</h1>
          <p className="sub">
            Exam Mate {info.version} is ready. You have {info.current}.
            {info.required ? ' This version is needed to keep using the app.' : ''}
          </p>

          {step === 'offer' && info.notes && <p className="notice" style={{ whiteSpace: 'pre-line', textAlign: 'left' }}>{info.notes}</p>}

          {step === 'permission' && (
            <p className="notice">
              Android needs your permission once. Tap <b>Open settings</b>, turn on <b>Allow from this source</b>, then come
              back. The update will continue by itself.
            </p>
          )}

          {step === 'downloading' && (
            <div aria-live="polite">
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
                style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft-strong)', overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
              </div>
              <p className="fine">Downloading… {percent}%</p>
            </div>
          )}

          {step === 'installing' && (
            <p className="notice">
              Tap <b>Update</b> on the Android screen. Your license, Gemini key and saved papers stay as they are. If nothing
              appeared, tap Try again.
            </p>
          )}

          {step === 'error' && <p className="error" role="alert"><Icon name="alert" size={16} /> {error}</p>}

          {step === 'permission' ? (
            <button className="btn primary lg" onClick={() => { waitingForPermission.current = true; void UpdateService.openInstallSettings(); }}>
              Open settings
            </button>
          ) : (
            <button className="btn primary lg" disabled={step === 'downloading'} onClick={() => void install(info)}>
              {step === 'downloading' ? <Spinner /> : step === 'offer' ? 'Update now' : 'Try again'}
            </button>
          )}

          {step === 'error' && (
            <a className="btn secondary lg" href={info.apkUrl} target="_blank" rel="noopener noreferrer">
              Download in browser instead <Icon name="external" size={18} />
            </a>
          )}

          {!info.required && step !== 'downloading' && <button className="link" onClick={later}>Later</button>}
        </section>
      </div>
    </div>
  );
}
