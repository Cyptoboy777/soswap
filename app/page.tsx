'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUpRight, Check, ChevronDown, CircleHelp, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, Wallet, X } from 'lucide-react';
import { keccak256, toHex } from 'viem';
import SodexSwap from './components/SodexSwap';
import MarketInsights from './components/MarketInsights';
import BotStudio from './components/BotStudio';
import { BrandLogo, TokenAvatar } from './components/BrandLogo';
import ThemeToggle from './components/ThemeToggle';

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<any>; on?: (event: string, handler: (...args: any[]) => void) => void; removeListener?: (event: string, handler: (...args: any[]) => void) => void } } }

const CHAIN_ID = 286623;
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const API = '/api/sodex/spot';
type Pair = { id: number; name: string; displayName?: string; baseCoin: string; quoteCoin: string; baseCoinPrecision?: number; quoteCoinPrecision?: number; tickSize: string; stepSize: string; minQuantity: string; status?: string };
type Ticker = { symbol: string; lastPx?: string; lastPrice?: string; changePct?: number; volume?: string; quoteVolume?: string; bidPx?: string; askPx?: string };
type Level = [string, string];
type Book = { bids: Level[]; asks: Level[] };
type Balance = { id?: number; coin: string; total: string; locked: string };
type Tab = 'swap' | 'markets' | 'portfolio' | 'bots';
type Side = 'buy' | 'sell';

const getRows = <T,>(json: any): T[] => Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.list) ? json.data.list : [];
const cleanDecimal = (value: string) => {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a valid positive decimal amount.');
  const cleaned = value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (!cleaned || Number(cleaned) <= 0) throw new Error('Enter an amount greater than zero.');
  return cleaned;
};
const fmt = (value: string | number | undefined, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
};
const formatSoso = (raw: string) => {
  const wei = BigInt(raw);
  const scale = BigInt('1000000000000000000');
  const whole = wei / scale;
  const fraction = (wei % scale).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};
const errText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
let lastNonce = 0;
const nextNonce = () => { lastNonce = Math.max(Date.now(), lastNonce + 1); return lastNonce; };
const onStep = (value: string, step: string) => {
  const precision = Math.min(18, (step.split('.')[1] ?? '').length);
  const scale = 10 ** precision;
  return Math.round(Number(value) * scale) % Math.max(1, Math.round(Number(step) * scale)) === 0;
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}/${path}`, { ...init, cache: 'no-store', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json?.code && Number(json.code) !== 0)) throw new Error(json?.msg || json?.message || json?.error || `SoDEX request failed (${response.status}).`);
  return json;
}

function AppMark() { return <BrandLogo />; }

export default function SoSwapPage() {
  const [tab, setTab] = useState<Tab>('swap');
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [selected, setSelected] = useState<Pair | null>(null);
  const [book, setBook] = useState<Book>({ bids: [], asks: [] });
  const [wallet, setWallet] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [sosoBalance, setSosoBalance] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [orderResult, setOrderResult] = useState<any>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  useEffect(() => { fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()).then((j) => setTradingEnabled(j?.tradingEnabled === true)).catch(() => setTradingEnabled(false)); }, []);
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');

  const tickerMap = useMemo(() => new Map(tickers.map((t) => [t.symbol, t])), [tickers]);
  const ticker = selected ? tickerMap.get(selected.name) ?? tickerMap.get(selected.displayName ?? '') : undefined;
  const lastPrice = Number(ticker?.lastPx ?? ticker?.lastPrice ?? 0);
  const asks = book.asks.slice(0, 8).reverse();
  const bids = book.bids.slice(0, 8);
  const tradeValue = orderType === 'market' && side === 'buy' ? Number(quantity || 0) : Number(orderType === 'market' ? (side === 'buy' ? book.asks[0]?.[0] : book.bids[0]?.[0]) : price || lastPrice) * Number(quantity || 0);

  const loadMarkets = useCallback(async () => {
    setLoadingMarket(true);
    try {
      const [symbolJson, tickerJson] = await Promise.all([request('markets/symbols'), request('markets/tickers')]);
      const livePairs = getRows<Pair>(symbolJson).filter((p) => p?.id && p?.name && p?.baseCoin && p?.quoteCoin && (!p.status || /^(trading|online|enabled|1)$/i.test(String(p.status).trim())));
      const liveTickers = getRows<Ticker>(tickerJson);
      setPairs(livePairs);
      setTickers(liveTickers);
      setSelected((prev) => livePairs.find((p) => p.id === prev?.id) ?? livePairs.find((p) => /BTC.*USDC/i.test(p.name)) ?? livePairs[0] ?? null);
      setNotice(livePairs.length ? null : { kind: 'error', text: 'SoDEX returned no active spot markets.' });
    } catch (e) {
      setNotice({ kind: 'error', text: `Live SoDEX markets unavailable: ${errText(e)}` });
    } finally { setLoadingMarket(false); }
  }, []);

  const loadAccount = useCallback(async (address: string) => {
    setLoadingAccount(true);
    try {
      const state = await request(`accounts/${address}/state`);
      const data = state?.data ?? state;
      const aid = Number(data?.aid ?? data?.accountID ?? data?.accountId);
      if (!Number.isFinite(aid) || aid <= 0) throw new Error('Could not find a SoDEX spot account for this wallet. Deposit or activate the account in SoDEX first.');
      setAccountId(aid);
      const balancesJson = await request(`accounts/${address}/balances`);
      const rows = getRows<Balance>(balancesJson?.data?.balances ? balancesJson.data.balances : balancesJson);
      setBalances(rows.filter((b) => b.coin && Number(b.total) > 0));
    } catch (e) {
      setAccountId(null); setBalances([]); setNotice({ kind: 'error', text: errText(e) });
    } finally { setLoadingAccount(false); }
  }, []);

  const loadSosoBalance = useCallback(async (address: string) => {
    try {
      if (!window.ethereum) return;
      const activeChain = await window.ethereum.request({ method: 'eth_chainId' });
      if (String(activeChain).toLowerCase() !== CHAIN_HEX) { setSosoBalance(null); return; }
      const raw = await window.ethereum.request({ method: 'eth_getBalance', params: [address, 'latest'] });
      setSosoBalance(formatSoso(raw));
    } catch { setSosoBalance(null); }
  }, []);

  const loadBook = useCallback(async (pair: Pair) => {
    try {
      const json = await request(`markets/${encodeURIComponent(pair.name)}/orderbook?limit=16`);
      const data = json?.data ?? json;
      setBook({ bids: Array.isArray(data?.bids) ? data.bids : [], asks: Array.isArray(data?.asks) ? data.asks : [] });
      const bestAsk = data?.asks?.[0]?.[0];
      if (bestAsk && !price) setPrice(String(bestAsk));
    } catch (e) { setBook({ bids: [], asks: [] }); setNotice({ kind: 'error', text: `Order book unavailable: ${errText(e)}` }); }
  }, [price]);

  useEffect(() => { void loadMarkets(); }, [loadMarkets]);
  useEffect(() => {
    if (!selected) return;
    void loadBook(selected);
    const id = window.setInterval(() => { void loadBook(selected); void loadMarkets(); }, 7000);
    return () => window.clearInterval(id);
  }, [selected, loadBook, loadMarkets]);
  useEffect(() => {
    if (!wallet || !window.ethereum) return;
    const changed = (accounts: string[]) => {
      const next = accounts?.[0] ?? '';
      setWallet(next); setAccountId(null); setBalances([]); setSosoBalance(null);
      if (next) { void loadAccount(next); void loadSosoBalance(next); }
    };
    window.ethereum.on?.('accountsChanged', changed);
    return () => window.ethereum?.removeListener?.('accountsChanged', changed);
  }, [wallet, loadAccount, loadSosoBalance]);

  const connectWallet = async () => {
    setNotice(null);
    if (!window.ethereum) { setNotice({ kind: 'error', text: 'No EVM wallet found. Install MetaMask or another injected wallet to connect.' }); return; }
    setBusy(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('Wallet did not return an account.');
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (String(chain).toLowerCase() !== CHAIN_HEX) {
        try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
        catch (switchError: any) {
          if (switchError?.code !== 4902) throw switchError;
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'ValueChain', nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 }, rpcUrls: ['https://mainnet.valuechain.xyz'], blockExplorerUrls: ['https://main-scan.valuechain.xyz'] }] });
        }
      }
      setWallet(address); await Promise.all([loadAccount(address), loadSosoBalance(address)]);
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
    finally { setBusy(false); }
  };

  const submitOrder = async () => {
    if (!tradingEnabled) { setNotice({ kind: 'error', text: 'Live order sending is turned off in this build. Review only.' }); return; }
    if (!window.ethereum || !wallet || !selected || !accountId) return;
    setBusy(true); setNotice(null); setOrderResult(null);
    try {
      const activeChain = await window.ethereum.request({ method: 'eth_chainId' });
      if (String(activeChain).toLowerCase() !== CHAIN_HEX) throw new Error('Your wallet switched networks. Reconnect to SoDEX Mainnet before placing an order.');
      const normalizedPrice = orderType === 'limit' ? cleanDecimal(price) : undefined;
      const normalizedAmount = cleanDecimal(quantity);
      if (normalizedPrice && !onStep(normalizedPrice, selected.tickSize)) throw new Error(`Price must match this market's tick size (${selected.tickSize}).`);
      if (orderType === 'limit' || side === 'sell') {
        if (!onStep(normalizedAmount, selected.stepSize)) throw new Error(`Amount must match this market's step size (${selected.stepSize}).`);
        if (Number(normalizedAmount) < Number(selected.minQuantity)) throw new Error(`Minimum order amount is ${selected.minQuantity} ${selected.baseCoin}.`);
      } else if (selected.quoteCoinPrecision !== undefined && normalizedAmount.split('.')[1]?.length > selected.quoteCoinPrecision) {
        throw new Error(`Quote amount supports up to ${selected.quoteCoinPrecision} decimal places.`);
      }
      const balanceCoin = side === 'buy' ? selected.quoteCoin : selected.baseCoin;
      const available = balances.reduce((sum, item) => item.coin === balanceCoin ? sum + Number(item.total) - Number(item.locked) : sum, 0);
      const needed = side === 'buy' ? (orderType === 'market' ? Number(normalizedAmount) : Number(normalizedPrice) * Number(normalizedAmount)) : Number(normalizedAmount);
      if (needed > available) throw new Error(`Not enough available ${balanceCoin}. Available: ${fmt(available, 8)}.`);
      const body = {
        accountID: accountId,
        symbolID: selected.id,
        clOrdID: `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        side: side === 'buy' ? 1 : 2,
        type: orderType === 'market' ? 2 : 1,
        timeInForce: orderType === 'market' ? 3 : 1,
        ...(orderType === 'limit' ? { price: normalizedPrice, quantity: normalizedAmount } : side === 'buy' ? { funds: normalizedAmount } : { quantity: normalizedAmount }),
      };
      const nonce = nextNonce();
      const payloadHash = keccak256(toHex(JSON.stringify({ type: 'newOrder', params: body })));
      const typedData = {
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
          ExchangeAction: [{ name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }],
        },
        primaryType: 'ExchangeAction',
        domain: { name: 'spot', version: '1', chainId: CHAIN_ID, verifyingContract: '0x0000000000000000000000000000000000000000' },
        message: { payloadHash, nonce },
      };
      const signature = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [wallet, JSON.stringify(typedData)] });
      const response = await fetch(`${API}/trade/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-sign': `0x01${String(signature).replace(/^0x/, '')}`, 'x-api-nonce': String(nonce), 'x-api-chain': String(CHAIN_ID) },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || (result?.code && Number(result.code) !== 0)) throw new Error(result?.msg || result?.message || result?.error || `Order rejected (${response.status}).`);
      setOrderResult(result?.data ?? result); setNotice({ kind: 'ok', text: 'Order submitted to SoDEX mainnet.' }); setShowConfirm(false); setQuantity('');
      await loadAccount(wallet);
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
    finally { setBusy(false); }
  };

  const filteredPairs = pairs.filter((p) => `${p.baseCoin}/${p.quoteCoin} ${p.name}`.toLowerCase().includes(search.toLowerCase()));
  const nav: { id: Tab; label: string }[] = [{ id: 'swap', label: 'Swap' }, { id: 'markets', label: 'Markets' }, { id: 'portfolio', label: 'Portfolio' }, { id: 'bots', label: 'Bots' }];

  if (String(tab) === 'swap') return <SodexSwap onView={(view) => setTab(view)} />;

  return <main className="grid-glow min-h-screen ss-suite">
    <header className="sticky top-0 z-30 border-b border-white/[.08] bg-ink/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center gap-7 px-4 py-3 md:px-7">
        <a href="#trade" className="flex shrink-0 items-center gap-2.5"><AppMark /><div><div className="text-[15px] font-bold tracking-tight">SoSwap</div><div className="text-[9px] font-semibold uppercase tracking-[.18em] text-lime/70">On SoDEX</div></div></a>
        <nav className="hidden items-center gap-1 md:flex">{nav.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-lg px-3.5 py-2 text-[13px] transition ${tab === item.id ? 'bg-white/[.08] text-white' : 'text-zinc-500 hover:text-white'}`}>{item.label}</button>)}</nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[.035] px-3 py-2 text-[11px] text-zinc-400 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-lime" />SoDEX Mainnet<span className="text-zinc-600">·</span>{CHAIN_ID}</div>
          {wallet && <button onClick={() => void loadSosoBalance(wallet)} title="Native ValueChain gas token balance" className="hidden items-center gap-2 rounded-xl border border-lime/20 bg-lime/[.06] px-3 py-2 text-xs sm:flex"><span className="grid h-5 w-5 place-items-center rounded-full bg-lime text-[9px] font-black text-ink">S</span><span className="font-mono text-lime">{sosoBalance === null ? '—' : fmt(sosoBalance, 5)}</span><span className="text-zinc-500">SOSO gas</span></button>}
          <ThemeToggle />{wallet ? <button onClick={() => { setWallet(''); setAccountId(null); setBalances([]); setSosoBalance(null); }} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-xs hover:border-lime/40"><span className="h-1.5 w-1.5 rounded-full bg-lime" />{shortAddress(wallet)}<X size={13} className="text-zinc-500" /></button> : <button onClick={connectWallet} disabled={busy} className="flex items-center gap-2 rounded-xl bg-lime px-3.5 py-2.5 text-xs font-bold text-ink transition hover:bg-[#d5ff84] disabled:opacity-60"><Wallet size={15} />{busy ? 'Connecting…' : 'Connect wallet'}</button>}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-white/[.06] px-3 py-2 md:hidden">{nav.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs ${tab === item.id ? 'bg-white/[.08] text-white' : 'text-zinc-500'}`}>{item.label}</button>)}</nav>
    </header>

    <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 md:px-7 md:pt-9">
      {notice && <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-rose-400/20 bg-rose-400/[.06] text-rose-200' : notice.kind === 'ok' ? 'border-lime/20 bg-lime/[.06] text-lime' : 'border-sky-400/20 bg-sky-400/[.06] text-sky-200'}`}><span className="mt-0.5">{notice.kind === 'ok' ? <Check size={16} /> : <CircleHelp size={16} />}</span><span className="flex-1">{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button></div>}

      {tab === 'swap' && <>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-lime"><span className="h-1.5 w-1.5 rounded-full bg-lime" />Every live SoDEX spot pair</div><h1 className="text-3xl font-semibold tracking-tight md:text-[40px]">Swap any supported token<span className="text-lime">.</span></h1><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">Choose from SoDEX’s live pairs, inspect the order book, and sign your order in your wallet.</p><div className="mt-3 inline-flex items-center gap-2 rounded-full border border-lime/15 bg-lime/[.05] px-3 py-1.5 text-[11px] text-zinc-400"><span className="grid h-4 w-4 place-items-center rounded-full bg-lime text-[8px] font-black text-ink">S</span><span><b className="text-lime">SOSO</b> is ValueChain gas · target SoSwap fee 0.02%–0.15% in SOSO; SoDEX order signing is gas-free</span></div></div><button onClick={() => { void loadMarkets(); if (selected) void loadBook(selected); }} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white"><RefreshCw size={14} className={loadingMarket ? 'animate-spin' : ''} />Refresh data</button></div>
        <div className="mb-4 flex items-center gap-3 overflow-x-auto rounded-xl border border-white/[.08] bg-panel/80 px-4 py-3">
          <TokenAvatar symbol={selected?.baseCoin ?? '—'} size="small" />
          <div className="min-w-[140px]"><label htmlFor="pair-picker" className="sr-only">Choose a live SoDEX pair</label><select id="pair-picker" value={selected?.id ?? ''} onChange={(e) => { const pair = pairs.find((p) => p.id === Number(e.target.value)); if (pair) { setSelected(pair); setPrice(''); setQuantity(''); } }} className="max-w-[180px] appearance-none bg-transparent pr-5 text-sm font-semibold outline-none"><option value="" disabled>{loadingMarket ? 'Loading markets' : 'Choose pair'}</option>{pairs.map((p) => <option key={p.id} value={p.id} className="bg-ink">{p.baseCoin}/{p.quoteCoin}</option>)}</select><div className="text-[10px] text-zinc-600">All live SoDEX pairs</div></div>
          <div className="h-8 w-px bg-white/10" />
          <div><div className="font-mono text-lg">{selected ? fmt(lastPrice, 8) : '—'}</div><div className="text-[10px] text-zinc-600">Last price · {selected?.quoteCoin ?? ''}</div></div>
          <div className={`ml-2 rounded-md px-2 py-1 text-xs ${Number(ticker?.changePct ?? 0) >= 0 ? 'bg-lime/[.08] text-lime' : 'bg-rose-400/[.08] text-rose-300'}`}>{ticker?.changePct === undefined ? '—' : `${Number(ticker.changePct) >= 0 ? '+' : ''}${Number(ticker.changePct).toFixed(2)}%`}</div>
          <div className="ml-auto hidden text-right sm:block"><div className="font-mono text-xs">{fmt(ticker?.quoteVolume, 2)}</div><div className="text-[10px] text-zinc-600">24h quote volume</div></div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section className="overflow-hidden rounded-2xl border border-white/[.08] bg-panel/90">
            <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3"><div className="text-sm font-semibold">Order book <span className="ml-2 text-[10px] font-normal text-zinc-600">Live SoDEX data</span></div><button onClick={() => selected && void loadBook(selected)} aria-label="Refresh order book" className="text-zinc-500 hover:text-lime"><RefreshCw size={14} /></button></div>
            <div className="grid grid-cols-2 px-4 pt-3 text-[10px] uppercase tracking-wider text-zinc-600"><span>Price ({selected?.quoteCoin})</span><span className="text-right">Amount ({selected?.baseCoin})</span></div>
            <div className="grid grid-cols-2 px-4 pb-2 pt-1">{asks.length ? asks.map((l, i) => <div key={`a${i}`} className="contents font-mono text-xs"><span className="py-1 text-rose-300">{fmt(l[0], 8)}</span><span className="py-1 text-right text-zinc-400">{fmt(l[1], 8)}</span></div>) : <div className="col-span-2 py-8 text-center text-xs text-zinc-600">{loadingMarket ? 'Loading live order book…' : 'No ask levels returned.'}</div>}</div>
            <div className="border-y border-white/[.06] bg-white/[.02] px-4 py-2 font-mono text-sm"><span className="text-zinc-500">Mid </span><span>{book.bids[0] && book.asks[0] ? fmt((Number(book.bids[0][0]) + Number(book.asks[0][0])) / 2, 8) : fmt(lastPrice, 8)}</span><span className="ml-2 text-[10px] text-zinc-600">{selected?.quoteCoin}</span></div>
            <div className="grid grid-cols-2 px-4 pb-4 pt-2">{bids.length ? bids.map((l, i) => <div key={`b${i}`} className="contents font-mono text-xs"><span className="py-1 text-lime">{fmt(l[0], 8)}</span><span className="py-1 text-right text-zinc-400">{fmt(l[1], 8)}</span></div>) : <div className="col-span-2 py-8 text-center text-xs text-zinc-600">No bid levels returned.</div>}</div>
          </section>

          <section className="rounded-2xl border border-white/[.08] bg-panel/90 p-4">
            <div className="mb-4 flex rounded-lg bg-ink p-1"><button onClick={() => setSide('buy')} className={`flex-1 rounded-md py-2 text-xs font-bold ${side === 'buy' ? 'bg-lime text-ink' : 'text-zinc-500 hover:text-white'}`}>Buy</button><button onClick={() => setSide('sell')} className={`flex-1 rounded-md py-2 text-xs font-bold ${side === 'sell' ? 'bg-rose-400 text-ink' : 'text-zinc-500 hover:text-white'}`}>Sell</button></div>
            <label className="mb-2 block text-[11px] text-zinc-500">Order type</label><div className="mb-4 flex gap-2"><button onClick={() => setOrderType('limit')} className={`rounded-md border px-3 py-2 text-xs ${orderType === 'limit' ? 'border-lime/40 text-lime' : 'border-white/10 text-zinc-500'}`}>Limit</button><button onClick={() => setOrderType('market')} className={`rounded-md border px-3 py-2 text-xs ${orderType === 'market' ? 'border-lime/40 text-lime' : 'border-white/10 text-zinc-500'}`}>Market</button></div>
            {orderType === 'limit' && <label className="mb-3 block"><span className="mb-1.5 block text-[11px] text-zinc-500">Price · {selected?.quoteCoin}</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={lastPrice ? String(lastPrice) : 'Live price unavailable'} className="w-full rounded-lg border border-white/10 bg-ink px-3 py-3 font-mono text-sm outline-none focus:border-lime/50" /></label>}
            <label className="mb-3 block"><span className="mb-1.5 block text-[11px] text-zinc-500">{orderType === 'market' && side === 'buy' ? `Spend · ${selected?.quoteCoin}` : `Amount · ${selected?.baseCoin}`}</span><input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full rounded-lg border border-white/10 bg-ink px-3 py-3 font-mono text-sm outline-none focus:border-lime/50" /></label>
            <div className="mb-4 flex justify-between text-[11px] text-zinc-600"><span>{orderType === 'market' && side === 'buy' ? 'Spend amount' : 'Estimated total'}</span><span className="font-mono text-zinc-300">{tradeValue > 0 ? `${fmt(tradeValue, 6)} ${selected?.quoteCoin ?? ''}` : '—'}</span></div>
            {wallet && <div className="mb-4 rounded-lg border border-white/[.07] bg-ink/70 px-3 py-2.5 text-[11px]">{loadingAccount ? <span className="text-zinc-500">Loading SoDEX account…</span> : accountId ? <><div className="flex justify-between text-zinc-500"><span>SoDEX account</span><span className="font-mono text-zinc-300">#{accountId}</span></div><div className="mt-1.5 flex justify-between text-zinc-500"><span>{side === 'buy' ? selected?.quoteCoin : selected?.baseCoin} available</span><span className="font-mono text-zinc-300">{fmt(balances.find((b) => b.coin === (side === 'buy' ? selected?.quoteCoin : selected?.baseCoin))?.total, 8)}</span></div></> : <span className="text-amber-200">No active SoDEX spot account found.</span>}<div className="mt-2 flex justify-between border-t border-white/[.06] pt-2 text-zinc-500"><span>Native gas balance</span><button className="font-mono text-lime hover:text-white" onClick={() => void loadSosoBalance(wallet)}>{sosoBalance === null ? 'Check SOSO' : `${fmt(sosoBalance, 6)} SOSO`}</button></div></div>}
            <button onClick={() => wallet ? setShowConfirm(true) : void connectWallet()} disabled={busy || loadingMarket || !pairs.length || Boolean(wallet && !accountId)} className={`w-full rounded-lg py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${side === 'buy' ? 'bg-lime text-ink hover:bg-[#d5ff84]' : 'bg-rose-400 text-ink hover:bg-rose-300'}`}>{wallet ? `${side === 'buy' ? 'Buy' : 'Sell'} ${selected?.baseCoin ?? ''}` : 'Connect wallet to trade'}</button>
            <div className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-zinc-600"><ShieldCheck size={14} className="mt-px shrink-0 text-lime/70" />Each order is signed in your wallet and sent to SoDEX. Review the order details before approving.</div>
          </section>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-[11px] text-zinc-500"><LockKeyhole size={14} className="text-lime/70" />Non-custodial wallet connection. SoSwap never asks for a seed phrase or private key.<a className="ml-auto inline-flex items-center gap-1 text-zinc-400 hover:text-lime" href="https://docs.sodex.com" target="_blank" rel="noreferrer">SoDEX docs <ExternalLink size={12} /></a></div>
      </>}

      {tab === 'markets' && <MarketInsights pairs={pairs} tickers={tickers} search={search} onSearch={setSearch} onTrade={(pair) => { setSelected(pair); setTab('swap'); }} />}

      {tab === 'portfolio' && <><div className="mb-6"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-lime">Wallet · SoDEX</div><h1 className="mt-2 text-3xl font-semibold">Portfolio</h1><p className="mt-2 text-sm text-zinc-500">Spot balances are fetched from your connected SoDEX account.</p></div>{!wallet ? <EmptyState text="Connect your wallet to view your SoDEX account balances." action={connectWallet} /> : loadingAccount ? <div className="flex items-center gap-2 p-8 text-sm text-zinc-500"><LoaderCircle className="animate-spin" size={16} />Loading account data…</div> : accountId ? <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-panel"><div className="flex items-center justify-between border-b border-white/[.07] px-4 py-4"><div><div className="text-sm font-semibold">Spot balances</div><div className="mt-1 font-mono text-xs text-zinc-600">{shortAddress(wallet)} · account #{accountId}</div></div><button onClick={() => void loadAccount(wallet)} className="text-zinc-500 hover:text-lime"><RefreshCw size={15} /></button></div>{balances.length ? balances.map((b) => <div key={b.id ?? b.coin} className="grid grid-cols-3 border-b border-white/[.045] px-4 py-4 text-sm"><span className="flex items-center gap-2 font-semibold"><TokenAvatar symbol={b.coin} size="small"/>{b.coin}</span><span className="text-right font-mono">{fmt(b.total, 8)}</span><span className="text-right font-mono text-zinc-600">Locked {fmt(b.locked, 8)}</span></div>) : <div className="p-8 text-center text-sm text-zinc-500">No non-zero spot balances returned from SoDEX.</div>}</div> : <EmptyState text="This wallet does not have a readable SoDEX spot account yet." />}</>}

      {tab === 'bots' && <BotStudio />}

      <footer className="mt-12 border-t border-white/[.07] pt-5 text-[10px] leading-5 text-zinc-700">SoSwap is an independent interface to SoDEX. Market data can be delayed or unavailable. Orders are sent to SoDEX mainnet only after wallet signature. Verify every order in your wallet before signing.</footer>
    </div>

    {showConfirm && selected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101411] p-5 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-lime">Wallet confirmation</div><h2 id="confirm-title" className="mt-2 text-xl font-semibold">Review your order</h2></div><button onClick={() => setShowConfirm(false)} aria-label="Close" className="text-zinc-500 hover:text-white"><X size={18} /></button></div><div className="my-5 space-y-3 rounded-xl border border-white/[.07] bg-ink p-4 text-sm"><Detail label="Market" value={`${selected.baseCoin}/${selected.quoteCoin}`} /><Detail label="Side" value={side.toUpperCase()} /><Detail label="Type" value={orderType.toUpperCase()} />{orderType === 'limit' && <Detail label="Limit price" value={`${fmt(price, 8)} ${selected.quoteCoin}`} />}<Detail label="Amount" value={`${fmt(quantity, 8)} ${selected.baseCoin}`} /><Detail label="Est. total" value={`${fmt(tradeValue, 6)} ${selected.quoteCoin}`} /><Detail label="Target SoSwap fee" value="0.02%–0.15% · SOSO (not yet collected)" /><Detail label="SoDEX order gas" value="0 SOSO · gas-free order signing" /><Detail label="Account" value={accountId ? `#${accountId}` : 'Not connected'} /></div>{!tradingEnabled && <p role="status" className="mb-3 rounded-lg border border-amber-300/20 bg-amber-300/[.06] px-3 py-2 text-[11px] leading-5 text-amber-200">Live order sending is turned off in this build. You can review the order, but nothing will be signed or sent.</p>}<p className="mb-4 text-[11px] leading-5 text-amber-200/80">The SoSwap SOSO fee is a target and is not collected in this build. SoDEX order signing is gas-free; SoDEX trading fees may apply separately. Your wallet will show the order signature.</p><button disabled={!tradingEnabled || busy || !quantity || (orderType === 'limit' && !price) || !accountId} onClick={() => void submitOrder()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-lime py-3 text-sm font-bold text-ink disabled:opacity-40">{busy ? <><LoaderCircle size={15} className="animate-spin" />Waiting for wallet…</> : <><ShieldCheck size={16} />{tradingEnabled ? 'Sign and submit order' : 'Order sending is off'}</>}</button></section></div>}
    {orderResult && <div className="fixed bottom-4 right-4 z-40 w-[min(380px,calc(100%-2rem))] rounded-xl border border-lime/20 bg-[#131912] p-4 shadow-2xl"><div className="flex items-start gap-3"><Check className="mt-0.5 text-lime" size={17} /><div className="min-w-0 flex-1"><div className="text-sm font-semibold">Order accepted by SoDEX</div><pre className="mt-2 overflow-auto text-[10px] text-zinc-500">{JSON.stringify(orderResult, null, 2)}</pre></div><button onClick={() => setOrderResult(null)} aria-label="Dismiss"><X size={14} className="text-zinc-500" /></button></div></div>}
  </main>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-zinc-600">{label}</span><span className="text-right font-mono text-zinc-200">{value}</span></div>; }
function EmptyState({ text, action }: { text: string; action?: () => void }) { return <div className="rounded-2xl border border-dashed border-white/10 bg-panel/60 p-10 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-zinc-500"><Wallet size={18} /></div><p className="mx-auto mt-4 max-w-sm text-sm text-zinc-500">{text}</p>{action && <button onClick={action} className="mt-4 rounded-lg bg-lime px-4 py-2 text-xs font-bold text-ink">Connect wallet</button>}</div>; }
