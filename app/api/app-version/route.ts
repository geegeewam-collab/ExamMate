import { handleAppVersion } from '../../../server/app-version';
import { preflight, safe } from '../../../server/http';

export const dynamic = 'force-dynamic';

export const GET = safe(() => handleAppVersion());
export const OPTIONS = preflight;
