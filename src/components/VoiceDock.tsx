'use client';
import { useRef, useState, type CSSProperties } from 'react';
import type { AssistantSnapshot, VoiceAssistant } from '../lib/voice/assistant';
import { Icon } from './ui';

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
}

/** The hold-to-ask button, the "listening for…" hint, and the card that shows a question being answered. */
export default function VoiceDock({ assistant, state, holdMs, wakeLabel }: VoiceProps) {
  const busy = state.status === 'listening' || state.status === 'thinking' || state.status === 'speaking';
  if (busy) {
    return (
      <div className="voice-card glass" role="status" aria-live="polite">
        <div className={'voice-state ' + state.status}>
          <Icon name="mic" size={20} />
          <b>{state.status === 'listening' ? 'Listening…' : state.status === 'thinking' ? 'Thinking…' : 'Answering'}</b>
          <button className="btn secondary sm" onClick={() => void assistant.cancel()}>Cancel</button>
        </div>
        {state.transcript && <p className="voice-q">&ldquo;{state.transcript}&rdquo;</p>}
        {state.status === 'speaking' && state.answer && <p className="voice-a">{state.answer}</p>}
      </div>
    );
  }
  return (
    <div className="voice-row">
      {state.status === 'waiting' && <span className="voice-chip"><i aria-hidden="true" /> Say &ldquo;{wakeLabel}&rdquo;</span>}
      {state.message && <span className="voice-msg" role="status">{state.message}</span>}
      {state.status !== 'off' && <HoldButton holdMs={holdMs} onFire={() => void assistant.trigger('hold')} />}
    </div>
  );
}
