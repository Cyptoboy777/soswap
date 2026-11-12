'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, Copy, ExternalLink, LoaderCircle, Search, Settings2, ShieldCheck, Sparkles, Wallet, X } from 'lucide-react';
import { BrandLogo, TokenAvatar } from './BrandLogo';
import ThemeToggle from './ThemeToggle';

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<any>; on?: (event: string, handler: (...args: any[]) => void) => void; removeListener?: (event: string, handler: (...args: any[]) => void) => void } } }

type RouteInfo = { chainName: string; isNativeToken: boolean; tokenAddress?: string; bridge?: { allowDeposit: boolean; allowWithdraw: boolean; minDepositAmount?: string; minWithdrawAmount?: string; withdrawFee?: string; estimatedDepositSeconds?: number; estimatedWithdrawSeconds?: number; bridgeAddress?: string }; custody?: { allowDeposit: boolean; allowWithdraw: boolean; minDepositAmount?: string; minWithdrawAmount?: string; withdrawFee?: string; estimatedDepositSeconds?: number; estimatedWithdrawSeconds?: number } };
type Asset = { assetName: string; logoUrl?: string; iconUrl?: string; imageUrl?: string; valueChainMetadata?: { tokenSymbol?: string; tokenDecimals?: number; evmAddress?: string; isNativeToken?: boolean; logoUrl?: string; iconUrl?: string }; sodexMetadata?: { id: number; name: string; tokenPrice?: string | null; logoUrl?: string; iconUrl?: string; imageUrl?: string } | null; chains: RouteInfo[] };
type Pair = { name: string; baseCoin: string; quoteCoin: string };
type Ticker = { symbol: string; lastPx?: string; lastPrice?: string };
type DepositAddress = { chain: string; address: string; status: string };

const API = '/api/sodex';
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const prettyChain = (value: string) => value.replace(/_ETH$/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

async function sodex(path: string, init?: RequestInit) {
  const response = await fetch(`${API}/${path}`, { ...init, cache: 'no-store', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json?.code !== undefined && Number(json.code) !== 0)) throw new Error(json?.error || json?.msg || json?.message || `SoDEX request failed (${response.status}).`);
  return json;
}

function Logo({ small = false }: { small?: boolean }) { return <BrandLogo small={small}/>; }

function findSpotRate(from: string, to: string, pairs: Pair[], tickerMap: Map<string, number>) {
  if (from === to) return { rate: 1, path: [] as string[] };
  const edges: { a: string; b: string; rate: number; pair: string }[] = [];
  for (const pair of pairs) {
    const price = tickerMap.get(pair.name);
    if (!price || price <= 0) continue;
    edges.push({ a: pair.baseCoin, b: pair.quoteCoin, rate: price, pair: pair.name });
    edges.push({ a: pair.quoteCoin, b: pair.baseCoin, rate: 1 / price, pair: pair.name });
  }
  const queue = [{ token: from, rate: 1, path: [] as string[], seen: new Set([from]) }];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length > 4) continue;
    for (const edge of edges.filter((item) => item.a === current.token)) {
      if (current.seen.has(edge.b)) continue;
      const rate = current.rate * edge.rate;
      const path = [...current.path, edge.pair];
      if (edge.b === to) return { rate, path };
      queue.push({ token: edge.b, rate, path, seen: new Set([...current.seen, edge.b]) });
    }
  }
  return null;
}

export default function SodexSwap({ onView }: { onView: (view: 'markets' | 'portfolio' | 'bots') => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [sourceName, setSourceName] = useState('ETH');
  const [destName, setDestName] = useState('USDC');
  const [sourceChain, setSourceChain] = useState('BASE_ETH');
  const [destChain, setDestChain] = useState('ETH');
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deposit, setDeposit] = useState<DepositAddress | null>(null);
  const [depositHint, setDepositHint] = useState('');
  const [verified, setVerified] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [depositStatus, setDepositStatus] = useState('');
  const [botOpen, setBotOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([sodex('asset/config'), sodex('spot/markets/symbols'), sodex('spot/markets/tickers')]).then(([assetJson, pairJson, tickerJson]) => {
      if (!live) return;
      const assetRows = Array.isArray(assetJson?.data) ? assetJson.data.filter((asset: Asset) => asset.assetName && Array.isArray(asset.chains)) : [];
      const assetsByName = new Map<string, Asset>();
      for (const asset of assetRows) {
        const current = assetsByName.get(asset.assetName);
        if (!current) assetsByName.set(asset.assetName, asset);
        else current.chains = [...new Map([...current.chains, ...asset.chains].map((route) => [route.chainName, route])).values()];
      }
      const foundAssets = [...assetsByName.values()];
      setAssets(foundAssets);
      setPairs(Array.isArray(pairJson?.data) ? pairJson.data : pairJson?.data?.list ?? []);
      setTickers(Array.isArray(tickerJson?.data) ? tickerJson.data : tickerJson?.data?.list ?? []);
      if (foundAssets.some((asset: Asset) => asset.assetName === 'ETH')) setSourceName('ETH');
      if (foundAssets.some((asset: Asset) => asset.assetName === 'USDC')) setDestName('USDC');
    }).catch((e) => live && setError(e instanceof Error ? e.message : 'SoDEX Mirror data is unavailable.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const sourceAsset = assets.find((asset) => asset.assetName === sourceName);
  const destAsset = assets.find((asset) => asset.assetName === destName);
  const tokenLogo = (asset?: Asset) => asset?.logoUrl ?? asset?.iconUrl ?? asset?.imageUrl ?? asset?.valueChainMetadata?.logoUrl ?? asset?.valueChainMetadata?.iconUrl ?? asset?.sodexMetadata?.logoUrl ?? asset?.sodexMetadata?.iconUrl ?? asset?.sodexMetadata?.imageUrl;
  const depositRoutes = sourceAsset?.chains.filter((route) => route.custody?.allowDeposit) ?? [];
  const withdrawalRoutes = destAsset?.chains.filter((route) => route.custody?.allowWithdraw || route.bridge?.allowWithdraw) ?? [];
  const sourceRoute = depositRoutes.find((route) => route.chainName === sourceChain) ?? depositRoutes[0];
  const destRoute = withdrawalRoutes.find((route) => route.chainName === destChain) ?? withdrawalRoutes[0];
  const tickerMap = useMemo(() => new Map(tickers.map((ticker) => [ticker.symbol, Number(ticker.lastPx ?? ticker.lastPrice)])), [tickers]);
  const conversion = sourceAsset?.sodexMetadata?.name && destAsset?.sodexMetadata?.name ? findSpotRate(sourceAsset.sodexMetadata.name, destAsset.sodexMetadata.name, pairs, tickerMap) : null;
  const validAmount = /^\d+(\.\d+)?$/.test(amount) && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const amountValue = validAmount ? Number(amount) : 0;
  const grossOut = amountValue * (conversion?.rate ?? 0);
  const withdrawFeeRaw = destRoute?.custody?.allowWithdraw ? destRoute.custody.withdrawFee : destRoute?.bridge?.withdrawFee;
  const parsedWithdrawFee = withdrawFeeRaw === undefined || withdrawFeeRaw === '' ? null : Number(withdrawFeeRaw);
  const withdrawFee = parsedWithdrawFee !== null && Number.isFinite(parsedWithdrawFee) && parsedWithdrawFee >= 0 ? parsedWithdrawFee : null;
  const estimatedOut = conversion && Number.isFinite(grossOut) && withdrawFee !== null ? Math.max(0, grossOut - withdrawFee) : null;
  const sourceMinimum = sourceRoute?.custody?.allowDeposit ? sourceRoute.custody.minDepositAmount : sourceRoute?.bridge?.minDepositAmount;
  const destMinimum = destRoute?.custody?.allowWithdraw ? destRoute.custody.minWithdrawAmount : destRoute?.bridge?.minWithdrawAmount;
  const meetsDepositMinimum = !sourceMinimum || Number(amount) >= Number(sourceMinimum);
  const filteredAssets = assets.filter((asset) => `${asset.assetName} ${asset.valueChainMetadata?.tokenSymbol ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  const connect = async () => {
    setError('');
    if (!window.ethereum) { setError('Connect an EVM wallet to continue. SoSwap never asks for your seed phrase or private key.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new Error('Wallet did not return an address.');
      setWallet(accounts[0]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Wallet connection failed.'); }
  };

  const requestDepositAddress = async () => {
    if (!wallet || !sourceRoute) return;
    setBusy(true); setError(''); setDeposit(null); setDepositHint('Checking for an existing SoDEX deposit address…'); setVerified(false);
    try {
      const userPath = `user/${encodeURIComponent(wallet)}/deposit-address?chain=${encodeURIComponent(sourceRoute.chainName)}`;
      let result = await sodex(userPath);
      let data = result?.data?.address ? result.data : result?.data?.accountAddresses?.find((item: DepositAddress) => item.chain === sourceRoute.chainName);
      if (!data?.address || !/^enabled$/i.test(data.status ?? '')) {
        setDepositHint('Requesting address from SoDEX Mirror…');
        await sodex(`user/${encodeURIComponent(wallet)}/deposit-address`, { method: 'POST', body: JSON.stringify({ chain: sourceRoute.chainName }) });
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          result = await sodex(userPath);
          data = result?.data?.address ? result.data : result?.data?.accountAddresses?.find((item: DepositAddress) => item.chain === sourceRoute.chainName);
          setDepositHint(`SoDEX address status: ${data?.status || 'Processing'}…`);
          if (/enabled|suspicious/i.test(data?.status ?? '')) break;
        }
      }
      if (!data?.address || !/^enabled$/i.test(data.status ?? '')) throw new Error(`SoDEX has not enabled the ${prettyChain(sourceRoute.chainName)} address yet. Wait and check again; do not send funds to a pending address.`);
      setDeposit({ chain: sourceRoute.chainName, address: data.address, status: data.status });
      setDepositHint('Address is enabled by SoDEX. Verify the exact address on SoDEX before sending funds.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not get a SoDEX deposit address.'); setDepositHint(''); }
    finally { setBusy(false); }
  };

  const checkDeposit = async () => {
    if (!sourceRoute || !txHash.trim()) return;
    setBusy(true); setError('');
    try {
      const data = await sodex(`user/deposit/status?chain=${encodeURIComponent(sourceRoute.chainName)}&txHash=${encodeURIComponent(txHash.trim())}`);
      const rows = data?.data?.records ?? [];
      if (!rows.length) { setDepositStatus('No matching deposit indexed yet. Keep this hash and check again; do not resend.'); return; }
      const statuses = [...new Set(rows.map((row: any) => String(row.status ?? 'Unknown')))].join(', ');
      setDepositStatus(`SoDEX status: ${statuses}. Confirm the Spot balance before placing a trade.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Deposit status could not be loaded.'); }
    finally { setBusy(false); }
  };

  const flip = () => {
    const nextSource = destAsset;
    const nextDest = sourceAsset;
    if (nextSource && nextDest) {
      setSourceName(nextSource.assetName); setDestName(nextDest.assetName);
      const from = nextSource.chains.find((route) => route.custody?.allowDeposit || route.bridge?.allowDeposit);
      const to = nextDest.chains.find((route) => route.custody?.allowWithdraw || route.bridge?.allowWithdraw);
      if (from) setSourceChain(from.chainName);
      if (to) setDestChain(to.chainName);
      setDeposit(null); setTxHash(''); setDepositStatus('');
    }
  };

  return <main className="soswap-app">
    <header className="ss-topbar"><a className="ss-brand" href="#swap"><Logo/><span>SoSwap</span></a><nav className="ss-nav"><button className="active">Swap</button><button onClick={() => onView('markets')}>Markets</button><button onClick={() => onView('portfolio')}>Portfolio</button><button onClick={() => onView('bots')}>Bots</button></nav><div className="ss-search"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tokens" aria-label="Search tokens"/></div><ThemeToggle/><button className={`ss-wallet ${wallet ? 'connected' : ''}`} onClick={wallet ? () => setWallet('') : connect}><Wallet size={17}/>{wallet ? short(wallet) : 'Connect wallet'}<ChevronDown size={14}/></button></header>
    <div className="ss-wash"/>
    <section className="ss-workspace" id="swap"><div className="ss-title"><div className="ss-eyebrow"><span className="ss-live-dot"/> SODEX MIRROR <span className="ss-title-divider"/> {loading ? 'SYNCING LIVE ROUTES' : `${assets.length} ASSETS · LIVE`}</div><h1>Move value across chains<span>.</span></h1><p>Find a supported SoDEX route, preview the spot path, and follow each transfer stage.</p></div>
      <div className="ss-swap-layout">
      <section className="ss-swap-card" aria-label="SoDEX cross-chain swap"><div className="ss-card-top"><div><span className="ss-card-label">CROSS-CHAIN SWAP</span><span className="ss-route-badge"><span className="ss-live-dot"/>{loading ? 'Loading SoDEX routes' : `${assets.length} assets · SoDEX API`}</span></div><button className="ss-icon-button" onClick={() => setShowDetails(!showDetails)} aria-label="Route details"><Settings2 size={19}/></button></div>
        <div className="ss-token-panel"><div className="ss-panel-head"><span>You send</span><span className="ss-wallet-label">{wallet ? short(wallet) : 'Connect wallet to continue'}</span></div><div className="ss-panel-main"><input className="ss-amount" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => { const next = e.target.value.replace(/[^0-9.]/g, ''); if (/^\d*\.?\d*$/.test(next)) setAmount(next); }} aria-label="Amount to send"/><div className="ss-token-choice"><TokenAvatar symbol={sourceName} src={tokenLogo(sourceAsset)} size="small"/><select className="ss-token-select" value={sourceName} onChange={(e) => { setSourceName(e.target.value); setDeposit(null); setVerified(false); }} aria-label="Source asset">{filteredAssets.map((asset) => <option key={asset.assetName} value={asset.assetName}>{asset.assetName}</option>)}</select></div></div><div className="ss-panel-foot"><span>From</span><select className="ss-chain-select" value={sourceRoute?.chainName ?? ''} onChange={(e) => { setSourceChain(e.target.value); setDeposit(null); setVerified(false); }} aria-label="Source network">{depositRoutes.map((route) => <option key={route.chainName} value={route.chainName}>{prettyChain(route.chainName)}</option>)}</select><span className="ss-max">SODEX SPOT</span></div></div>
        <button className="ss-reverse" onClick={flip} aria-label="Reverse swap"><ArrowDown size={18}/></button>
        <div className="ss-token-panel ss-output-panel"><div className="ss-panel-head"><span>You receive (estimate)</span><span>{conversion ? 'Indicative SoDEX spot path' : 'No live market path'}</span></div><div className="ss-panel-main"><div className="ss-output-amount">{conversion && validAmount && estimatedOut !== null ? estimatedOut.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'}</div><div className="ss-token-choice"><TokenAvatar symbol={destName} src={tokenLogo(destAsset)} size="small"/><select className="ss-token-select" value={destName} onChange={(e) => setDestName(e.target.value)} aria-label="Destination asset">{filteredAssets.map((asset) => <option key={asset.assetName} value={asset.assetName}>{asset.assetName}</option>)}</select></div></div><div className="ss-panel-foot"><span>To</span><select className="ss-chain-select" value={destRoute?.chainName ?? ''} onChange={(e) => setDestChain(e.target.value)} aria-label="Destination network">{withdrawalRoutes.map((route) => <option key={route.chainName} value={route.chainName}>{prettyChain(route.chainName)}</option>)}</select><span className="ss-destination-note">same wallet</span></div></div>
        {showDetails && <div className="ss-quote-meta ss-route-details"><span><ShieldCheck size={14}/> Deposit minimum <b>{sourceMinimum ?? '—'} {sourceName}</b></span><span><Clock3 size={14}/> Withdrawal fee <b>{withdrawFee === null ? 'Not listed' : `${withdrawFeeRaw} ${destName}`}</b></span><span>Spot path <b>{conversion?.path.length ? conversion.path.join(' → ') : conversion && sourceName === destName ? 'No trade needed' : 'No supported live pair'}</b></span><span>Receive minimum <b>{destMinimum ?? '—'} {destName}</b></span><span>SoSwap fee target <b>0.02%–0.15% · not collected</b></span><span>Estimate <b>Last prices only; excludes trading fees, spread, slippage, and source-chain gas.</b></span></div>}
        {error && <div className="ss-error"><CircleHelp size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={14}/></button></div>}
        {!conversion && sourceAsset && destAsset && <div className="ss-error"><CircleHelp size={15}/><span>No live SoDEX spot route between these assets. Change the pair; no synthetic quote is shown.</span></div>}
        <button className="ss-primary" disabled={loading || !sourceRoute || !destRoute || !validAmount || !meetsDepositMinimum || !conversion || !wallet || busy} onClick={() => void requestDepositAddress()}>{busy ? <><LoaderCircle size={16} className="ss-spin"/> Checking SoDEX Mirror…</> : !wallet ? 'Connect wallet to start' : !sourceRoute?.custody?.allowDeposit ? 'Choose a custody deposit route' : !validAmount ? 'Enter a valid amount' : !meetsDepositMinimum ? `Minimum deposit: ${sourceMinimum} ${sourceName}` : <>Prepare SoDEX deposit <ArrowRight size={16}/></>}</button>
        {depositHint && <p className="ss-deposit-hint">{depositHint}</p>}
        {deposit && <div className="ss-deposit-box"><div className="ss-deposit-heading"><Check size={16}/>Deposit address · {prettyChain(deposit.chain)}</div><code>{deposit.address}</code><button className="ss-copy" disabled={!verified} onClick={() => void navigator.clipboard?.writeText(deposit.address)}><Copy size={14}/>{verified ? 'Copy address' : 'Verify first'}</button><label className="ss-verify-check"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)}/><span>I checked this exact address and network in SoDEX before transferring.</span></label><small>Never send until the address is Enabled and verified in SoDEX’s deposit wallet list. Custody deposits credit your SoDEX Spot account; the address endpoint does not move funds.</small></div>}
        {deposit && <div className="ss-track-box"><label>After you send, paste the source transaction hash to track it<input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x… transaction hash"/></label><button onClick={() => void checkDeposit()} disabled={!txHash || busy}>Check SoDEX deposit status</button>{depositStatus && <small>{depositStatus}</small>}</div>}
        <div className="ss-trust"><ShieldCheck size={15}/><span>Your wallet keys remain yours. This is a staged workflow: trade in SoDEX Spot and submit the destination withdrawal in SoDEX; SoSwap does not execute those two steps yet.</span></div>
      </section>
      <aside className="ss-route-console" aria-label="Route preview">
        <div className="ss-console-head"><div><span className="ss-console-kicker">ROUTE INTELLIGENCE</span><h2>One clear path.</h2></div><span className="ss-console-live"><i/>Live</span></div>
        <p className="ss-console-copy">A transparent handoff from your network through SoDEX markets to the destination chain.</p>
        <div className="ss-route-map">
          <div className="ss-route-node"><TokenAvatar symbol={sourceName} src={tokenLogo(sourceAsset)} size="small"/><span><small>FROM · {sourceName}</small><b>{sourceRoute ? prettyChain(sourceRoute.chainName) : 'Choose network'}</b></span></div>
          <div className="ss-route-link"><i/><i/><i/></div>
          <div className="ss-route-node ss-route-sodex"><BrandLogo small/><span><small>TRADE · SODEX</small><b>{conversion?.path.length ? conversion.path.length + ' spot hop' + (conversion.path.length > 1 ? 's' : '') : 'Spot market'}</b></span></div>
          <div className="ss-route-link"><i/><i/><i/></div>
          <div className="ss-route-node"><TokenAvatar symbol={destName} src={tokenLogo(destAsset)} size="small"/><span><small>TO · {destName}</small><b>{destRoute ? prettyChain(destRoute.chainName) : 'Choose network'}</b></span></div>
        </div>
        <div className="ss-console-quote"><div><small>INDICATIVE RECEIVE</small><b>{estimatedOut !== null && validAmount ? estimatedOut.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'} <em>{destName}</em></b></div><span>{conversion?.path.length ? conversion.path.join(' → ') : conversion && sourceName === destName ? 'Same asset' : 'No supported spot path'}</span></div>
        <div className="ss-console-metrics"><div><small>Deposit minimum</small><b>{sourceMinimum ?? '—'} {sourceName}</b></div><div><small>Withdraw fee</small><b>{withdrawFee === null ? 'Not listed' : `${withdrawFee} ${destName}`}</b></div><div><small>Receive minimum</small><b>{destMinimum ?? '—'} {destName}</b></div></div>
        <div className="ss-console-steps"><span className="ss-console-step active"><i>01</i><b>Deposit</b><small>External wallet</small></span><span className="ss-console-step"><i>02</i><b>Trade</b><small>SoDEX Spot</small></span><span className="ss-console-step"><i>03</i><b>Withdraw</b><small>Destination</small></span></div>
        <div className="ss-console-note"><ShieldCheck size={15}/><span>Last-price estimate only. Trading and withdrawal still require confirmation in SoDEX.</span></div>
      </aside>
      </div>
      <div className="ss-below"><div className="ss-support"><span className="ss-support-mark"><Wallet size={16}/></span><span><b>Powered by SoDEX Mirror</b><small>Networks, asset routes, minimums and fees are loaded from SoDEX.</small></span></div><a href="https://docs.sodex.com/for-developers/developers/mirror-protocol/quickstart" target="_blank" rel="noreferrer">Mirror guide <ExternalLink size={13}/></a></div><footer className="ss-footer">Cross-chain trades settle in stages. A submitted deposit is not completed until SoDEX confirms Spot credit and the destination withdrawal arrives.</footer>
    </section>
    <button className="ss-bot-launch" onClick={() => setBotOpen(!botOpen)} aria-label="Open Soso guide"><span className="ss-bot-spark"><Sparkles size={17}/></span><span className="ss-bot-pulse"/></button>
    {botOpen && <aside className="ss-bot-window"><div className="ss-bot-head"><Logo small/><div><b>Soso guide</b><small>SoDEX transfer helper</small></div><button onClick={() => setBotOpen(false)} aria-label="Close guide"><X size={16}/></button></div><div className="ss-bot-body"><div className="ss-bot-message">I’ll only show networks and assets SoDEX currently lists. Deposit to Spot, complete the live SoDEX trade, then withdraw to your chosen network.</div><button onClick={() => { setBotOpen(false); if (!wallet) void connect(); }}><ArrowUpRight size={14}/>{wallet ? 'Wallet connected' : 'Connect wallet'}</button></div></aside>}
  </main>;
}
