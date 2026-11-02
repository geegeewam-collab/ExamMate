'use client';
import { useMemo, useState } from 'react';
import type { HistoryItem } from '../lib/settings';
import { Icon } from './ui';

export default function HistoryTab({ items, onOpen, onClear, onRename }: {
  items: HistoryItem[];
  onOpen(item: HistoryItem): void;
  onClear(): void;
  onRename(t: number, title: string): void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? items.filter((item) => `${item.title ?? ''} ${item.text}`.toLocaleLowerCase().includes(q)) : items;
  }, [items, query]);
  return (
    <>
      <header className="head">
        <h1 className="title">History</h1>
        <p className="sub">Your saved papers.</p>
      </header>
      {items.length > 0 && <label className="history-search"><Icon name="search" size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search papers" aria-label="Search saved papers" /><button type="button" onClick={() => setQuery('')} aria-label="Clear search" hidden={!query}>×</button></label>}
      {items.length === 0 ? (
        <section className="card empty"><Icon name="clock" size={30} /><p>Answered papers will appear here.</p></section>
      ) : shown.length === 0 ? (
        <section className="card empty"><Icon name="search" size={28} /><p>No saved papers match that search.</p></section>
      ) : (
        <>
          <div className="list glass">
            {shown.map((h) => (
              <div key={h.t} className="history-entry">
                <button type="button" className="history-open" onClick={() => onOpen(h)}>
                  <span className="when">{new Date(h.t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <b className="history-title">{h.title || h.text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 58) || 'Saved paper'}</b>
                  <span className="snippet">{h.text}</span>
                </button>
                {editing === h.t ? (
                  <form className="history-rename-form" onSubmit={(event) => {
                    event.preventDefault();
                    const title = draftTitle.trim();
                    if (title) onRename(h.t, title.slice(0, 80));
                    setEditing(null);
                  }}>
                    <input autoFocus maxLength={80} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="New paper name" />
                    <button type="submit" disabled={!draftTitle.trim()} aria-label="Save paper name">Save</button>
                    <button type="button" onClick={() => setEditing(null)} aria-label="Cancel rename">Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="history-rename" aria-label={`Rename ${h.title || 'paper'}`} onClick={() => {
                    setDraftTitle(h.title || '');
                    setEditing(h.t);
                  }}>Rename</button>
                )}
              </div>
            ))}
          </div>
          <button className="btn danger-ghost" onClick={onClear}><Icon name="trash" size={18} /> Clear history</button>
        </>
      )}
    </>
  );
}
