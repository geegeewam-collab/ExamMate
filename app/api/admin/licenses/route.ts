import { adminCreate, adminDelete, adminGet, adminPatch } from '../../../../server/admin-api';
import { store } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => adminGet(req, store);
export const POST = (req: Request) => adminCreate(req, store);
export const PATCH = (req: Request) => adminPatch(req, store);
export const DELETE = (req: Request) => adminDelete(req, store);
