import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import { apiBase } from '../lib/config';

export interface LicenseStatus {
  isValid: boolean;
  token?: string;
  error?: string;
}

/** valid: server confirmed. offline: server unreachable but confirmed recently. invalid: server refused.
 *  none: never activated. stale: server unreachable and the last confirmation is too old. */
export type LocalStatus = 'valid' | 'offline' | 'invalid' | 'none' | 'stale';

const TOKEN_KEY = 'binding_token';
const LAST_OK_KEY = 'license_last_ok';
const OWNER_KEY = 'is_owner';
const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
const NO_URL = 'This build is missing NEXT_PUBLIC_API_URL. Set it and rebuild.';

async function post(path: string, body: unknown, timeoutMs = 15000): Promise<{ status: number; data: any }> {
  const base = apiBase();
  if (base === null) throw new Error('no-url');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

export class LicenseService {
  static async getDeviceId(): Promise<string> {
    const { identifier } = await Device.getId();
    return identifier;
  }

  static async getToken(): Promise<string | null> {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    return value || null;
  }

  /** True on the owner's devices (signed in with the admin password instead of a license key). */
  static async isOwner(): Promise<boolean> {
    return (await Preferences.get({ key: OWNER_KEY })).value === '1';
  }

  /** Headers the server needs on every protected request. */
  static async authHeaders(): Promise<Record<string, string>> {
    const [token, deviceId] = [await this.getToken(), await this.getDeviceId()];
    return token ? { 'x-license-token': token, 'x-device-id': deviceId } : {};
  }

  static async clear() {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: LAST_OK_KEY });
    await Preferences.remove({ key: OWNER_KEY });
  }

  private static async store(token: string, owner: boolean) {
    await Preferences.set({ key: TOKEN_KEY, value: token });
    await Preferences.set({ key: LAST_OK_KEY, value: String(Date.now()) });
    if (owner) await Preferences.set({ key: OWNER_KEY, value: '1' });
    else await Preferences.remove({ key: OWNER_KEY });
  }

  /** First launch: bind a license key to this device. Needed only once per device. */
  static async validateLicense(licenseKey: string): Promise<LicenseStatus> {
    const key = licenseKey.trim().toUpperCase();
    if (!key) return { isValid: false, error: 'Enter your license key.' };
    try {
      const deviceId = await this.getDeviceId();
      const { status, data } = await post('/api/license/validate', { licenseKey: key, deviceId });
      if (status === 200 && typeof data.token === 'string') {
        await this.store(data.token, false);
        return { isValid: true, token: data.token };
      }
      return { isValid: false, error: data.error || `Could not activate (server replied ${status}).` };
    } catch (e) {
      return { isValid: false, error: (e as Error).message === 'no-url' ? NO_URL : 'Network error. Please check your connection.' };
    }
  }

  /** Owner: the admin password replaces the license key. */
  static async activateOwner(password: string): Promise<LicenseStatus> {
    if (!password) return { isValid: false, error: 'Enter the admin password.' };
    try {
      const deviceId = await this.getDeviceId();
      const { status, data } = await post('/api/license/owner', { password, deviceId });
      if (status === 200 && typeof data.token === 'string') {
        await this.store(data.token, true);
        return { isValid: true, token: data.token };
      }
      return { isValid: false, error: data.error || `Could not sign in (server replied ${status}).` };
    } catch (e) {
      return { isValid: false, error: (e as Error).message === 'no-url' ? NO_URL : 'Network error. Please check your connection.' };
    }
  }

  /** Runs silently on every launch and when the app returns to the foreground. Never asks for the key again. */
  static async checkLocalBinding(): Promise<LocalStatus> {
    const token = await this.getToken();
    if (!token) return 'none';
    const fallback = async (): Promise<LocalStatus> => {
      const { value } = await Preferences.get({ key: LAST_OK_KEY });
      return value && Date.now() - Number(value) < OFFLINE_GRACE_MS ? 'offline' : 'stale';
    };
    try {
      const deviceId = await this.getDeviceId();
      const { status } = await post('/api/license/verify', { token, deviceId });
      if (status === 200) {
        await Preferences.set({ key: LAST_OK_KEY, value: String(Date.now()) });
        return 'valid';
      }
      if (status === 401 || status === 403) {
        await this.clear();
        return 'invalid';
      }
      return fallback(); // 5xx or anything unexpected: don't lock out a paying student over a server hiccup
    } catch {
      return fallback();
    }
  }
}
