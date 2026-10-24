import { formatVersion, parseVersion } from '../src/lib/version';
import { json } from './http';

/** The file the release workflow attaches to every GitHub Release. */
export const APK_NAME = 'ExamMate.apk';

const TTL_MS = 5 * 60_000; // how long one GitHub answer is reused
const STALE_MS = 24 * 60 * 60_000; // how long an old answer may stand in when GitHub is unreachable
const TIMEOUT_MS = 8_000;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export interface LatestRelease {
  version: string; // "1.0.1"
  apkUrl: string; // direct download of ExamMate.apk
  releaseUrl: string; // the release page
  size: number | null; // APK size in bytes
  publishedAt: string | null;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Which GitHub repo holds the releases ("owner/repo").
 * RELEASES_REPO wins (needed when the code repo is private and the APKs are published in a separate public repo).
 * Otherwise the repo Vercel deployed from is used, the same default as the /download page.
 */
export function releasesRepo(env: Env = process.env): string | null {
  const explicit = (env.RELEASES_REPO || '').trim();
  if (explicit) return REPO.test(explicit) ? explicit : null;
  const guess = env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : '';
  return REPO.test(guess) ? guess : null;
}

/**
 * Turns GitHub's "latest release" JSON into what the app needs, or null when that release is not an installable update:
 * a draft or pre-release, a tag that is not a plain version, or no finished ExamMate.apk attached yet
 * (GitHub shows a release a moment before its files finish uploading).
 * The links are built here from the repo and tag; nothing in the JSON is trusted as a link.
 */
export function pickRelease(repo: string, d: any): LatestRelease | null {
  if (!d || typeof d !== 'object' || d.draft === true || d.prerelease === true) return null;
  const tag = typeof d.tag_name === 'string' ? d.tag_name : '';
  const v = parseVersion(tag);
  if (!v) return null;
  const apk = (Array.isArray(d.assets) ? d.assets : []).find((a: any) => a && a.name === APK_NAME && a.state === 'uploaded');
  if (!apk) return null;
  const base = `https://github.com/${repo}/releases`;
  const size = Number(apk.size);
  return {
    version: formatVersion(v),
    apkUrl: `${base}/download/${encodeURIComponent(tag)}/${APK_NAME}`,
    releaseUrl: `${base}/tag/${encodeURIComponent(tag)}`,
    size: Number.isFinite(size) && size > 0 ? size : null,
    publishedAt: typeof d.published_at === 'string' ? d.published_at : null,
  };
}

/** GitHub could not be asked (network, rate limit, outage). */
export class UpstreamError extends Error {}

let cache: { repo: string; at: number; release: LatestRelease | null } | null = null;
let inflight: { repo: string; p: Promise<LatestRelease | null> } | null = null;
export const resetUpdateCache = () => { cache = null; inflight = null; };

async function fromGitHub(repo: string, fetchFn: Fetch): Promise<LatestRelease | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'exam-mate-update-check' },
      signal: ctl.signal,
    });
    if (r.status === 404) return null; // no published release yet
    if (!r.ok) throw new UpstreamError(`GitHub answered ${r.status}`);
    return pickRelease(repo, await r.json());
  } catch (e) {
    throw e instanceof UpstreamError ? e : new UpstreamError(String((e as Error)?.message || e).slice(0, 80));
  } finally {
    clearTimeout(t);
  }
}

/** The newest installable release, or null when there is none. Throws UpstreamError when GitHub cannot be reached and nothing recent is known. */
export async function latestRelease(repo: string, fetchFn: Fetch = fetch, now: () => number = Date.now): Promise<LatestRelease | null> {
  if (cache && cache.repo === repo && now() - cache.at < TTL_MS) return cache.release;
  if (inflight && inflight.repo === repo) return inflight.p;
  const p = (async () => {
    try {
      const release = await fromGitHub(repo, fetchFn);
      cache = { repo, at: now(), release };
      return release;
    } catch (e) {
      if (cache && cache.repo === repo && now() - cache.at < STALE_MS) return cache.release; // better an old answer than none
      throw e;
    } finally {
      inflight = null;
    }
  })();
  inflight = { repo, p };
  return p;
}

const NO_STORE = { 'cache-control': 'no-store' };
// Vercel's edge keeps one answer for 5 minutes, so phones never hit GitHub's rate limit; phones themselves always revalidate.
const SHARED = { 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' };

/** GET /api/update: the newest release the app can offer, as { latest: { version, apkUrl, releaseUrl, size, publishedAt } | null }. */
export async function handleUpdate(env: Env = process.env, fetchFn: Fetch = fetch, now: () => number = Date.now): Promise<Response> {
  const repo = releasesRepo(env);
  if (!repo) {
    return json({ code: 'not_configured', error: 'Update checks are not set up on the server. Set RELEASES_REPO to owner/repo.' }, 503, NO_STORE);
  }
  try {
    return json({ latest: await latestRelease(repo, fetchFn, now) }, 200, SHARED);
  } catch (e) {
    console.error('Update check failed:', (e as Error).message);
    return json({ code: 'upstream', error: 'Could not check for updates right now.' }, 502, NO_STORE);
  }
}
