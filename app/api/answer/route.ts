import { handleAnswer } from '../../../server/answer';
import { preflight, safe } from '../../../server/http';
import { store } from '../../../server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const OPTIONS = preflight;

export const POST = safe((req) => handleAnswer(req, store));
