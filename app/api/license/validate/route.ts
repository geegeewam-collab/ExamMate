import { handleValidate } from '../../../../server/license-api';
import { preflight } from '../../../../server/http';
import { store } from '../../../../server/store';

export const OPTIONS = preflight;
export const POST = (req: Request) => handleValidate(req, store);
