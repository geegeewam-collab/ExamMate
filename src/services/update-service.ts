import { apiBase, isNativeApp } from '../lib/config';
import { kv } from '../lib/storage';
import { formatVersion, isNewer, parseVersion } from '../lib/version';
import type { CheckResult, Snooze, SnoozeStore, UpdateInfo } from '../lib/update-controller';

/**
 * The version of this installed app. The release workflow passes the same number to Gradle (versionName)
 * and to the app bundle (NEXT_PUBLIC_APP_VERSION), so they cannot disagree. Null when the build did not set it.
 */
export function installedVersion(): string | null {
  const v = parseVersion(process.env.NEXT_PUBLIC_APP_VERSION);
  return v ? formatVersion(v) : null;
}

/** Update checks only make sense in the installed Android app: the website updates itself. */
export const updatesSupported = (): boolean => isNativeApp() && installedVersion() !== null && apiBase() !== null;

/** Only GitHub download links are accepted, however the answer reached us. The link leads to installing code. */
function githubUrl(u: unknown): string | null {
  if (typeof u !== 'string' || u.length > 600) return null;
  try {
    const x = new URL(u);
    const ok = x.protocol === 'https:' && x.hostname === 'github.com' && !x.port && !x.username && !x.password;
    return ok ? x.toString() : null;
  } catch {
    return null;
  }
}

/** Checks the server's answer for one release and returns it only when it is complete and safe to show. */
export function readLatest(d: unknown): UpdateInfo | null {
  const o = d as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const v = parseVersion(o.version);
  const apkUrl = githubUrl(o.apkUrl);
  const releaseUrl = githubUrl(o.releaseUrl);
  if (!v || !apkUrl || !releaseUrl) return null;
  const size = Number(o.size);
  return { version: formatVersion(v), apkUrl, releaseUrl, size: Number.isFinite(size) && size > 0 ? size : null };
}

/** Asks our server for the newest release and compares it with the installed version. Never throws. */
export async function checkForUpdate(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<CheckResult> {
  const installed = installedVersion();
  const base = apiBase();
  if (!installed || base === null) return { state: 'failed' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/api/update`, { signal: ctl.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    if (!res.ok) return { state: 'failed' };
    const body = await res.json();
    if (!body || typeof body !== 'object' || !('latest' in body)) return { state: 'failed' };
    if (body.latest === null) return { state: 'current' }; // nothing published yet
    const latest = readLatest(body.latest);
    if (!latest) return { state: 'failed' };
    return isNewer(latest.version, installed) ? { state: 'available', update: latest } : { state: 'current' };
  } catch {
    return { state: 'failed' };
  } finally {
    clearTimeout(t);
  }
}

/** "Remind me later" memory, kept on the phone. */
export const snoozeStore: SnoozeStore = {
  get(): Snooze | null {
    const s = kv.get<{ version?: unknown; until?: unknown } | null>('update_snooze', null);
    return s && typeof s.version === 'string' && typeof s.until === 'number' ? { version: s.version, until: s.until } : null;
  },
  set(s) {
    if (s) kv.set('update_snooze', s);
    else kv.del('update_snooze');
  },
};
