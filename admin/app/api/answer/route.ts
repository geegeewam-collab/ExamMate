import { handleAnswer } from '../../../lib/answer';
import { preflight } from '../../../lib/http';
import { store } from '../../../lib/store';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const OPTIONS = preflight;

export const POST = (req: Request) => handleAnswer(req, store);
