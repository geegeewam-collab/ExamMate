/**
 * Version helpers shared by the app and the server.
 * Releases use plain MAJOR.MINOR.PATCH numbers (the GitHub tag is "v1.0.1"). Anything else is not a release version.
 */
export type Version = readonly [number, number, number];

const PLAIN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export function parseVersion(s: unknown): Version | null {
  if (typeof s !== 'string') return null;
  const m = PLAIN.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export const formatVersion = (v: Version): string => v.join('.');

/** Negative when a is older than b, 0 when equal, positive when a is newer. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** True only when both are valid versions and `latest` is strictly newer than `installed`. */
export function isNewer(latest: unknown, installed: unknown): boolean {
  const l = parseVersion(latest);
  const i = parseVersion(installed);
  return !!l && !!i && compareVersions(l, i) > 0;
}
