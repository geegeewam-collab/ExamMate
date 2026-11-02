'use client';
import './admin.css';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Lic {
  key: string; label: string; status: 'active' | 'revoked'; maxDevices: number;
  devices: string[]; createdAt: string; activatedAt?: string;
}
interface Guest { id: string; username: string; label: string; active: boolean; createdAt: string }
type Role = 'parent' | 'guest';
const state = (l: Lic) => (l.status === 'revoked' ? 'revoked' : l.devices.length ? 'active' : 'unused');
const STATE_LABEL = { active: 'Active', unused: 'Not activated', revoked: 'Revoked' } as const;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const TOKEN_KEY = 'em_admin_token';
const DEVICE_KEY = 'em_admin_device';

function deviceIdentity(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function Admin() {
  const [pw, setPw] = useState('');
  const [username, setUsername] = useState('');
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<Role>('guest');
  const [deviceId, setDeviceId] = useState('');
  const [token, setToken] = useState('');
  const [rows, setRows] = useState<Lic[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [count, setCount] = useState(1);
  const [maxDevices, setMaxDevices] = useState(1);
  const [fresh, setFresh] = useState<Lic[]>([]);
  const [guestLabel, setGuestLabel] = useState('');
  const [guestUsername, setGuestUsername] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');

  const say = (message: string) => setToast(message);

  const authRequest = useCallback(async (method: string, body?: unknown, suppliedToken?: string) => {
    const activeToken = suppliedToken ?? token;
    const activeDevice = deviceId || deviceIdentity();
    const r = await fetch('/api/admin/auth', {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${activeToken}`, 'x-admin-device': activeDevice },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Admin session request failed.'), { status: r.status });
    return data;
  }, [deviceId, token]);

  const apiCall = useCallback(async (path: string, method: string, body?: unknown) => {
    const r = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-admin-device': deviceId },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: r.status });
    return data;
  }, [deviceId, token]);

  const loadData = useCallback(async () => {
    const d = await apiCall('/api/admin/licenses', 'GET');
    setRows(Array.isArray(d.licenses) ? d.licenses : []);
    if (role === 'parent') {
      const g = await apiCall('/api/admin/guests', 'GET');
      setGuests(Array.isArray(g.guests) ? g.guests : []);
    }
  }, [apiCall, role]);

  const acceptSession = useCallback(async (nextToken: string, nextRole: Role) => {
    sessionStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setRole(nextRole);
    setAuthed(true);
    setError('');
  }, []);

  const signIn = useCallback(async () => {
    if (!pw.trim()) return;
    setBusy(true);
    setError('');
    try {
      const id = deviceId || deviceIdentity();
      setDeviceId(id);
      const r = await fetch('/api/admin/auth', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw, username: username.trim(), deviceId: id }), cache: 'no-store',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not sign in.');
      await acceptSession(data.token, data.role);
      setPw('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setChecking(false); }
  }, [acceptSession, deviceId, pw, username]);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(''); setAuthed(false); setRows([]); setGuests([]); setPw('');
  }, []);

  useEffect(() => {
    const id = deviceIdentity();
    setDeviceId(id);
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) { setChecking(false); return; }
    (async () => {
      try {
        const r = await fetch('/api/admin/auth', {
          method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${saved}`, 'x-admin-device': id },
          body: JSON.stringify({ action: 'refresh' }), cache: 'no-store',
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Session expired.');
        sessionStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token); setRole(data.role); setAuthed(true);
      } catch { sessionStorage.removeItem(TOKEN_KEY); }
      finally { setChecking(false); }
    })();
  }, []);

  useEffect(() => {
    if (!authed || !token || !deviceId) return;
    void loadData().catch((e) => { if ((e as { status?: number }).status === 401) signOut(); else say((e as Error).message); });
  }, [authed, token, deviceId, loadData, signOut]);

  useEffect(() => {
    if (!authed || !token || !deviceId) return;
    const timer = window.setInterval(() => {
      void authRequest('PATCH', { action: 'refresh' }).then((data) => {
        sessionStorage.setItem(TOKEN_KEY, data.token); setToken(data.token);
      }).catch(() => signOut());
    }, 8 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [authed, token, deviceId, authRequest, signOut]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); }
    catch (e) { say((e as Error).message); }
    finally { setBusy(false); }
  }

  const create = () => run(async () => {
    const d = await apiCall('/api/admin/licenses', 'POST', { label, count, maxDevices });
    setFresh(d.licenses || []); setLabel(''); await loadData();
  });
  const act = (key: string, action: string, message: string) => run(async () => {
    await apiCall('/api/admin/licenses', 'PATCH', { key, action }); await loadData(); say(message);
  });
  const remove = (key: string) => run(async () => {
    if (!confirm(`Delete ${key}? The student will lose access and this cannot be undone.`)) return;
    await apiCall('/api/admin/licenses', 'DELETE', { key });
    setFresh((items) => items.filter((item) => item.key !== key)); await loadData(); say('Deleted');
  });
  const rename = (lic: Lic) => run(async () => {
    const name = prompt('Label for this license', lic.label);
    if (name === null) return;
    await apiCall('/api/admin/licenses', 'PATCH', { key: lic.key, action: 'rename', label: name }); await loadData();
  });
  const copy = async (text: string, message = 'Copied') => {
    try { await navigator.clipboard.writeText(text); say(message); }
    catch { say('Copy blocked. Select the text and copy it manually.'); }
  };

  const shown = useMemo(() => {
    const search = q.trim().toLowerCase();
    return search ? rows.filter((r) => r.key.toLowerCase().includes(search) || r.label.toLowerCase().includes(search)) : rows;
  }, [rows, q]);
  const stats = useMemo(() => {
    const counts = { total: rows.length, active: 0, unused: 0, revoked: 0 };
    rows.forEach((lic) => counts[state(lic)]++);
    return counts;
  }, [rows]);

  const createGuest = () => run(async () => {
    const response = await apiCall('/api/admin/guests', 'POST', { label: guestLabel, username: guestUsername, password: guestPassword });
    setGuestLabel(''); setGuestUsername(''); setGuestPassword('');
    await loadData(); say(`Guest ${response.guest.username} created`);
  });
  const revokeGuest = (id: string) => run(async () => {
    await apiCall('/api/admin/guests', 'DELETE', { id }); await loadData(); say('Guest access removed');
  });
  const changePassword = () => run(async () => {
    if (newPassword !== newPasswordAgain) throw new Error('The new passwords do not match.');
    const data = await authRequest('PATCH', { action: 'change-password', currentPassword, newPassword });
    await acceptSession(data.token, 'parent');
    setCurrentPassword(''); setNewPassword(''); setNewPasswordAgain('');
    say('Password changed. Other admin sessions were signed out.');
  });
  const logoutOthers = () => run(async () => {
    if (!confirm('Sign out every other admin session? This device will stay signed in.')) return;
    const data = await authRequest('PATCH', { action: 'logout-others' });
    await acceptSession(data.token, 'parent');
    say('Other admin sessions signed out.');
  });

  if (checking) return <div className="bg" aria-hidden="true" />;
  if (!authed) return (
    <>
      <div className="bg" aria-hidden="true" />
      <main className="adm-auth"><section className="glass adm-card">
        <img className="adm-logo" src="/icon-256.png" alt="" width={64} height={64} />
        <h1>ExamMate Admin</h1>
        <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Guest username (leave blank for parent)" aria-label="Guest username" autoComplete="username" />
        <input className="field" type="password" placeholder={username ? 'Guest password' : 'Admin password'} aria-label="Password" autoComplete="current-password" autoFocus
          value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void signIn()} />
        <button className="btn primary lg" onClick={() => void signIn()} disabled={!pw || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="adm-note">Parent admin has full access. Guest accounts are read-only.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section></main>
    </>
  );

  return (
    <>
      <div className="bg" aria-hidden="true" />
      <main className="wrap">
        <div className="topbar"><div><h1 className="title">Licenses</h1><p className="sub">{role === 'parent' ? 'Manage access and admin accounts.' : 'Read-only admin access.'}</p></div>
          <div className="admin-actions"><span className={`admin-role ${role}`}>{role === 'parent' ? 'Parent admin' : 'Guest'}</span><button className="btn secondary sm" onClick={signOut}>Sign out</button></div>
        </div>
        <div className="stats">
          <div className="glass stat"><b>{stats.total}</b><span>Total</span></div><div className="glass stat"><b>{stats.active}</b><span>Active</span></div>
          <div className="glass stat"><b>{stats.unused}</b><span>Not activated</span></div><div className="glass stat"><b>{stats.revoked}</b><span>Revoked</span></div>
        </div>

        {role === 'parent' && <>
          <details className="glass howto"><summary>Admin security</summary>
            <div className="security-actions">
              <section><h3>Change password</h3><input className="field" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" />
                <input className="field" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (12+ characters)" autoComplete="new-password" />
                <input className="field" type="password" value={newPasswordAgain} onChange={(e) => setNewPasswordAgain(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" />
                <button className="btn primary sm" disabled={busy || !currentPassword || !newPassword || !newPasswordAgain} onClick={() => void changePassword()}>Update password</button></section>
              <button className="btn secondary sm" disabled={busy} onClick={() => void logoutOthers()}>Log out other devices</button>
            </div>
          </details>
          <details className="glass howto"><summary>Guest accounts</summary>
            <section className="guest-create"><h3>Create read-only guest</h3>
              <input className="field" value={guestLabel} onChange={(e) => setGuestLabel(e.target.value)} placeholder="Guest name" aria-label="Guest name" />
              <input className="field" value={guestUsername} onChange={(e) => setGuestUsername(e.target.value)} placeholder="Username" aria-label="Guest username" autoComplete="off" />
              <input className="field" type="password" value={guestPassword} onChange={(e) => setGuestPassword(e.target.value)} placeholder="Password (10+ characters)" aria-label="Guest password" autoComplete="new-password" />
              <button className="btn primary sm" disabled={busy || !guestUsername || !guestPassword} onClick={() => void createGuest()}>Create guest</button>
            </section>
            {guests.map((guest) => <div className="guest-row" key={guest.id}><span><b>{guest.label || guest.username}</b><small>{guest.username} · {guest.active ? 'Active' : 'Revoked'}</small></span>
              {guest.active && <button className="btn danger-ghost sm" style={{ width: 'auto', marginTop: 0 }} onClick={() => void revokeGuest(guest.id)} disabled={busy}>Revoke</button>}</div>)}
          </details>
          <section className="card"><h2>New license</h2><div className="gen">
            <label>Student or label<input className="field" value={label} placeholder="e.g. Student name" onChange={(e) => setLabel(e.target.value)} /></label>
            <label>How many<input className="field" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
            <label>Devices<input className="field" type="number" min={1} max={10} value={maxDevices} onChange={(e) => setMaxDevices(Number(e.target.value))} /></label>
            <button className="btn primary" onClick={() => void create()} disabled={busy}>Generate</button>
          </div>
          {fresh.length > 0 && <div className="fresh"><div className="fresh-head"><span>{fresh.length === 1 ? 'New key' : `${fresh.length} new keys`}</span>
            <button className="btn tinted sm" onClick={() => void copy(fresh.map((f) => f.label ? `${f.label}: ${f.key}` : f.key).join('\n'), 'Copied all')}>Copy all</button></div>
            <pre>{fresh.map((f) => f.label ? `${f.label}: ${f.key}` : f.key).join('\n')}</pre></div>}
          </section>
        </>}

        <input className="field search" type="search" placeholder="Search by key or name" aria-label="Search licenses" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length === 0 && <p className="adm-empty">{rows.length ? 'No matches.' : 'No licenses yet.'}</p>}
        {shown.map((lic) => {
          const st = state(lic);
          return <article className="glass lic" key={lic.key}><div className="lic-top"><button className="keytxt" title="Tap to copy" onClick={() => void copy(lic.key, 'Key copied')}>{lic.key}</button><span className={`badge ${st}`}>{STATE_LABEL[st]}</span></div>
            <div className="meta"><span><b>{lic.label || 'No label'}</b></span><span>Devices <b>{lic.devices.length}/{lic.maxDevices}</b></span><span>Created <b>{fmt(lic.createdAt)}</b></span><span>Activated <b>{fmt(lic.activatedAt)}</b></span></div>
            {role === 'parent' && <div className="acts">
              {lic.status === 'active' ? <button className="btn secondary sm" disabled={busy} onClick={() => void act(lic.key, 'revoke', 'License revoked')}>Revoke</button> : <button className="btn tinted sm" disabled={busy} onClick={() => void act(lic.key, 'restore', 'License restored')}>Restore</button>}
              <button className="btn secondary sm" disabled={busy || lic.devices.length === 0} onClick={() => void act(lic.key, 'reset', 'Device slots released')}>Reset devices</button>
              <button className="btn secondary sm" disabled={busy} onClick={() => void rename(lic)}>Rename</button>
              <button className="btn danger-ghost sm" style={{ width: 'auto', marginTop: 0 }} disabled={busy} onClick={() => void remove(lic.key)}>Delete</button>
            </div>}
          </article>;
        })}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
