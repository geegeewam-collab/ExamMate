import { handleAnswer } from '../../../server/answer';
import { preflight } from '../../../server/http';
import { store } from '../../../server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const OPTIONS = preflight;

export const POST = (req: Request) => handleAnswer(req, store);
