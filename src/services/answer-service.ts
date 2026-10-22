import { API_URL } from '../lib/config';
import { shrink, toDataURL } from '../lib/image';
import { LicenseService } from './license-service';

export interface Answer {
  text: string;
  items: { label: string; answer: string }[];
}

/** The server refused the license (revoked, or not valid for this device). */
export class LicenseError extends Error {}
export class AnswerError extends Error {
  constructor(message: string, public status = 0, public detail = '') {
    super(message);
  }
}

const MESSAGES: Record<number, string> = {
  413: 'Photo too large. Try fewer or smaller photos.',
  429: 'Too many requests right now. Try again in a minute.',
};

export async function answerPhotos(files: File[], style: 'quick' | 'learn', signal?: AbortSignal): Promise<Answer> {
  if (!API_URL) throw new AnswerError('This build is missing NEXT_PUBLIC_API_URL.');
  const images = await Promise.all(files.slice(0, 3).map(async (f) => toDataURL(await shrink(f))));
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await LicenseService.authHeaders()) },
      body: JSON.stringify({ images, style }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AnswerError('Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 'license') throw new LicenseError(data.error || 'License not valid.');
    throw new AnswerError(data.error || MESSAGES[res.status] || 'The photo could not be processed.', res.status, data.detail || '');
  }
  return { text: String(data.text || '').trim(), items: Array.isArray(data.items) ? data.items : [] };
}
