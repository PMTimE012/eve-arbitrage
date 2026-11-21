import { ExternalLink, X } from 'lucide-react';
import type { BuyMethod, StationOption, TradeMode } from '../types';
import { formatISK, formatInt, formatVolume } from '../utils/arbitrage';
import type { DailyVolumeStats } from '../utils/history';
import type { TripItemPick } from '../utils/tripPlanner';
import { ItemImage } from './ItemImage';
import { OrderBookGrid } from './OrderBookGrid';
import { VolumeComparison } from './VolumeComparison';

interface TripItemModalProps {
  item: TripItemPick;
  buyMethod: BuyMethod;
  tradeMode: TradeMode;
  originStation: StationOption | null;
  destStation: StationOption | null;
  originStats: DailyVolumeStats | null;
  destStats: DailyVolumeStats | null;
  historyLoading: boolean;
  historyError: string | null;
  onClose: () => void;
}

export function TripItemModal({
  item,
  buyMethod,
  tradeMode,
  originStation,
  destStation,
  originStats,
  destStats,
  historyLoading,
  historyError,
  onClose,
}: TripItemModalProps) {
  const opp = item.opp;
  const originRegionName = opp.originRegionName ?? originStation?.regionName ?? 'Origin';
  const destRegionName = opp.destRegionName ?? destStation?.regionName ?? 'Destination';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0b1120] border border-slate-700/80 shadow-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <ItemImage
              typeId={opp.typeId}
              name={opp.name}
              size={64}
              className="w-9 h-9 rounded-lg border-slate-700 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-white truncate">{opp.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ${
                    opp.tradeScore >= 75
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : opp.tradeScore >= 55
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                      : opp.tradeScore >= 35
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                  }`}
                >
                  Score {opp.tradeScore}/100
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                ID: {opp.typeId} • Stop: {item.stationName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={`https://evetycoon.com/market/${opp.typeId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-medium transition"
            >
              <span>EVE Tycoon</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close popup"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Plan Pick Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-black/30 rounded-xl p-2.5 border border-white/5 tabular-nums">
          <div>
            <div className="text-[10px] text-slate-400">Plan Qty / Vol</div>
            <div className="font-semibold text-white">
              {formatInt(item.qty)}x • {formatVolume(item.totalVolume)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Buy Cost</div>
            <div className="font-semibold text-slate-200">
              {formatISK(item.totalCost, true)} ISK
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Net Profit</div>
            <div className="font-bold text-emerald-400">
              +{formatISK(item.totalProfit, true)} ISK
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">ROI / Unit</div>
            <div className="font-semibold text-cyan-300">
              +{item.roiPct.toFixed(1)}% ({formatISK(opp.profitPerUnit, true)})
            </div>
          </div>
        </div>

        {/* Compact 2-Column Order Book */}
        <OrderBookGrid
          opp={opp}
          buyMethod={buyMethod}
          tradeMode={tradeMode}
          originSystemFallback={originStation?.systemName}
          destSystemFallback={destStation?.systemName}
          originStats={originStats}
          destStats={destStats}
          maxLevels={4}
        />

        {/* Compact 30-Day History: Origin & Destination */}
        <VolumeComparison
          originLabel={`Origin Volume — ${originRegionName}`}
          destLabel={`Dest Volume — ${destRegionName}`}
          originStats={originStats}
          destStats={destStats}
          loading={historyLoading}
          error={historyError}
          qty={item.qty}
        />
      </div>
    </div>
  );
}
