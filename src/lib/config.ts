const FROM_ENV = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');

/**
 * Where the server (licenses + photo answers) lives.
 * - On the website it is the same site, so no setting is needed.
 * - In the Android app there is no "same site", so NEXT_PUBLIC_API_URL must be set at build time.
 * Returns null when the app is a native build with no URL configured.
 */
export function apiBase(): string | null {
  if (FROM_ENV) return FROM_ENV;
  return isNativeApp() ? null : '';
}

/** True inside the installed Android app, false in a browser. */
export const isNativeApp = (): boolean => typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

// Optional: where students go to get a license (a WhatsApp link, website, mailto:...).
export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || '';
