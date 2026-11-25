import { json } from './http';

/** What the app needs to offer an update. `minVersion` (optional) makes older apps update before continuing. */
export interface AppVersion { version: string; apkUrl: string; notes: string; minVersion: string; publishedAt: string }

type Env = Record<string, string | undefined>;
const CACHE_MS = 5 * 60_000;
let cache: { at: number; repo: string; value: AppVersion } | null = null;
export const resetAppVersionCache = () => { cache = null; };

/** GitHub repo that publishes ExamMate.apk releases: APP_RELEASES_REPO, else the repo Vercel deployed from. */
export function releasesRepo(env: Env = process.env): string {
  const repo = env.APP_RELEASES_REPO || (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : '');
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '';
}

/** Release notes as short plain text: no markdown, links or the auto-generated "Full Changelog" line. */
export function plainNotes(body: unknown): string {
  return String(body ?? '')
    .split(/\r?\n/)
    .filter((line) => !/full changelog|^#+\s*what'?s changed\s*$/i.test(line))
    .map((line) => line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/^\s*#+\s*/, '').replace(/^\s*[-+*]\s+/, '• ').replace(/[*_`]/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 600);
}

/** Latest published release with an ExamMate.apk asset, cached for five minutes (stale copy kept if GitHub fails). */
export async function latestAppVersion(env: Env = process.env, now = Date.now()): Promise<AppVersion | null> {
  const repo = releasesRepo(env);
  if (!repo) return null;
  if (cache && cache.repo === repo && now - cache.at < CACHE_MS) return cache.value;
  try {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'exammate-update-check' };
    if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return cache?.repo === repo ? cache.value : null;
    const d = await r.json();
    const version = String(d?.tag_name ?? '').replace(/^v/i, '');
    const asset = (Array.isArray(d?.assets) ? d.assets : []).find((a: any) => a?.name === 'ExamMate.apk');
    const apkUrl = env.NEXT_PUBLIC_APK_URL || String(asset?.browser_download_url ?? '');
    if (!/^\d+(\.\d+)*$/.test(version) || !/^https:\/\//.test(apkUrl)) return cache?.repo === repo ? cache.value : null;
    const value: AppVersion = {
      version,
      apkUrl,
      notes: plainNotes(d.body),
      minVersion: /^\d+(\.\d+)*$/.test(env.MIN_APP_VERSION || '') ? env.MIN_APP_VERSION! : '',
      publishedAt: String(d.published_at ?? ''),
    };
    cache = { at: now, repo, value };
    return value;
  } catch {
    return cache?.repo === repo ? cache.value : null;
  }
}

/** GET /api/app-version -> AppVersion, or 404 when no release is configured. */
export async function handleAppVersion(): Promise<Response> {
  const value = await latestAppVersion();
  return value ? json(value) : json({ error: 'No app release is available.' }, 404);
}
