import { classifyBookLiquidity, formatISK, formatInt, type LiquidityRank } from '../utils/arbitrage';
import type { DailyVolumeStats } from '../utils/history';

interface VolumeComparisonProps {
  originLabel: string;
  destLabel: string;
  originStats: DailyVolumeStats | null;
  destStats: DailyVolumeStats | null;
  loading: boolean;
  error: string | null;
  qty: number;
}

function VolumeCard({
  label,
  stats,
  loading,
  error,
  qty,
}: {
  label: string;
  stats: DailyVolumeStats | null;
  loading: boolean;
  error: string | null;
  qty: number;
}) {
  return (
    <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-slate-200 truncate">{label}</span>
        {stats && !loading && (() => {
          const rank: LiquidityRank = classifyBookLiquidity(
            stats.avg7d,
            0,
            0,
            qty,
            false,
            stats.trendPct,
            stats.activeDays7d
          );
          const badgeStyle =
            rank === 'High'
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : rank === 'Good'
              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
              : rank === 'Moderate'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
          return (
            <span
              title="Region liquidity using 14d Avg/d + Trend % (unified with table)"
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badgeStyle}`}
            >
              {rank === 'Low' && stats.avg7d < 1 ? 'Low (<1/d)' : rank}
            </span>
          );
        })()}
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-400 py-1">Loading 30d history...</div>
      ) : error ? (
        <div className="text-[11px] text-rose-400 py-1">{error}</div>
      ) : stats ? (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2 text-[11px] tabular-nums">
            <div>
              <div className="text-[10px] text-slate-500">14d Avg/d</div>
              <div className="font-bold text-white flex items-center gap-1 flex-wrap">
                <span>{stats.avg7d.toFixed(1)}</span>
                {stats.trendPct !== null && (
                  <span
                    title={`14d vs 30d (${stats.avg30d.toFixed(1)}/d)`}
                    className={`text-[9px] font-semibold ${
                      stats.trendPct >= 10
                        ? 'text-emerald-400'
                        : stats.trendPct <= -10
                        ? 'text-rose-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {stats.trendPct >= 0 ? `+${stats.trendPct.toFixed(0)}%↑` : `${stats.trendPct.toFixed(0)}%↓`}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Active (14d)</div>
              <div
                className={`font-bold ${
                  stats.activeDays7d >= 10
                    ? 'text-emerald-400'
                    : stats.activeDays7d >= 4
                    ? 'text-amber-300'
                    : 'text-rose-400'
                }`}
              >
                {stats.activeDays7d}/14d
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">ISK Vol/d</div>
              <div className="font-bold text-cyan-300">
                {stats.iskVol7d > 0 ? formatISK(stats.iskVol7d, true) : '0'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Avg Price (1d)</div>
              <div
                title={
                  stats.lastAvgPrice
                    ? `${formatISK(stats.lastAvgPrice)} ISK${stats.lastTradeDate ? ` (${stats.lastTradeDate})` : ''}`
                    : undefined
                }
                className={`font-bold ${
                  stats.lastAvgPrice !== null && stats.lastAvgPrice > 0
                    ? 'text-amber-300'
                    : 'text-slate-500'
                }`}
              >
                {stats.lastAvgPrice !== null && stats.lastAvgPrice > 0
                  ? formatISK(stats.lastAvgPrice, true)
                  : '—'}
              </div>
            </div>
          </div>

          {(() => {
            const maxVol = Math.max(1, ...stats.last14Days.map((d) => d.volume));
            return (
              <div className="space-y-1">
                <div className="h-8 flex items-end gap-0.5">
                  {stats.last14Days.map((d, idx) => {
                    const isLast = idx === stats.last14Days.length - 1;
                    const hPct = Math.max(10, Math.round((d.volume / maxVol) * 100));
                    const barColor =
                      d.volume === 0
                        ? 'bg-slate-800/80 hover:bg-slate-700'
                        : isLast
                        ? 'bg-emerald-400/75 hover:bg-emerald-300'
                        : 'bg-cyan-500/45 hover:bg-cyan-400/85';
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${formatInt(d.volume)} units (Avg ${formatISK(d.average, true)})`}
                        className={`flex-1 rounded-t transition-all ${barColor}`}
                        style={{ height: `${d.volume === 0 ? 10 : hPct}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[9px] text-slate-500 tabular-nums">
                  <span>14d ago</span>
                  <span>Peak: {formatInt(Math.max(0, ...stats.last14Days.map((d) => d.volume)))}/d</span>
                  <span>Today</span>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 py-1">No region history</div>
      )}
    </div>
  );
}

export function VolumeComparison({
  originLabel,
  destLabel,
  originStats,
  destStats,
  loading,
  error,
  qty,
}: VolumeComparisonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <VolumeCard
        label={originLabel}
        stats={originStats}
        loading={loading}
        error={error}
        qty={qty}
      />
      <VolumeCard
        label={destLabel}
        stats={destStats}
        loading={loading}
        error={error}
        qty={qty}
      />
    </div>
  );
}
