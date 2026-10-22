/** Small JSON wrapper over localStorage. Never throws (private mode, quota, server render). */
export const kv = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('em_' + key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('em_' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  del(key: string) {
    try {
      localStorage.removeItem('em_' + key);
    } catch {
      /* ignore */
    }
  },
};
