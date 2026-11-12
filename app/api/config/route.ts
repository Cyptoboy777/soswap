import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Public, non-secret feature flags. Live order sending is off unless the server flag is explicitly 'true'. */
export function GET() {
  return NextResponse.json({ tradingEnabled: process.env.SODEX_MAINNET_TRADING === 'true' }, { headers: { 'cache-control': 'no-store' } });
}
