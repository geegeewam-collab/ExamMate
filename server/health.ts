import type { Store } from './license';

type Env = Record<string, string | undefined>;

/**
 * GET /api/health: shows which settings are present (yes/no only, never the values) and whether the database answers.
 * Open https://YOUR-SITE/api/health after every deploy.
 */
export async function health(store: Store, env: Env = process.env) {
  const has = (k: string) => !!(env[k] && env[k]!.trim());
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  const hints: string[] = [];

  if (!has('ADMIN_PASSWORD')) hints.push('ADMIN_PASSWORD is not set. Add it in Vercel > Settings > Environment Variables, then redeploy.');
  if (!has('TOKEN_SECRET')) hints.push('TOKEN_SECRET is not set. Generate a random 32-byte (64-character hex) value, then redeploy.');
  else if ((env.TOKEN_SECRET || '').length < 32) hints.push('TOKEN_SECRET is too short. Use at least 32 random characters (preferably 64 hex characters) and redeploy.');
  if (has('ADMIN_PASSWORD') && (env.ADMIN_PASSWORD || '').length < 16) hints.push('ADMIN_PASSWORD is short. Use at least 16 characters and redeploy.');
  if (!has('GEMINI_API_KEY')) hints.push('GEMINI_API_KEY is not set. Only your owner phones need it, but photos on your phone will fail without it.');
  if (!url) hints.push('UPSTASH_REDIS_REST_URL is not set (the database address).');
  else if (!/^https:\/\//.test(url)) hints.push('UPSTASH_REDIS_REST_URL must start with https://. You probably pasted the redis:// connection string. Use the REST URL.');
  if (!token) hints.push('UPSTASH_REDIS_REST_TOKEN is not set (the database token).');

  let database = 'not checked';
  if (url && token) {
    try {
      await store.hit('health', 60, 0);
      database = 'ok';
    } catch (e) {
      const why = String((e as Error)?.message || e).slice(0, 80);
      database = 'cannot connect (' + why + ')';
      hints.push('The database did not answer. Check that the REST URL and REST Token are copied exactly (no spaces or quotes) and belong to the same Upstash database.');
    }
  } else {
    database = 'not configured';
  }

  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') {
    hints.push(`This is a "${env.VERCEL_ENV}" deployment. Environment variables must be enabled for ${env.VERCEL_ENV} too. Use your main site address instead.`);
  }

  const ok = database === 'ok' && has('ADMIN_PASSWORD') && (env.ADMIN_PASSWORD || '').length >= 16 && has('TOKEN_SECRET') && (env.TOKEN_SECRET || '').length >= 32;
  return {
    ok,
    environment: env.VERCEL_ENV || 'local',
    settings: {
      ADMIN_PASSWORD: has('ADMIN_PASSWORD'),
      TOKEN_SECRET: has('TOKEN_SECRET'),
      GEMINI_API_KEY: has('GEMINI_API_KEY'),
      UPSTASH_REDIS_REST_URL: !!url,
      UPSTASH_REDIS_REST_TOKEN: !!token,
    },
    database,
    hints,
  };
}
