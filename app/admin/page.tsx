'use client';
import './admin.css';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Lic {
  key: string;
  label: string;
  status: 'active' | 'revoked';
  maxDevices: number;
  devices: string[];
  createdAt: string;
  activatedAt?: string;
}

const state = (l: Lic) => (l.status === 'revoked' ? 'revoked' : l.devices.length ? 'active' : 'unused');
const STATE_LABEL = { active: 'Active', unused: 'Not activated', revoked: 'Revoked' } as const;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function Admin() {
  const [pw, setPw] = useState('');
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState<Lic[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [count, setCount] = useState(1);
  const [maxDevices, setMaxDevices] = useState(1);
  const [fresh, setFresh] = useState<Lic[]>([]);

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2200);
  };

  const call = useCallback(async (method: string, body?: unknown, password?: string) => {
    const r = await fetch('/api/admin/licenses', {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${password ?? sessionStorage.getItem('em_admin') ?? ''}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
    return d;
  }, []);

  const load = useCallback(
    async (password?: string) => {
      try {
        const d = await call('GET', undefined, password);
        setRows(d.licenses);
        setAuthed(true);
        setError('');
        if (password) sessionStorage.setItem('em_admin', password);
      } catch (e) {
        setAuthed(false);
        sessionStorage.removeItem('em_admin');
        if ((e as { status?: number }).status !== undefined && (password ?? '') !== '') setError((e as Error).message);
      } finally {
        setChecking(false);
      }
    },
    [call],
  );

  useEffect(() => {
    const saved = sessionStorage.getItem('em_admin');
    if (saved) void load(saved);
    else setChecking(false);
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const d = await call('POST', { label, count, maxDevices });
      setFresh(d.licenses);
      setLabel('');
      await load();
    });
  const act = (key: string, action: string, msg: string) =>
    run(async () => {
      await call('PATCH', { key, action });
      await load();
      say(msg);
    });
  const remove = (key: string) =>
    run(async () => {
      if (!confirm(`Delete ${key}? The student will lose access and this cannot be undone.`)) return;
      await call('DELETE', { key });
      setFresh((f) => f.filter((x) => x.key !== key));
      await load();
      say('Deleted');
    });
  const rename = (l: Lic) =>
    run(async () => {
      const name = prompt('Label for this license (e.g. the student name)', l.label);
      if (name === null) return;
      await call('PATCH', { key: l.key, action: 'rename', label: name });
      await load();
    });

  const copy = async (text: string, msg = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      say(msg);
    } catch {
      say('Copy blocked. Select the text and copy it manually.');
    }
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.key.toLowerCase().includes(s) || r.label.toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  const stats = useMemo(() => {
    const c = { total: rows.length, active: 0, unused: 0, revoked: 0 };
    rows.forEach((r) => (c[state(r)]++));
    return c;
  }, [rows]);

  if (checking) return <div className="bg" aria-hidden="true" />;

  if (!authed) {
    return (
      <>
        <div className="bg" aria-hidden="true" />
        <main className="adm-auth">
          <section className="glass adm-card">
            <img className="adm-logo" src="/icon-256.png" alt="" width={64} height={64} />
            <h1>Exam Mate Admin</h1>
            <input className="field" type="password" placeholder="Admin password" aria-label="Admin password" autoFocus
              value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(pw)} />
            <button className="btn primary lg" onClick={() => load(pw)} disabled={!pw}>Sign in</button>
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <div className="bg" aria-hidden="true" />
      <main className="wrap">
        <div className="topbar">
          <div>
            <h1 className="title">Licenses</h1>
            <p className="sub">Give a student access, or take it away.</p>
          </div>
          <button className="btn secondary sm" onClick={() => { sessionStorage.removeItem('em_admin'); setAuthed(false); setPw(''); }}>Sign out</button>
        </div>

        <div className="stats">
          <div className="glass stat"><b>{stats.total}</b><span>Total</span></div>
          <div className="glass stat"><b>{stats.active}</b><span>Active</span></div>
          <div className="glass stat"><b>{stats.unused}</b><span>Not activated</span></div>
          <div className="glass stat"><b>{stats.revoked}</b><span>Revoked</span></div>
        </div>

        <details className="glass howto">
          <summary>How do I sign in on my own phone?</summary>
          <p>
            You do not need a license. Open the app, tap the app icon on the first screen <b>5 times</b>, and enter this
            same admin password. Your phone then uses the server&rsquo;s Gemini key and never asks for a license or a key of its own.
          </p>
        </details>

        <section className="card">
          <h2>New license</h2>
          <div className="gen">
            <label>Student or label
              <input className="field" value={label} placeholder="e.g. Brian, Owner" onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>How many
              <input className="field" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </label>
            <label>Devices
              <input className="field" type="number" min={1} max={10} value={maxDevices} onChange={(e) => setMaxDevices(Number(e.target.value))} />
            </label>
            <button className="btn primary" onClick={create} disabled={busy}>Generate</button>
          </div>
          {fresh.length > 0 && (
            <div className="fresh">
              <div className="fresh-head">
                <span>{fresh.length === 1 ? 'New key' : `${fresh.length} new keys`}</span>
                <button className="btn tinted sm" onClick={() => copy(fresh.map((f) => (f.label ? `${f.label}: ${f.key}` : f.key)).join('\n'), 'Copied all')}>Copy all</button>
              </div>
              <pre>{fresh.map((f) => (f.label ? `${f.label}: ${f.key}` : f.key)).join('\n')}</pre>
            </div>
          )}
        </section>

        <input className="field search" type="search" placeholder="Search by key or name" aria-label="Search licenses"
          value={q} onChange={(e) => setQ(e.target.value)} />

        {shown.length === 0 && <p className="adm-empty">{rows.length ? 'No matches.' : 'No licenses yet. Generate one above.'}</p>}

        {shown.map((l) => {
          const st = state(l);
          return (
            <article className="glass lic" key={l.key}>
              <div className="lic-top">
                <button className="keytxt" title="Tap to copy" onClick={() => copy(l.key, 'Key copied')}>{l.key}</button>
                <span className={`badge ${st}`}>{STATE_LABEL[st]}</span>
              </div>
              <div className="meta">
                <span><b>{l.label || 'No label'}</b></span>
                <span>Devices <b>{l.devices.length}/{l.maxDevices}</b></span>
                <span>Created <b>{fmt(l.createdAt)}</b></span>
                <span>Activated <b>{fmt(l.activatedAt)}</b></span>
              </div>
              <div className="acts">
                {l.status === 'active'
                  ? <button className="btn secondary sm" disabled={busy} onClick={() => act(l.key, 'revoke', 'Revoked: access ends next time the app checks')}>Revoke</button>
                  : <button className="btn tinted sm" disabled={busy} onClick={() => act(l.key, 'restore', 'Restored')}>Restore</button>}
                <button className="btn secondary sm" disabled={busy || l.devices.length === 0} onClick={() => act(l.key, 'reset', 'Device released: the key can be used on a new phone')}>Reset device</button>
                <button className="btn secondary sm" disabled={busy} onClick={() => rename(l)}>Rename</button>
                <button className="btn danger-ghost sm" style={{ width: 'auto', marginTop: 0 }} disabled={busy} onClick={() => remove(l.key)}>Delete</button>
              </div>
            </article>
          );
        })}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
