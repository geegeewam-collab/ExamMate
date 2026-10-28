'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ReaderEngine, Snapshot } from '../lib/engine';
import { useCountdown } from '../hooks/useEngine';
import VoiceDock, { type VoiceProps } from './VoiceDock';
import { Icon } from './ui';

export default function Player({ engine, snap, voice }: { engine: ReaderEngine; snap: Snapshot; voice?: VoiceProps | null }) {
  const [write, setWrite] = useState(false);
  const left = useCountdown(snap.gapEndsAt);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const total = snap.phrases.length;
  const phrase = snap.phrases[snap.idx] || '';
  const playing = snap.state === 'playing' || snap.state === 'counting';
  const activeLine = snap.lineOf[snap.idx];

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeLine]);

  const status =
    snap.state === 'counting' ? `Starting in ${snap.countdown}…`
    : snap.finished ? `${total} phrases read`
    : snap.hint ? snap.hint
    : snap.state === 'paused' ? 'Paused'
    : snap.phase === 'tap' ? 'Tap anywhere to continue'
    : '';

  const label = snap.finished ? 'Done' : snap.state === 'paused' ? 'Paused' : snap.phase === 'write' ? 'Write' : snap.phase === 'tap' ? 'Your turn' : 'Listen';
  const lines = snap.lines.map((t, li) => ({ t, li })).filter((x) => snap.lineOf.includes(x.li));

  return (
    <div
      className="sheet" role="dialog" aria-label="Reading"
      onClick={(e) => {
        if (snap.phase === 'tap' && !(e.target as HTMLElement).closest('button')) engine.tap();
      }}
    >
      <div className="sheet-bar">
        <button className="icon-btn" aria-label="Stop reading" onClick={() => engine.stop()}><Icon name="close" /></button>
        <span className="pill" aria-live="polite">{snap.state === 'counting' ? 'Get ready' : `${Math.min(snap.idx + 1, total)} of ${total}`}</span>
        <button className={'icon-btn' + (write ? ' on' : '')} aria-label={write ? 'Exit write mode' : 'Write mode'} aria-pressed={write} onClick={() => setWrite((w) => !w)}>
          <Icon name="pencil" />
        </button>
      </div>

      <div className="sheet-body">
        {write ? (
          <div className="write">
            <div className="eyebrow">{label}</div>
            <div className="bignum" aria-live="off">
              {snap.state === 'counting' ? snap.countdown : snap.phase === 'write' ? left : snap.finished ? <Icon name="check" size={96} /> : '·'}
            </div>
            <p className="phrase sm" key={snap.idx}>{snap.finished ? 'Finished.' : phrase}</p>
            {status && <p className="status">{status}</p>}
          </div>
        ) : (
          <>
            <div className="eyebrow">{label}</div>
            <p className={'phrase' + (phrase.length > 150 ? ' xl' : phrase.length > 70 ? ' lg' : '')} key={snap.finished ? 'done' : snap.idx}>
              {snap.state === 'counting' ? `Starting in ${snap.countdown}…` : snap.finished ? 'Finished.' : <mark>{phrase}</mark>}
            </p>
            <div className="gapbar" aria-hidden="true">
              {snap.phase === 'write' && snap.gapMs > 0 && (
                <i key={snap.gapKey} style={{ animationDuration: `${snap.gapMs}ms` } as CSSProperties} />
              )}
            </div>
            <p className="status" aria-live="polite">{status || '\u00a0'}</p>

            {lines.length > 1 && (
              <div className="qlist">
                <div className="section-label">Questions</div>
                <div className="list">
                  {lines.map(({ t, li }) => (
                    <button key={li} ref={li === activeLine ? activeRef : undefined} type="button"
                      className={'item q' + (li === activeLine ? ' cur' : '')} onClick={() => engine.jumpToLine(li)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {voice && <VoiceDock {...voice} />}

      <div className="sheet-controls">
        <button className="ctl" aria-label="Previous phrase" onClick={() => engine.back()}><Icon name="prev" size={26} /></button>
        <button className="ctl main" aria-label={snap.finished ? 'Read again' : playing ? 'Pause' : 'Resume'} onClick={() => engine.toggle()}>
          <Icon name={snap.finished ? 'repeat' : playing ? 'pause' : 'play'} size={34} />
        </button>
        <button className="ctl" aria-label="Next phrase" onClick={() => engine.next()}><Icon name="next" size={26} /></button>
      </div>
      <button className="btn ghost sheet-repeat" onClick={() => engine.repeat()}><Icon name="repeat" size={18} /> Repeat phrase</button>
    </div>
  );
}
