import { handleAdminLogin, handleAdminSessionAction } from '../../../../server/admin-auth';
import { safe } from '../../../../server/http';
import { store } from '../../../../server/store';

export const dynamic = 'force-dynamic';
export const POST = safe((req) => handleAdminLogin(req, store));
export const PATCH = safe((req) => handleAdminSessionAction(req, store));
