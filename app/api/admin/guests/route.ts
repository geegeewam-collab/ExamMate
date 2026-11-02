import { handleGuestCreate, handleGuestDelete, handleGuestList } from '../../../../server/admin-auth';
import { safe } from '../../../../server/http';
import { store } from '../../../../server/store';

export const dynamic = 'force-dynamic';
export const GET = safe((req) => handleGuestList(req, store));
export const POST = safe((req) => handleGuestCreate(req, store));
export const DELETE = safe((req) => handleGuestDelete(req, store));
