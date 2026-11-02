'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NO_VOICE, type ReaderEngine, type Snapshot } from '../lib/engine';
import { useCountdown } from '../hooks/useEngine';
import VoiceDock, { type VoiceProps } from './VoiceDock';
import { Icon } from './ui';

export default function Player({ engine, snap, voice, onOpenTtsInstall, onMinimize, pace = 'custom', onPaceChange }: { engine: ReaderEngine; snap: Snapshot; voice?: VoiceProps | null; onOpenTtsInstall?: () => void; onMinimize(): void; pace?: 'write' | 'balanced' | 'quick' | 'custom'; onPaceChange(pace: 'write' | 'balanced' | 'quick'): void }) {
  const [write, setWrite] = useState(false);
  const [paceOpen, setPaceOpen] = useState(false);
  const left = useCountdown(snap.gapEndsAt);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const activeCodeRef = useRef<HTMLDivElement | null>(null);

  const total = snap.phrases.length;
  const phrase = snap.phrases[snap.idx] || '';
  const playing = snap.state === 'playing' || snap.state === 'counting';
  const activeLine = snap.lineOf[snap.idx];

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    activeCodeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeLine, snap.idx]);

  const status =
    snap.state === 'counting' ? `Starting in ${snap.countdown}…`
    : snap.finished ? `${total} phrases read`
    : snap.hint ? snap.hint
    : snap.state === 'paused' ? 'Paused'
    : snap.phase === 'tap' ? 'Tap anywhere to continue'
    : '';

  const label = snap.finished ? 'Done' : snap.state === 'paused' ? 'Paused' : snap.phase === 'write' ? 'Write' : snap.phase === 'tap' ? 'Your turn' : 'Listen';
  const isCode = snap.codeOf[snap.idx] === true;
  const codeLineNumber = snap.codeLineNumber[snap.idx] || 1;
  const codeLines = snap.phrases.map((text, index) => ({
    text, index, lineNumber: snap.codeLineNumber[index],
  })).filter((line) => snap.codeOf[line.index] && snap.lineOf[line.index] === activeLine);
  const codeLineCount = codeLines.reduce((max, line) => Math.max(max, line.lineNumber), 0);
  const paceLabel = pace === 'write' ? 'Write along' : pace === 'quick' ? 'Quick' : pace === 'balanced' ? 'Balanced' : 'Custom';
  const lines = snap.lines.map((t, li) => ({ t, li })).filter((x) => snap.lineOf.includes(x.li));

  return (
    <div
      className="sheet" role="dialog" aria-label="Reading"
      onClick={(e) => {
        if (snap.phase === 'tap' && !(e.target as HTMLElement).closest('button')) engine.tap();
      }}
    >
      <div className="sheet-bar">
        <button className="icon-btn" aria-label="Return to home and keep this session" onClick={onMinimize}><Icon name="chevronDown" /></button>
        <span className="pill" aria-live="polite">{snap.state === 'counting' ? 'Get ready' : `${Math.min(snap.idx + 1, total)} of ${total}`}</span>
        <div className="sheet-actions">
          <div className="pace-picker">
            <button className="pace-trigger" type="button" aria-haspopup="true" aria-expanded={paceOpen} onClick={() => setPaceOpen((open) => !open)}>{paceLabel}<Icon name="chevronDown" size={14} /></button>
            {paceOpen && <div className="pace-popover" role="group" aria-label="Reading pace">
              <button type="button" className={pace === 'write' ? 'selected' : ''} onClick={() => { onPaceChange('write'); setPaceOpen(false); }}>Write along</button>
              <button type="button" className={pace === 'balanced' ? 'selected' : ''} onClick={() => { onPaceChange('balanced'); setPaceOpen(false); }}>Balanced</button>
              <button type="button" className={pace === 'quick' ? 'selected' : ''} onClick={() => { onPaceChange('quick'); setPaceOpen(false); }}>Quick review</button>
            </div>}
          </div>
          <button className={'icon-btn' + (write ? ' on' : '')} aria-label={write ? 'Exit write mode' : 'Write mode'} aria-pressed={write} onClick={() => setWrite((w) => !w)}><Icon name="pencil" /></button>
          <button className="icon-btn" aria-label="Stop and end session" onClick={() => engine.stop()}><Icon name="close" /></button>
        </div>
      </div>

      <div className="reader-progress" aria-label={`Reading progress ${total ? Math.round(((snap.idx + 1) / total) * 100) : 0}%`}><i style={{ width: `${total ? ((snap.idx + 1) / total) * 100 : 0}%` }} /></div>
      <div className="sheet-body">
        {write ? (
          <div className="write">
            <div className="eyebrow">{label}</div>
            <div className="bignum" aria-live="off">
              {snap.state === 'counting' ? snap.countdown : snap.phase === 'write' ? left : snap.finished ? <Icon name="check" size={96} /> : '·'}
            </div>
            {isCode && !snap.finished ? <div className="code-reader compact"><div className="code-meta"><span>CODE</span><span>LINE {codeLineNumber} / {codeLineCount}</span></div><div className="code-source-lines">{codeLines.map((line) => <div key={line.index} ref={line.index === snap.idx ? activeCodeRef : undefined} className={'code-source-line' + (line.index === snap.idx ? ' active' : '')}><span className="code-line-number">{line.lineNumber}</span><code>{line.text || ' '}</code></div>)}</div></div> : <p className="phrase sm" key={snap.idx}>{snap.finished ? 'Finished.' : phrase}</p>}
            {status && <p className="status">{status}</p>}
            {snap.hint === NO_VOICE && onOpenTtsInstall && (
              <button className="btn tinted sheet-repeat" onClick={onOpenTtsInstall}>Install / manage speech voices</button>
            )}
          </div>
        ) : (
          <>
            <div className="eyebrow">{label}</div>
            {isCode && !snap.finished ? (
              <div className="code-reader" key={`code-${activeLine}`}>
                <div className="code-meta"><span>CODE</span><span>LINE {codeLineNumber} / {codeLineCount}</span></div>
                <div className="code-source-lines" aria-label={`Program code, currently reading line ${codeLineNumber}`}>
                  {codeLines.map((line) => <div key={line.index} ref={line.index === snap.idx ? activeCodeRef : undefined} className={'code-source-line' + (line.index === snap.idx ? ' active' : '')} aria-current={line.index === snap.idx ? 'true' : undefined}>
                    <span className="code-line-number">{line.lineNumber}</span><code>{line.text || ' '}</code>
                  </div>)}
                </div>
              </div>
            ) : (
              <p className={'phrase' + (phrase.length > 150 ? ' xl' : phrase.length > 70 ? ' lg' : '')} key={snap.finished ? 'done' : snap.idx}>
                {snap.state === 'counting' ? `Starting in ${snap.countdown}…` : snap.finished ? 'Finished.' : <mark>{phrase}</mark>}
              </p>
            )}
            <div className="gapbar" aria-hidden="true">
              {snap.phase === 'write' && snap.gapMs > 0 && (
                <i key={snap.gapKey} style={{ animationDuration: `${snap.gapMs}ms` } as CSSProperties} />
              )}
            </div>
            <p className="status" aria-live="polite">{status || '\u00a0'}</p>
            {snap.hint === NO_VOICE && onOpenTtsInstall && (
              <button className="btn tinted sheet-repeat" onClick={onOpenTtsInstall}>Install / manage speech voices</button>
            )}

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
