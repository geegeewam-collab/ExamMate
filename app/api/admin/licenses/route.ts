import { adminCreate, adminDelete, adminGet, adminPatch } from '../../../../server/admin-api';
import { safe } from '../../../../server/http';
import { store } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export const GET = safe((req) => adminGet(req, store));
export const POST = safe((req) => adminCreate(req, store));
export const PATCH = safe((req) => adminPatch(req, store));
export const DELETE = safe((req) => adminDelete(req, store));
