import { useQuery } from '@tanstack/react-query';
import './energy-market-ticker.css';

type Quote = { symbol: string; price: number | null; change?: number | null; percent?: number | null; asOf?: string; note: string };
export function EnergyMarketTicker() {
  const { data } = useQuery<{ quotes: Quote[] }>({
    queryKey: ['energy-market-ticker'],
    queryFn: async () => {
      const response = await fetch('/api/market/ticker', { credentials: 'include' });
      if (!response.ok) throw new Error('Market data unavailable');
      return response.json();
    },
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: 1,
  });
  const labels: Record<string, string> = {DOW: 'DOW', NASDAQ: 'NASDAQ', WTI: 'Light Sweet', BRENT: 'Brent', WCS: 'Heavy Crude'};
  const quotes = ['DOW', 'NASDAQ', 'WTI', 'BRENT', 'WCS'].flatMap(symbol => {
    const quote = data?.quotes?.find(q => q.symbol === symbol);
    return quote ? [quote] : [];
  });
  const signed = (n: number, dollar = false) => `${n < 0 ? '−' : '+'}${dollar ? '$' : ''}${Math.abs(n).toFixed(2)}`;
  return <div className="energy-market-ticker" data-testid="energy-market-ticker" role="region" aria-label="Energy market prices">
    {quotes.length ? <div className="energy-market-ticker-track">
      {[0, 1].map(copy => <div className="energy-market-ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
        {quotes.map(q => <span className="energy-market-ticker-quote" key={q.symbol} title={`${q.symbol} · ${q.note}${q.asOf ? ` · ${q.asOf}` : ''}`}>
          <strong>{labels[q.symbol]}</strong>
          {q.price == null ? <span className="energy-market-ticker-note" aria-label={q.note}>—</span> : <>
            <span>{['NASDAQ', 'DOW'].includes(q.symbol) ? '' : '$'}{q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{['WTI', 'BRENT', 'WCS'].includes(q.symbol) ? '/bbl' : ''}</span>
            {q.change != null && q.percent != null && <span className={q.change < 0 ? 'energy-market-down' : 'energy-market-up'}>{signed(q.change, !['NASDAQ', 'DOW'].includes(q.symbol))} ({signed(q.percent)}%)</span>}
          </>}
        </span>)}
      </div>)}
    </div> : <span className="energy-market-ticker-note">Market prices unavailable</span>}
  </div>;
}
