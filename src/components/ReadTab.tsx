'use client';
import type { ChangeEvent, RefObject } from 'react';
import type { Resume, Settings } from '../lib/settings';
import { Icon, Segmented, Spinner } from './ui';

export interface Shot {
  url: string;
  busy: boolean;
  title: string;
  help: string;
  detail?: string;
  canRetry: boolean;
}

export interface ReadProps {
  settings: Settings;
  setStyle(s: Settings['style']): void;
  text: string;
  setText(t: string): void;
  msg: string;
  shot: Shot | null;
  count: number;
  resume: Resume | null;
  camRef: RefObject<HTMLInputElement | null>;
  galRef: RefObject<HTMLInputElement | null>;
  onCamera(): void;
  onGallery(): void;
  onPhotos(files: File[]): void;
  onFile(f: File): void;
  onStart(): void;
  onResume(): void;
  onPaste(): void;
  onRetry(): void;
  onCancel(): void;
}

export default function ReadTab(p: ReadProps) {
  const pick = (cb: (f: File[]) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (f.length) cb(f);
  };

  return (
    <>
      <header className="head">
        <h1 className="title">Exam Mate</h1>
        <p className="sub">Snap the questions. It reads the answers slowly so you can write them down.</p>
      </header>

      <section className="card hero" aria-label="Photo of the questions">
        <h2>Photo of the questions</h2>
        <Segmented label="Answer mode" value={p.settings.style}
          options={[{ value: 'quick', label: 'Quick answer' }, { value: 'learn', label: 'Learn' }]}
          onChange={p.setStyle} />
        <button className="btn primary xl" onClick={p.onCamera} disabled={p.shot?.busy}><Icon name="camera" /> Take photo</button>
        <button className="btn ghost" onClick={p.onGallery} disabled={p.shot?.busy}><Icon name="image" size={20} /> Choose from gallery</button>

        {p.shot && (
          <div className="shot" aria-live="polite">
            <img className="thumb" src={p.shot.url} alt="Your photo" />
            <div className="shot-text">
              <strong>{p.shot.busy && <Spinner />} {p.shot.title}</strong>
              <p>{p.shot.help}</p>
            </div>
            {p.shot.detail && <details><summary>Technical details</summary><pre>{p.shot.detail}</pre></details>}
            {p.shot.busy && <button className="btn secondary" onClick={p.onCancel}>Stop</button>}
            {p.shot.canRetry && <button className="btn secondary" onClick={p.onRetry}>Try again</button>}
          </div>
        )}
        <p className="fine">{p.count} photo{p.count === 1 ? '' : 's'} answered today on this phone</p>

        <input ref={p.camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick(p.onPhotos)} />
        <input ref={p.galRef} type="file" accept="image/*" multiple hidden onChange={pick(p.onPhotos)} />
      </section>

      <section className="card" aria-label="Text to read">
        <h2>Text to read</h2>
        <textarea className="field area" value={p.text} onChange={(e) => p.setText(e.target.value)}
          placeholder="Answers appear here. You can also paste any text." aria-label="Text to read" />
        {p.resume && (
          <button className="btn tinted" onClick={p.onResume}><Icon name="repeat" size={18} /> Resume from phrase {p.resume.idx + 1}</button>
        )}
        <div className="row">
          <button className="btn primary" onClick={p.onStart}><Icon name="play" size={18} /> Start reading</button>
          <button className="btn secondary" onClick={() => p.setText('')}>Clear</button>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={p.onPaste}><Icon name="clipboard" size={18} /> Paste &amp; start</button>
          <label className="btn ghost">
            <Icon name="doc" size={18} /> Load file
            <input type="file" hidden accept=".txt,.md,.docx,.pdf,text/plain,application/pdf"
              onChange={pick((f) => p.onFile(f[0]))} />
          </label>
        </div>
        <p className="msg" role="status" aria-live="polite">{p.msg}</p>
      </section>
    </>
  );
}
