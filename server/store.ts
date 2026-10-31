import { Redis } from '@upstash/redis';
import { parseDeviceClaimResult, type DeviceClaim, type License, type Store } from './license';

let r: Redis | null = null;

// One Redis-side atomic operation prevents concurrent first activations from exceeding maxDevices.
const CLAIM_DEVICE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local lic = cjson.decode(raw)
if lic.status ~= 'active' then return {'revoked'} end
local devices = lic.devices or {}
for i = 1, #devices do
  if devices[i] == ARGV[1] then
    return {'ok', cjson.encode(lic)}
  end
end
local maximum = tonumber(lic.maxDevices) or 1
if #devices >= maximum then return {'limit'} end
table.insert(devices, ARGV[1])
lic.devices = devices
if not lic.activatedAt or lic.activatedAt == cjson.null then lic.activatedAt = ARGV[2] end
redis.call('SET', KEYS[1], cjson.encode(lic))
return {'ok', cjson.encode(lic)}
`;
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
  async claimDevice(key, deviceId): Promise<DeviceClaim> {
    // @upstash/redis constrains EVAL's result generic to unknown[]. The Lua
    // script returns a Redis array, not a top-level JSON string.
    const result = await db().eval<[string, string?]>(
      CLAIM_DEVICE_SCRIPT,
      ['lic:' + key],
      [deviceId, new Date().toISOString()],
    );
    return parseDeviceClaimResult(result);
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
