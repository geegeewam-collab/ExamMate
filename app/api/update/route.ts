import { handleUpdate } from '../../../server/update';
import { preflight } from '../../../server/http';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const GET = () => handleUpdate();
