'use client';

import { useEffect, useState } from 'react';

export function BrandLogo({ small = false }: { small?: boolean }) {
  return <span className={`ss-brandmark ${small ? 'small' : ''}`} aria-label="SoSwap logo">
    <svg viewBox="0 0 44 44" role="img" aria-hidden="true"><rect x="1" y="1" width="42" height="42" rx="15" fill="#111811"/><path d="M13 17c0-2 1.6-3.5 3.6-3.5h11.8M31 27c0 2-1.6 3.5-3.6 3.5H15.6m-.8-13 4-4 4 4m6 10-4 4-4-4M15 22h14" fill="none" stroke="#c6f36a" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="15" cy="22" r="2.2" fill="#ff704a"/><circle cx="29" cy="22" r="2.2" fill="#ff704a"/></svg>
  </span>;
}

export function TokenAvatar({ symbol, src, size = 'normal' }: { symbol: string; src?: string; size?: 'normal' | 'small' }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);
  const name = symbol.replace(/^v/i, '').replace(/^w(?=BTC|ETH|USDC|USDT)/i, '').replace(/^s(?=SOSO|MAG7|DEFI)/i, '').replace(/\.ssi$/i, '').toUpperCase();
  const mark = name === 'BTC' ? '₿' : name === 'ETH' ? '◆' : name === 'SOL' ? '≋' : name === 'USDC' ? '$' : name === 'USDT' ? '₮' : name === 'BNB' ? '⬡' : name === 'XRP' ? '✕' : name === 'ADA' ? '₳' : name === 'DOGE' ? 'Ð' : name === 'SOSO' ? 'S' : name.slice(0, 2);
  return <span className={`ss-token-avatar ${size}`} title={symbol} role="img" aria-label={`${symbol} token logo`} data-token={name}>
    {src && !imageFailed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : <b className="ss-token-mark">{mark}</b>}
  </span>;
}
