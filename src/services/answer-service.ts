import { apiBase } from '../lib/config';
import { shrink, toDataURL } from '../lib/image';
import { GeminiKey } from './gemini-key';
import { LicenseService } from './license-service';

export interface Answer {
  text: string;
  items: { label: string; answer: string }[];
  questionCount: number;
}

export interface AnswerProgress {
  message: string;
  detail: string;
  completedPages: number;
  totalPages: number;
  progress: number;
}

/** The server refused the license (revoked, or not valid for this device). */
export class LicenseError extends Error {}
/** The student's own Gemini key is missing or was refused by Google. */
export class KeyError extends Error {}
export class AnswerError extends Error {
  constructor(message: string, public status = 0, public detail = '') {
    super(message);
  }
}

const MAX_REQUEST_BYTES = 3_600_000;
const MAX_IMAGES_PER_REQUEST = 3;
const MESSAGES: Record<number, string> = {
  413: 'This page file is too large to process. Retake the page clearly and try again.',
  429: 'The AI service is busy. Please try again shortly.',
};

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export async function answerPhotos(
  files: File[],
  style: 'quick' | 'learn',
  signal?: AbortSignal,
  onProgress?: (progress: AnswerProgress) => void,
): Promise<Answer> {
  if (!files.length) throw new AnswerError('Choose at least one page to process.');
  const base = apiBase();
  if (base === null) throw new AnswerError('This build is missing NEXT_PUBLIC_API_URL.');

  const headers: Record<string, string> = { 'content-type': 'application/json', ...(await LicenseService.authHeaders()) };
  if (!(await LicenseService.isOwner())) {
    const key = await GeminiKey.get();
    if (!key) throw new KeyError('Add your free Gemini key to read photos.');
    headers['x-gemini-key'] = key;
  }

  const allItems: Answer['items'] = [];
  let completedPages = 0;
  let batchImages: string[] = [];
  let batchStart = 0;

  // Each batch is sent as soon as it is full. This keeps memory bounded on low-end phones,
  // even when a student selects a very large paper. There is deliberately no page-count cap.
  const submitBatch = async (images: string[], start: number, end: number): Promise<void> => {
    if (!images.length) return;
    if (signal?.aborted) throw new DOMException('Processing stopped.', 'AbortError');
    onProgress?.({
      message: `Reading pages ${start + 1}–${end} of ${files.length}`,
      detail: 'Identifying questions and preparing complete answers',
      completedPages, totalPages: files.length, progress: Math.round((completedPages / files.length) * 100),
    });

    const body = JSON.stringify({ images, style });
    let res: Response;
    try {
      res = await fetch(`${base}/api/answer`, { method: 'POST', headers, body, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AnswerError('Connection lost while processing the paper. Your selected pages are still here; try again.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'license') throw new LicenseError(data.error || 'License not valid.');
      if (data.code === 'need_key' || data.code === 'student_key') throw new KeyError(data.error || 'Check your Gemini key.');
      if (data.code === 'aborted') throw new DOMException('Processing stopped.', 'AbortError');
      throw new AnswerError(data.error || MESSAGES[res.status] || 'The photo could not be processed.', res.status, data.detail || '');
    }
    if (Number(data.partial || 0) > 0 || !Array.isArray(data.items) || data.items.some((x: any) => !x || typeof x.answer !== 'string' || !x.answer.trim())) {
      throw new AnswerError('The AI did not return a complete set of answers for this batch. Nothing has been marked as complete. Please try again.', 502);
    }

    allItems.push(...data.items);
    completedPages = end;
    onProgress?.({
      message: `Completed ${completedPages} of ${files.length} pages`,
      detail: completedPages < files.length ? 'Continuing with the remaining pages' : 'Checking the finished answer set',
      completedPages, totalPages: files.length, progress: Math.round((completedPages / files.length) * 100),
    });
  };

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new DOMException('Processing stopped.', 'AbortError');
    onProgress?.({ message: `Preparing page ${i + 1} of ${files.length}`, detail: 'Improving contrast and preparing a readable image', completedPages, totalPages: files.length, progress: Math.round((completedPages / files.length) * 100) });
    let image: string;
    try {
      image = await toDataURL(await shrink(files[i]));
    } catch (e) {
      if (e instanceof AnswerError) throw e;
      throw new AnswerError(`Could not prepare page ${i + 1}. Try saving the image as JPG or PNG and upload it again.`);
    }

    const candidate = [...batchImages, image];
    const candidateBody = JSON.stringify({ images: candidate, style });
    if (batchImages.length && (batchImages.length >= MAX_IMAGES_PER_REQUEST || bytes(candidateBody) > MAX_REQUEST_BYTES)) {
      await submitBatch(batchImages, batchStart, i);
      batchImages = [];
      batchStart = i;
    }

    const singleOrCurrent = JSON.stringify({ images: [...batchImages, image], style });
    if (bytes(singleOrCurrent) > MAX_REQUEST_BYTES) {
      throw new AnswerError(`Page ${i + 1} is too large even after image preparation. Retake it closer and in good light.`, 413);
    }
    batchImages.push(image);
  }

  await submitBatch(batchImages, batchStart, files.length);

  const text = allItems.map((item) => {
    const answer = item.answer.trimStart();
    const startsList = /^(?:\d{1,2}[.)]\s|[-*•]\s|step\s+\d+[.)]\s)/i.test(answer);
    if (item.label && (answer.startsWith('```') || startsList)) return `${item.label}.\n${item.answer}`;
    return (item.label ? `${item.label}. ` : '') + item.answer;
  }).join('\n');
  if (!text.trim() || !allItems.length) throw new AnswerError('No questions were found in the selected pages. Try clearer, closer photographs.');
  return { text, items: allItems, questionCount: allItems.length };
}
