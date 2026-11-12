# SoSwap

SoSwap is a Next.js spot trading interface for SoDEX Mainnet. It discovers supported markets from SoDEX at runtime, shows live ticker/order book data, connects an injected EVM wallet, reads the connected spot account, and submits wallet-signed orders to SoDEX.

The product direction uses a dashboard-style market/portfolio view and a separate bot workspace, inspired by the two references. It does not copy their branding or claim to reproduce their services.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Build and serve with `npm run build` and `npm start`.

## Live integrations

- `/api/sodex/*` allows only the SoDEX asset, market, account, deposit-address, deposit-status, and signed spot-order routes used by the app.
- Available assets/pairs come from SoDEX market symbols. Prices, order book levels, and balances are not seeded locally.
- Wallet connection switches to ValueChain Mainnet (chain ID `286623`, RPC `https://mainnet.valuechain.xyz`).
- Limit and market orders use SoDEX's `spot` EIP-712 signing domain. The confirmation dialog previews the order before the wallet signature.
- Limit order price and size are checked against each market's tick and step sizes; order balance checks use live available SoDEX funds.

If SoDEX data is unavailable or the wallet has no SoDEX spot account, the app shows an error/empty state rather than sample data.

## Market intelligence

Markets combines live SoDEX pair/ticker data with SoSoValue news, ETF flow history, and sector data. Set `SOSOVALUE_API_KEY` as a server-side environment variable to enable these feeds. Google AI summaries use `GOOGLE_AI_API_KEY` on the server and summarize only the returned headlines. Copy `.env.example` as a reference; never put secrets in `NEXT_PUBLIC_*` variables or commit actual keys.

In Vercel, add the variables under **Project → Settings → Environment Variables**, then redeploy. Without keys, the UI explains which provider is not configured.

## Cross-chain workflow status

The swap page discovers SoDEX Mirror routes, estimates using last traded prices, prepares/checks custody deposit addresses, and tracks deposits. The estimate is indicative and omits trading fees, spread, slippage, and source-chain gas. Trading and destination withdrawal are not submitted by this app yet; complete those steps in SoDEX. Do not present this staged flow as an atomic or fully automated cross-chain swap.

The API routes have payload bounds, timeouts, allowlists, and a best-effort per-process rate guard. That guard is not shared across Vercel instances; use a shared rate limiter and provider quotas before public production launch.

## Bot workspace

The Bots tab is separate and intentionally does not start a pretend client-side bot. Always-on strategies need a persistent server-side worker, restricted SoDEX trading credentials, durable order/fill state, and cancellation watchdog. The page provides strategy selection, market/order size, grid price range, loss-limit fields, and a draft-only state. Do not mark a strategy Live until a worker, trade-only SoDEX key, persistence, and stop/cancel monitoring are deployed and verified.

## Mainnet actions

Live order sending is **off by default**. The server only forwards signed spot orders when `SODEX_MAINNET_TRADING=true` is set on the server; otherwise the confirm dialog is review-only and `/api/sodex/spot/trade/orders` returns 403. When enabled, order submission is a live mainnet action. Your wallet displays the signing request, which you should review and approve. SoSwap never asks for a seed phrase or private key. Execution and balances depend on SoDEX Mainnet.
