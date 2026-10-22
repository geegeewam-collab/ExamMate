import { Redis } from '@upstash/redis';
import type { License, Store } from './license';

let r: Redis | null = null;
const db = () =>
  (r ??= new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
  }));

export const store: Store = {
  async get(key) {
    return (await db().get<License>('lic:' + key)) ?? null;
  },
  async put(lic) {
    await db().set('lic:' + lic.key, lic);
    await db().sadd('lics', lic.key);
  },
  async del(key) {
    await db().del('lic:' + key);
    await db().srem('lics', key);
  },
  async list() {
    const keys = await db().smembers('lics');
    if (!keys.length) return [];
    const rows = await db().mget<(License | null)[]>(...keys.map((k) => 'lic:' + k));
    return rows.filter((x): x is License => !!x);
  },
  async hit(key, ttlSec, delta = 1) {
    const k = 'hit:' + key;
    if (delta === 0) return Number((await db().get<number>(k)) ?? 0); // read only; never creates a key
    const n = await db().incrby(k, delta);
    if (n <= 0) await db().del(k); // refunded below zero (the counter had already expired)
    else if (delta > 0 && n === delta) await db().expire(k, ttlSec);
    return n;
  },
};
