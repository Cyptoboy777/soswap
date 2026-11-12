import { NextRequest, NextResponse } from 'next/server';
import { rateLimited } from '../../_limits';

const ORIGIN = 'https://mainnet-gw.sodex.dev/api/v1';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SYMBOL = /^[a-zA-Z0-9_-]{1,40}$/;

function allowed(method: string, path: string[]) {
  if (method === 'GET') {
    if (path.length === 2 && path[0] === 'asset' && path[1] === 'config') return true;
    if (path.length === 3 && path[0] === 'spot' && path[1] === 'markets' && ['symbols', 'tickers'].includes(path[2])) return true;
    if (path.length === 4 && path[0] === 'spot' && path[1] === 'markets' && SYMBOL.test(path[2]) && path[3] === 'orderbook') return true;
    if (path.length === 3 && path[0] === 'accounts' && ADDRESS.test(path[1]) && ['state', 'balances'].includes(path[2])) return true;
    if (path.length === 3 && path[0] === 'user' && ADDRESS.test(path[1]) && path[2] === 'deposit-address') return true;
    if (path.length === 3 && path[0] === 'user' && path[1] === 'deposit' && path[2] === 'status') return true;
  }
  if (method === 'POST') {
    if (path.length === 3 && path[0] === 'user' && ADDRESS.test(path[1]) && path[2] === 'deposit-address') return true;
    if (path.length === 3 && path[0] === 'spot' && path[1] === 'trade' && path[2] === 'orders') return true;
  }
  return false;
}

async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowed(req.method, path) || req.nextUrl.search.length > 2048) return NextResponse.json({ error: 'This SoDEX route is not available.' }, { status: 404 });
  if (req.method === 'POST' && path[0] === 'spot' && path[1] === 'trade' && process.env.SODEX_MAINNET_TRADING !== 'true') return NextResponse.json({ error: 'Live order sending is turned off in this build.' }, { status: 403 });
  if (req.method === 'POST' && path[0] === 'user' && rateLimited(req, 'deposit-address', 2)) return NextResponse.json({ error: 'Please wait before requesting another deposit address.' }, { status: 429 });
  if (rateLimited(req, 'sodex', 120)) return NextResponse.json({ error: 'Too many requests. Please wait and retry.' }, { status: 429 });
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 16_384) return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  const target = `${ORIGIN}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers({ accept: 'application/json' });
  for (const key of ['content-type', 'x-api-key', 'x-api-sign', 'x-api-nonce', 'x-api-chain']) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
    if (body && new TextEncoder().encode(body).byteLength > 16_384) return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    const upstreamBody = await upstream.text();
    return new NextResponse(upstreamBody, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'SoDEX mainnet is unreachable right now.' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
