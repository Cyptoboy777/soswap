import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { rateLimited } from '../_limits';

export const dynamic = 'force-dynamic';
const BASE = 'https://openapi.sosovalue.com/openapi/v1';

export async function GET(req: NextRequest) {
  if (rateLimited(req, 'sosovalue', 60)) return NextResponse.json({ error: 'Too many requests. Please wait and retry.' }, { status: 429 });
  const key = process.env.SOSOVALUE_API_KEY;
  if (!key) return NextResponse.json({ configured: false, message: 'SoSoValue data is not connected in this build yet.' });
  const paths = ['news/hot', 'etfs/summary-history?symbol=BTC&country_code=US&limit=14', 'currencies/sector-spotlight'];
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const response = await fetch(`${BASE}/${path}`, { headers: { accept: 'application/json', 'x-soso-api-key': key }, next: { revalidate: 60 }, signal: AbortSignal.timeout(12_000) });
      const json = await response.json().catch(() => null);
      return { ok: response.ok, data: json, path };
    } catch { return { ok: false, data: null, path }; }
  }));
  return NextResponse.json({ configured: true, news: results[0], etfFlows: results[1], sectors: results[2], updatedAt: new Date().toISOString() }, { headers: { 'cache-control': 's-maxage=60, stale-while-revalidate=120' } });
}
