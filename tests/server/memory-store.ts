import type { License, Store } from '../../server/license';

export function memoryStore(): Store & { counters: Map<string, number>; licenses: Map<string, License> } {
  const licenses = new Map<string, License>();
  const counters = new Map<string, number>();
  return {
    licenses,
    counters,
    async get(k) { const l = licenses.get(k); return l ? structuredClone(l) : null; },
    async put(l) { licenses.set(l.key, structuredClone(l)); },
    async del(k) { licenses.delete(k); },
    async list() { return [...licenses.values()].map((l) => structuredClone(l)); },
    async hit(k, _ttl, delta = 1) {
      const n = (counters.get(k) ?? 0) + delta;
      if (delta !== 0) counters.set(k, Math.max(0, n));
      return n;
    },
  };
}

export const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x' + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
