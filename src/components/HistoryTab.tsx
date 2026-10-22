'use client';
import type { HistoryItem } from '../lib/settings';
import { Icon } from './ui';

export default function HistoryTab({ items, onOpen, onClear }: { items: HistoryItem[]; onOpen(t: string): void; onClear(): void }) {
  return (
    <>
      <header className="head">
        <h1 className="title">History</h1>
        <p className="sub">Your last answers, saved on this phone.</p>
      </header>
      {items.length === 0 ? (
        <section className="card empty">
          <Icon name="clock" size={30} />
          <p>Answers you get from photos will show up here.</p>
        </section>
      ) : (
        <>
          <div className="list glass">
            {items.map((h) => (
              <button key={h.t} type="button" className="item hist" onClick={() => onOpen(h.text)}>
                <span className="when">
                  {new Date(h.t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="snippet">{h.text}</span>
              </button>
            ))}
          </div>
          <button className="btn danger-ghost" onClick={onClear}><Icon name="trash" size={18} /> Clear history</button>
        </>
      )}
    </>
  );
}
