'use client';
import { useRef, useState, type CSSProperties } from 'react';
import { isNative } from '../lib/platform';
import type { AssistantSnapshot, CaptureEnd, TurnTiming, VoiceAssistant } from '../lib/voice/assistant';
import { Icon } from './ui';

const secs = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(2)} s`);
const ENDED: Record<CaptureEnd, string> = {
  silence: 'quiet timer ran out',
  final: 'engine said final, short wait',
  engine: 'speech engine closed on its own',
  max: 'hit the time limit',
  'no-speech': 'nothing heard',
  cancelled: 'cancelled',
};

/** Owner-only: where the time went for the last question, with the slowest stage highlighted. */
function TimingCard({ t }: { t: TurnTiming }) {
  const native = isNative();
  const s = t.server;
  const rows: { key: string; label: string; ms: number | null; note?: string }[] = [
    { key: 'end', label: 'Waiting to be sure you finished', ms: t.endWaitMs, note: ENDED[t.endedBy] },
    { key: 'prep', label: 'Preparing the request', ms: t.prepMs },
    ...(s
      ? [
          { key: 'net', label: 'Network, phone to server and back', ms: t.networkMs },
          { key: 'check', label: 'Server: licence and limit check', ms: s.verifyMs + s.limitMs },
          { key: 'ai', label: 'Server: Gemini', ms: s.aiMs },
        ]
      : [{ key: 'trip', label: 'Network + server (no breakdown)', ms: t.roundTripMs }]),
    { key: 'voice', label: native ? 'Voice engine ready*' : 'Voice starting', ms: t.voiceMs },
  ];
  const shown = rows.filter((r) => r.ms !== null);
  const big = shown.length ? shown.reduce((a, b) => ((b.ms as number) > (a.ms as number) ? b : a)).key : '';
  return (
    <div className="voice-timing glass" role="status">
      <div className="felt"><span>{t.feltMs === null ? 'No answer started' : 'You felt'}</span><b>{secs(t.feltMs)}</b></div>
      <p className="hint">Last word you said to the answer starting</p>
      <dl>
        {shown.map((r) => (
          <div key={r.key} className={r.key === big ? 'row big' : 'row'}>
            <dt>{r.label}{r.note ? <small> ({r.note})</small> : null}</dt>
            <dd>{secs(r.ms)}</dd>
          </div>
        ))}
      </dl>
      {s && s.tries.length > 0 && (
        <p className="tries">
          Gemini: {s.tries.map((x) => `${x.model.replace(/^gemini-/, '')} → ${x.status || 'no reply'} in ${secs(x.ms)}${x.note ? ` (${x.note})` : ''}`).join('  then  ')}
        </p>
      )}
      <p className="tries">{t.local ? 'Understood on the phone, no AI: ' : 'Sent to the AI: '}&ldquo;{t.question}&rdquo;</p>
      {t.error && <p className="tries">Failed: {t.error}</p>}
      <p className="tries">Mic open {secs(t.micMs)} · you talked {secs(t.talkMs)}</p>
      {native && <p className="tries">*Android&apos;s voice gives no start signal, so its own start-up is not counted.</p>}
    </div>
  );
}

function HoldButton({ holdMs, onFire }: { holdMs: number; onFire(): void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const down = useRef(false);
  const fired = useRef(false);

  const begin = () => {
    down.current = true;
    fired.current = false;
    setHolding(true);
    if (holdMs > 0) {
      timer.current = setTimeout(() => {
        fired.current = true;
        down.current = false;
        setHolding(false);
        onFire();
      }, holdMs);
    }
  };
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (holdMs === 0 && down.current && !fired.current) {
      fired.current = true;
      onFire();
    }
    down.current = false;
    setHolding(false);
  };

  return (
    <button
      type="button" className={'hold-btn' + (holding ? ' on' : '')} style={{ '--hold': `${holdMs}ms` } as CSSProperties}
      aria-label={holdMs ? `Hold for ${holdMs / 1000} seconds to ask a question` : 'Tap to ask a question'}
      onPointerDown={begin} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFire(); } }}
    >
      <span className="hold-fill" aria-hidden="true" />
      <Icon name="mic" size={20} />
      <span>{holdMs ? `Hold ${holdMs / 1000} s to ask` : 'Tap to ask'}</span>
    </button>
  );
}

export interface VoiceProps {
  assistant: VoiceAssistant;
  state: AssistantSnapshot;
  holdMs: number;
  wakeLabel: string;
  /** Show how long the server took (for the owner). */
  showTiming?: boolean;
}

/** The hold-to-ask button, the "listening for…" hint, and the card that shows a question being answered. */
export default function VoiceDock({ assistant, state, holdMs, wakeLabel, showTiming }: VoiceProps) {
  const busy = state.status === 'listening' || state.status === 'thinking' || state.status === 'speaking';
  if (busy) {
    return (
      <div className="voice-card glass" role="status" aria-live="polite">
        <div className={'voice-state ' + state.status}>
          <Icon name="mic" size={20} />
          <b>{state.status === 'listening' ? 'Listening…' : state.status === 'thinking' ? (state.slow ? 'Still thinking…' : 'Thinking…') : state.message && !state.answer ? 'One moment' : 'Answering'}</b>
          <button className="btn secondary sm" onClick={() => void assistant.cancel()}>Cancel</button>
        </div>
        {state.transcript && <p className="voice-q">&ldquo;{state.transcript}&rdquo;</p>}
        {state.status === 'speaking' && state.answer && <p className="voice-a">{state.answer}</p>}
        {showTiming && state.ms > 0 && <p className="hint">Server answered in {(state.ms / 1000).toFixed(1)} s</p>}
      </div>
    );
  }
  return (
    <>
      <div className="voice-row">
        {state.status === 'waiting' && <span className="voice-chip"><i aria-hidden="true" /> Say &ldquo;{wakeLabel}&rdquo;</span>}
        {state.message && <span className="voice-msg" role="status">{state.message}</span>}
        {state.status !== 'off' && <HoldButton holdMs={holdMs} onFire={() => void assistant.trigger('hold')} />}
      </div>
      {showTiming && state.timing && <TimingCard t={state.timing} />}
    </>
  );
}
