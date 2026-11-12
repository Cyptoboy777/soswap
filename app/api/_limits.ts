import { NextRequest } from 'next/server';

const windows = new Map<string, { start: number; count: number }>();

/** Best-effort per-process guard; use a shared rate limiter for multi-instance production. */
export function rateLimited(req: NextRequest, bucket: string, limit: number, windowMs = 60_000) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const client = req.headers.get('x-real-ip') ?? forwarded ?? 'unknown';
  const key = `${bucket}:${client}`;
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [entry, value] of windows) if (now - value.start >= windowMs) windows.delete(entry);
    }
    return false;
  }
  current.count += 1;
  return current.count > limit;
}
