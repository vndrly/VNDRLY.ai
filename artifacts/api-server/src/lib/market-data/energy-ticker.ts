export type TickerQuote = { symbol: string; price: number | null; change?: number | null; percent?: number | null; asOf?: string; note: string };
// A curated energy and pipeline universe; do not represent this as every listed energy company.
export const ENERGY_SYMBOLS = ['XOM','CVX','COP','SLB','HAL','BKR','KMI','WMB','OKE','ET','EOG','OXY','FANG','DVN','CTRA','EQT','APA','OVV','CHRD','PR','SM','MTDR','MUR','CNX','RRC','AR','GPOR','CRK','VLO','MPC','PSX','DINO','PBF','EPD','ENB','TRP','PAA','PAGP','TRGP','LNG','WES','DTM','AM','HESM','NFG','HP','NBR','PTEN','RIG','VAL','NE','OII','FTI','WFRD','NOV','LBRT','CHX'];
type StockSnapshot = {ticker: string; min?: {c?: number; t?: number}; day?: {c?: number}; prevDay?: {c?: number}};
export function normalizeSnapshot(t: StockSnapshot): TickerQuote | null {
  const price = t?.min?.c ?? t?.day?.c;
  const previous = t?.prevDay?.c;
  if (typeof price !== 'number' || !Number.isFinite(price) || typeof previous !== 'number' || previous <= 0) return null;
  const stamp = t?.min?.t;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return null;
  return { symbol: t.ticker, price, change: price - previous, percent: (price - previous) / previous * 100, asOf: new Date(stamp).toISOString().replace('T',' ').slice(0,16)+' UTC', note: '15m delayed' };
}
export function parseEiaWti(html: string, symbol = 'WTI'): TickerQuote {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const observations: {price: number; date: string}[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
    const start = cells[0]?.match(/^(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to/);
    if (!start || cells.length !== 6) continue;
    const month = months.indexOf(start[2]);
    if (month < 0) continue;
    cells.slice(1).forEach((value,index) => {
      if (!/^-?\d+(\.\d+)?$/.test(value)) return;
      const date = new Date(Date.UTC(Number(start[1]),month,Number(start[3])+index)).toISOString().slice(0,10);
      observations.push({price:Number(value),date});
    });
  }
  const latest = observations.at(-1), previous = observations.at(-2);
  if (!latest) throw new Error('WTI data unavailable');
  return { symbol,price:latest.price,change:previous ? latest.price-previous.price : null,percent:previous && previous.price !== 0 ? (latest.price-previous.price)/Math.abs(previous.price)*100 : null,asOf:latest.date,note:'EIA daily spot' };
}
export function parseWcsWeekly(html: string): TickerQuote {
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    // The source occasionally omits a closing </td>. Opening cells remain
    // reliable delimiters, so parse those instead of requiring valid HTML.
    const cells = row[1]
      .replace(/<td\b[^>]*>/gi, '|')
      .replace(/<[^>]+>/g, '')
      .replace(/&#9660;|&#9650;/g, '')
      .replace(/&nbsp;/g, ' ')
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean);
    const wcsIndex = cells.indexOf('WCS');
    if (wcsIndex < 0) continue;
    const price = Number(cells[wcsIndex + 1]);
    const change = Number(cells[wcsIndex + 2]);
    const percent = Number(cells[wcsIndex + 3]?.replace('%', ''));
    if (![price, change, percent].every(Number.isFinite)) break;
    return {symbol:'WCS', price, change, percent, note:'Weekly WCS benchmark'};
  }
  throw new Error('WCS data unavailable');
}
type FuturesContract = {ticker:string; type?:string; days_to_maturity?:number};
type FuturesBar = {close:number; settlement_price?:number; window_start:number; session_end_date:string};
export function marketDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function selectFrontMonth(contracts: FuturesContract[]): string {
  const selected = contracts
    .filter(contract => contract.type === 'single' && Number.isFinite(contract.days_to_maturity) && (contract.days_to_maturity ?? -1) >= 0)
    .sort((a,b) => (a.days_to_maturity ?? Infinity) - (b.days_to_maturity ?? Infinity))[0];
  if (!selected) throw new Error('Dow futures contract unavailable');
  return selected.ticker;
}
export function normalizeFuturesBars(symbol:string, bars:FuturesBar[]): TickerQuote {
  const completed = bars
    .filter(bar => Number.isFinite(bar.settlement_price) && Number.isFinite(bar.window_start))
    .sort((a,b) => b.window_start-a.window_start);
  const [latest, previous] = completed;
  const price = latest?.settlement_price;
  const previousPrice = previous?.settlement_price;
  if (price == null || previousPrice == null || previousPrice <= 0) throw new Error('Dow futures history unavailable');
  return {symbol, price, change:price-previousPrice, percent:(price-previousPrice)/previousPrice*100,
    asOf:latest.session_end_date, note:'E-mini Dow futures settlement'};
}
export function normalizeIndexBars(symbol: string, bars: {c: number; t: number}[]): TickerQuote {
  const sorted = bars.filter(b => Number.isFinite(b.c) && Number.isFinite(b.t)).sort((a,b) => b.t-a.t);
  const [latest, previous] = sorted;
  if (!latest || !previous || previous.c <= 0) throw new Error('Index history unavailable');
  return {symbol, price:latest.c, change:latest.c-previous.c, percent:(latest.c-previous.c)/previous.c*100,
    asOf:new Date(latest.t).toISOString().slice(0,10), note:'Massive daily close'};
}
async function fetchIndex(symbol: string, ticker: string, key?: string): Promise<TickerQuote> {
  if (!key) return {symbol,price:null,note:'Market provider not configured'};
  const end = new Date().toISOString().slice(0,10);
  const start = new Date(Date.now()-14*86400000).toISOString().slice(0,10);
  const response = await fetch(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${start}/${end}?sort=desc&limit=20`,
    {headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
  if (response.status === 403) return {symbol,price:null,note:'Not included in your Massive subscription'};
  if (!response.ok) throw new Error('Index feed unavailable');
  const data = await response.json() as {results?: {c:number;t:number}[]};
  return normalizeIndexBars(symbol,data.results ?? []);
}
async function fetchDow(key?:string): Promise<TickerQuote> {
  const index = await fetchIndex('DOW','I:DJI',key);
  if (index.price != null || !key) return index;
  const today = marketDate(new Date());
  const contractsResponse = await fetch(`https://api.massive.com/futures/v1/contracts?product_code=YM&date=${today}&limit=100`,
    {headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
  if (!contractsResponse.ok) throw new Error('Dow futures contracts unavailable');
  const contracts = await contractsResponse.json() as {results?:FuturesContract[]};
  const ticker = selectFrontMonth(contracts.results ?? []);
  const barsResponse = await fetch(`https://api.massive.com/futures/v1/aggs/${encodeURIComponent(ticker)}?resolution=1session&limit=5&sort=window_start.desc`,
    {headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
  if (!barsResponse.ok) throw new Error('Dow futures prices unavailable');
  const bars = await barsResponse.json() as {results?:FuturesBar[]};
  return normalizeFuturesBars('DOW',bars.results ?? []);
}
let cached: { quotes: TickerQuote[] } | undefined;
let expires = 0;
let pending: Promise<{quotes: TickerQuote[]}> | undefined;
export async function fetchEnergyTicker(key = process.env.MASSIVE_API_KEY): Promise<{quotes: TickerQuote[]}> {
  if (cached && Date.now() < expires) return cached;
  if (pending) return pending;
  pending = (async () => {
    const quotes: TickerQuote[] = [];
    const [oil,brent,wcs,nasdaq,dow] = await Promise.allSettled([
      fetch('https://www.eia.gov/dnav/pet/hist/RWTCd.htm',{signal:AbortSignal.timeout(12000)}).then(async r=>{if(!r.ok) throw new Error('EIA unavailable');return parseEiaWti(await r.text());}),
      fetch('https://www.eia.gov/dnav/pet/hist/RBRTEd.htm',{signal:AbortSignal.timeout(12000)}).then(async r=>{if(!r.ok) throw new Error('Brent unavailable');return parseEiaWti(await r.text(),'BRENT');}),
      fetch('https://www.oilsandsmagazine.com/energy-statistics/oil-and-gas-prices',{signal:AbortSignal.timeout(12000)}).then(async r=>{if(!r.ok) throw new Error('WCS unavailable');return parseWcsWeekly(await r.text());}),
      fetchIndex('NASDAQ','I:COMP',key),
      fetchDow(key),
    ]);
    quotes.push(nasdaq.status==='fulfilled'?nasdaq.value:{symbol:'NASDAQ',price:null,note:'Index feed unavailable'});
    quotes.push(dow.status==='fulfilled'?dow.value:{symbol:'DOW',price:null,note:'Index feed unavailable'});
    quotes.push(oil.status==='fulfilled'?oil.value:{symbol:'WTI',price:null,note:'EIA unavailable'});
    quotes.push(brent.status==='fulfilled'?brent.value:{symbol:'BRENT',price:null,note:'EIA unavailable'});
    quotes.push(wcs.status==='fulfilled'?wcs.value:{symbol:'WCS',price:null,note:'Heavy crude feed unavailable'});
    cached={quotes};expires=Date.now()+60_000;return cached;
  })();
  try{return await pending;}finally{pending=undefined;}
}
