import { handleAsk } from '../../../server/ask';
import { preflight, safe } from '../../../server/http';
import { store } from '../../../server/store';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const OPTIONS = preflight;

export const POST = safe((req) => handleAsk(req, store));
