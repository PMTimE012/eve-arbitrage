import type { ArbitrageOpportunity } from '../types';
import { formatISK, formatInt } from '../utils/arbitrage';

interface OrderBookGridProps {
  opp: ArbitrageOpportunity;
  originSystemFallback?: string;
  destSystemFallback?: string;
  maxLevels?: number;
}

export function OrderBookGrid({
  opp,
  originSystemFallback,
  destSystemFallback,
  maxLevels = 5,
}: OrderBookGridProps) {
  const originSells = opp.originSells.slice(0, maxLevels);
  const originBuys = opp.originBuys.slice(0, maxLevels);
  const destSells = opp.destSells.slice(0, maxLevels);
  const destBuys = opp.destBuys.slice(0, maxLevels);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
      {/* Origin Station Box */}
      <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-2.5 sm:p-3 grid grid-rows-[auto_1fr_auto] sm:row-span-3 sm:grid-rows-subgrid gap-y-2">
        <div className="text-xs font-bold text-white truncate pb-1 border-b border-slate-800/80">
          Origin: {opp.originSystemName ?? originSystemFallback}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-rose-400">Sellers</span>
            <span className="text-slate-400 tabular-nums">{formatInt(opp.originSellVol)}x</span>
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
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-emerald-400">Buyers</span>
            <span className="text-slate-400 tabular-nums">{formatInt(opp.originBuyVol)}x</span>
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
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-rose-400">Sellers</span>
            <span className="text-slate-400 tabular-nums">{formatInt(opp.destSellVol)}x</span>
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
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-emerald-400">Buyers</span>
            <span className="text-slate-400 tabular-nums">{formatInt(opp.destBuyVol)}x</span>
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
