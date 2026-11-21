import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { ArbitrageOpportunity, BuyMethod, TradeMode } from '../types';
import { formatISK, formatInt } from '../utils/arbitrage';
import type { DailyVolumeStats } from '../utils/history';

interface OrderBookGridProps {
  opp: ArbitrageOpportunity;
  buyMethod?: BuyMethod;
  tradeMode?: TradeMode;
  originSystemFallback?: string;
  destSystemFallback?: string;
  originStats?: DailyVolumeStats | null;
  destStats?: DailyVolumeStats | null;
  maxLevels?: number;
}

/** Step a price by 1 EVE Online market tick (4 significant digits, min 0.01 ISK). */
function stepEveTick(price: number, dir: 1 | -1): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const digits = Math.floor(Math.log10(price)) + 1;
  let tick = digits <= 2 ? 0.01 : Math.pow(10, Math.max(-2, digits - 4));
  if (dir === -1 && digits > 2 && Math.abs(price - Math.pow(10, digits - 1)) < 1e-6) {
    tick = tick / 10;
  }
  const next = Math.max(0.01, price + dir * tick);
  return Number(next.toFixed(2));
}

export function OrderBookGrid({
  opp,
  buyMethod = 'instant',
  tradeMode = 'instant',
  originSystemFallback,
  destSystemFallback,
  originStats,
  destStats,
  maxLevels = 5,
}: OrderBookGridProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const originSells = opp.originSells.slice(0, maxLevels);
  const originBuys = opp.originBuys.slice(0, maxLevels);
  const destSells = opp.destSells.slice(0, maxLevels);
  const destBuys = opp.destBuys.slice(0, maxLevels);

  const copyPrice = (e: React.MouseEvent, key: string, value: number) => {
    e.stopPropagation();
    navigator.clipboard.writeText(String(value));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1200);
  };

  const renderCopyBadge = (key: string, price: number, title: string) => (
    <button
      type="button"
      onClick={(e) => copyPrice(e, key, price)}
      title={title}
      className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-1.5 py-0.2 rounded tabular-nums shrink-0 cursor-pointer transition"
    >
      <span>{formatISK(price, false).replace(/\.00$/, '')}</span>
      {copiedKey === key ? (
        <Check className="w-2.5 h-2.5 text-emerald-400" />
      ) : (
        <Copy className="w-2.5 h-2.5 text-slate-400" />
      )}
    </button>
  );

  const origSellInstantPrice =
    buyMethod === 'instant' && originSells.length > 0 ? Number(originSells[0][0].toFixed(2)) : null;
  const origBuyOrderPrice =
    buyMethod === 'order' && originBuys.length > 0 ? stepEveTick(originBuys[0][0], 1) : null;
  const destBuyInstantPrice =
    tradeMode === 'instant' && destBuys.length > 0 ? Number(destBuys[0][0].toFixed(2)) : null;
  const destSellOrderPrice =
    tradeMode === 'patient' && destSells.length > 0 ? stepEveTick(destSells[0][0], -1) : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
      {/* Origin Station Box */}
      <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-2.5 sm:p-3 grid grid-rows-[auto_1fr_auto] sm:row-span-3 sm:grid-rows-subgrid gap-y-2">
        <div className="text-xs font-bold text-white truncate pb-1 border-b border-slate-800/80">
          Origin: {opp.originSystemName ?? originSystemFallback}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-rose-400">Sellers</span>
              {originStats?.avgSell7d != null && (
                <span
                  title={
                    originStats.low7d != null && originStats.high7d != null
                      ? `14d Low: ${formatISK(originStats.low7d, true)} | High: ${formatISK(originStats.high7d, true)} (real trades)`
                      : '14d volume-weighted average executed high'
                  }
                  className="text-[10px] text-rose-300/80 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded tabular-nums truncate cursor-help"
                >
                  Avg Sell: {formatISK(originStats.avgSell7d, true)}
                </span>
              )}
              {origSellInstantPrice !== null &&
                renderCopyBadge('orig-sell', origSellInstantPrice, 'Copy Instant Buy price (lowest seller)')}
            </div>
            <span className="text-slate-400 tabular-nums shrink-0">{formatInt(opp.originSellVol)}x</span>
          </div>
          {originSells.length === 0 ? (
            <div className="text-slate-500">No sell orders</div>
          ) : (
            <div className="space-y-0.5 tabular-nums">
              {originSells.map(([p, q], i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-rose-300">{formatISK(p)}</span>
                  <span className="text-slate-400">{formatInt(q)}x</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pt-1.5 border-t border-slate-800/80">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-emerald-400">Buyers</span>
              {originStats?.avgBuy7d != null && (
                <span
                  title={
                    originStats.low7d != null && originStats.high7d != null
                      ? `14d Low: ${formatISK(originStats.low7d, true)} | High: ${formatISK(originStats.high7d, true)} (real trades)`
                      : '14d volume-weighted average executed low'
                  }
                  className="text-[10px] text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded tabular-nums truncate cursor-help"
                >
                  Avg Buy: {formatISK(originStats.avgBuy7d, true)}
                </span>
              )}
              {origBuyOrderPrice !== null &&
                renderCopyBadge('orig-buy', origBuyOrderPrice, 'Copy Buy Order price (+1 tick above top buyer)')}
            </div>
            <span className="text-slate-400 tabular-nums shrink-0">{formatInt(opp.originBuyVol)}x</span>
          </div>
          {originBuys.length === 0 ? (
            <div className="text-slate-500">No buy orders</div>
          ) : (
            <div className="space-y-0.5 tabular-nums">
              {originBuys.map(([p, q], i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-emerald-300">{formatISK(p)}</span>
                  <span className="text-slate-400">{formatInt(q)}x</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Destination Station Box */}
      <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-2.5 sm:p-3 grid grid-rows-[auto_1fr_auto] sm:row-span-3 sm:grid-rows-subgrid gap-y-2">
        <div className="text-xs font-bold text-white truncate pb-1 border-b border-slate-800/80">
          Dest: {opp.destSystemName ?? destSystemFallback}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-rose-400">Sellers</span>
              {destStats?.avgSell7d != null && (
                <span
                  title={
                    destStats.low7d != null && destStats.high7d != null
                      ? `14d Low: ${formatISK(destStats.low7d, true)} | High: ${formatISK(destStats.high7d, true)} (real trades)`
                      : '14d volume-weighted average executed high'
                  }
                  className="text-[10px] text-rose-300/80 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded tabular-nums truncate cursor-help"
                >
                  Avg Sell: {formatISK(destStats.avgSell7d, true)}
                </span>
              )}
              {destSellOrderPrice !== null &&
                renderCopyBadge('dest-sell', destSellOrderPrice, 'Copy Sell Order price (-1 tick below lowest seller)')}
            </div>
            <span className="text-slate-400 tabular-nums shrink-0">{formatInt(opp.destSellVol)}x</span>
          </div>
          {destSells.length === 0 ? (
            <div className="text-slate-500">No competing sells</div>
          ) : (
            <div className="space-y-0.5 tabular-nums">
              {destSells.map(([p, q], i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-rose-300">{formatISK(p)}</span>
                  <span className="text-slate-400">{formatInt(q)}x</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pt-1.5 border-t border-slate-800/80">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-emerald-400">Buyers</span>
              {destStats?.avgBuy7d != null && (
                <span
                  title={
                    destStats.low7d != null && destStats.high7d != null
                      ? `14d Low: ${formatISK(destStats.low7d, true)} | High: ${formatISK(destStats.high7d, true)} (real trades)`
                      : '14d volume-weighted average executed low'
                  }
                  className="text-[10px] text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded tabular-nums truncate cursor-help"
                >
                  Avg Buy: {formatISK(destStats.avgBuy7d, true)}
                </span>
              )}
              {destBuyInstantPrice !== null &&
                renderCopyBadge('dest-buy', destBuyInstantPrice, 'Copy Instant Sell target price (top buyer)')}
            </div>
            <span className="text-slate-400 tabular-nums shrink-0">{formatInt(opp.destBuyVol)}x</span>
          </div>
          {destBuys.length === 0 ? (
            <div className="text-rose-400/80">No active buy orders</div>
          ) : (
            <div className="space-y-0.5 tabular-nums">
              {destBuys.map(([p, q], i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-emerald-300">{formatISK(p)}</span>
                  <span className="text-slate-400">{formatInt(q)}x</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
