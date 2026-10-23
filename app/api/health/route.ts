import { health } from '../../../server/health';
import { store } from '../../../server/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const body = await health(store);
  return new Response(JSON.stringify(body, null, 2), {
    status: body.ok ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
