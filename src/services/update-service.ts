import { apiBase } from '../lib/config';
import { isAndroidNative } from '../lib/platform';
import { compareVersions } from '../lib/update';

export interface UpdateInfo { version: string; current: string; apkUrl: string; notes: string; required: boolean }

interface UpdaterPlugin {
  getAppInfo(): Promise<{ versionName: string; versionCode: number }>;
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(o: { url: string }): Promise<void>;
  addListener(eventName: 'progress', listener: (event: { percent: number }) => void): Promise<{ remove(): Promise<void> }>;
}

let load: Promise<UpdaterPlugin | null> | null = null;
function updater(): Promise<UpdaterPlugin | null> {
  load ??= import('@capacitor/core')
    .then(({ registerPlugin }) => {
      const plugin = registerPlugin<UpdaterPlugin>('ExamMateUpdater');
      // A plain wrapper: returning the plugin Proxy itself from a promise never resolves.
      const plain: UpdaterPlugin = {
        getAppInfo: () => plugin.getAppInfo(),
        canInstall: () => plugin.canInstall(),
        openInstallSettings: () => plugin.openInstallSettings(),
        downloadAndInstall: (o) => plugin.downloadAndInstall(o),
        addListener: (eventName, listener) => plugin.addListener(eventName, listener),
      };
      return plain;
    })
    .catch(() => null);
  return load;
}

export const UpdateService = {
  /** A newer Android release, or null (web, offline, no release, or already up to date). Never throws. */
  async check(): Promise<UpdateInfo | null> {
    try {
      const base = apiBase();
      if (!isAndroidNative() || base === null) return null;
      const plugin = await updater();
      if (!plugin) return null;
      const [{ versionName }, res] = await Promise.all([
        plugin.getAppInfo(),
        fetch(`${base}/api/app-version`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
      ]);
      if (!res.ok || !versionName) return null;
      const d = await res.json();
      const version = String(d?.version ?? '');
      const apkUrl = String(d?.apkUrl ?? '');
      if (!/^\d+(\.\d+)*$/.test(version) || !/^https:\/\//.test(apkUrl)) return null;
      if (compareVersions(version, versionName) <= 0) return null;
      const minVersion = String(d?.minVersion ?? '');
      return {
        version,
        current: versionName,
        apkUrl,
        notes: String(d?.notes ?? '').slice(0, 600),
        required: !!minVersion && compareVersions(versionName, minVersion) < 0,
      };
    } catch {
      return null;
    }
  },

  async canInstall(): Promise<boolean> {
    const plugin = await updater();
    return plugin ? (await plugin.canInstall()).allowed : false;
  },

  async openInstallSettings(): Promise<void> {
    await (await updater())?.openInstallSettings();
  },

  /** Downloads the APK (reporting 0–100) and opens Android's installer. Rejects with a readable message. */
  async install(url: string, onProgress: (percent: number) => void): Promise<void> {
    const plugin = await updater();
    if (!plugin) throw new Error('Updates are not available on this device.');
    const listener = await plugin.addListener('progress', (e) => onProgress(e.percent));
    try {
      await plugin.downloadAndInstall({ url });
    } finally {
      await listener.remove();
    }
  },
};
