import { handleVerify } from '../../../../lib/license-api';
import { preflight } from '../../../../lib/http';
import { store } from '../../../../lib/store';

export const OPTIONS = preflight;
export const POST = (req: Request) => handleVerify(req, store);
