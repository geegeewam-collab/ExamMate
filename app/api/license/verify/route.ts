import { handleVerify } from '../../../../server/license-api';
import { preflight, safe } from '../../../../server/http';
import { store } from '../../../../server/store';

export const OPTIONS = preflight;
export const POST = safe((req) => handleVerify(req, store));
