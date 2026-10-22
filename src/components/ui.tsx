import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'camera' | 'image' | 'clipboard' | 'doc' | 'play' | 'pause' | 'prev' | 'next' | 'repeat'
  | 'close' | 'pencil' | 'book' | 'clock' | 'sliders' | 'check' | 'alert' | 'headphones' | 'trash' | 'copy';

const PATHS: Record<IconName, ReactNode> = {
  camera: (<><path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3V19H4z" /><circle cx="12" cy="13.4" r="3.4" /></>),
  image: (<><rect x="3.5" y="4.5" width="17" height="15" rx="3.2" /><circle cx="9" cy="10" r="1.5" /><path d="M4.5 17.5l4.6-4.6 3.6 3.6 2.6-2.6 4.2 4.2" /></>),
  clipboard: (<><rect x="5" y="5" width="14" height="16" rx="3" /><rect x="9" y="3" width="6" height="4" rx="1.6" /></>),
  doc: (<><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M9.5 12.5h5M9.5 16h5" /></>),
  play: <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />,
  pause: (<><rect x="6.2" y="4.6" width="3.8" height="14.8" rx="1.3" /><rect x="14" y="4.6" width="3.8" height="14.8" rx="1.3" /></>),
  prev: (<><rect x="5" y="5.5" width="2.4" height="13" rx="1.2" /><path d="M19 6.2v11.6a.6.6 0 0 1-.9.5L9.4 12.5a.6.6 0 0 1 0-1l8.7-5.8a.6.6 0 0 1 .9.5z" /></>),
  next: (<><rect x="16.6" y="5.5" width="2.4" height="13" rx="1.2" /><path d="M5 6.2v11.6a.6.6 0 0 0 .9.5l8.7-5.8a.6.6 0 0 0 0-1L5.9 5.7a.6.6 0 0 0-.9.5z" /></>),
  repeat: (<><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 4.5v4h-4" /></>),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  pencil: (<><path d="M4.5 19.5l.9-3.9L16 5l3 3L8.4 18.6z" /><path d="M13.8 7.2l3 3" /></>),
  book: (<><path d="M4 5.8c2.2-1 5-.9 8 .7 3-1.6 5.8-1.7 8-.7v12.7c-2.2-.9-5-.8-8 .8-3-1.6-5.8-1.7-8-.8z" /><path d="M12 6.5V19" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  sliders: (<><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>),
  check: <path d="M5 12.6l4.5 4.4L19 7.6" />,
  alert: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.6M12 16.2v.1" /></>),
  headphones: (<><path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" /><rect x="3.5" y="13.5" width="4" height="6.5" rx="2" /><rect x="16.5" y="13.5" width="4" height="6.5" rx="2" /></>),
  trash: (<><path d="M5 7h14M10 7V4.8h4V7M7 7l.8 12.2h8.4L17 7" /></>),
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2.6" /><path d="M15.5 8.5V6.6A2.1 2.1 0 0 0 13.4 4.5H6.6A2.1 2.1 0 0 0 4.5 6.6v6.8a2.1 2.1 0 0 0 2.1 2.1h1.9" /></>),
};
const FILLED: IconName[] = ['play', 'pause', 'prev', 'next'];

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

export const Spinner = () => <span className="spinner" role="progressbar" aria-label="Loading" />;

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={'switch' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  const i = options.findIndex((o) => o.value === value);
  return (
    <div className={'seg' + (i < 0 ? ' none' : '')} role="radiogroup" aria-label={label}
      style={{ '--n': options.length, '--i': Math.max(0, i) } as CSSProperties}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Range({
  label, value, min, max, step, format, onChange,
}: { label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="item col">
      <div className="item-line">
        <span>{label}</span>
        <span className="val">{format(value)}</span>
      </div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
        style={{ '--p': pct + '%' } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
