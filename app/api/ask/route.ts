import { handleAsk } from '../../../server/ask';
import { preflight, safe } from '../../../server/http';
import { store } from '../../../server/store';

export const runtime = 'nodejs';
// Keep this above ASK_TOTAL_MS to leave time for auth, Redis and response serialization.
export const maxDuration = 30;
export const OPTIONS = preflight;

export const POST = safe((req) => handleAsk(req, store));
