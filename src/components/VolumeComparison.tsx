import { formatISK, formatInt } from '../utils/arbitrage';
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
        {stats && !loading && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
              stats.avg7d >= Math.max(20, qty * 1.5)
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : stats.avg7d >= Math.max(5, qty * 0.5)
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : stats.avg7d >= 1
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
            }`}
          >
            {stats.avg7d >= Math.max(20, qty * 1.5)
              ? 'High'
              : stats.avg7d >= Math.max(5, qty * 0.5)
              ? 'Good'
              : stats.avg7d >= 1
              ? 'Moderate'
              : 'Low (<1/d)'}
          </span>
        )}
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-400 py-1">Loading 30d history...</div>
      ) : error ? (
        <div className="text-[11px] text-rose-400 py-1">{error}</div>
      ) : stats ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
            <div>
              <div className="text-[10px] text-slate-500">7d Avg/d</div>
              <div className="font-bold text-white">{stats.avg7d.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">30d Avg/d</div>
              <div className="font-bold text-slate-200">{stats.avg30d.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Region Avg</div>
              <div className="font-bold text-cyan-300">
                {stats.lastAvgPrice !== null ? formatISK(stats.lastAvgPrice, true) : 'N/A'}
              </div>
            </div>
          </div>
          <div className="h-8 flex items-end gap-0.5">
            {(() => {
              const maxVol = Math.max(1, ...stats.last14Days.map((d) => d.volume));
              return stats.last14Days.map((d) => {
                const hPct = Math.max(8, Math.round((d.volume / maxVol) * 100));
                return (
                  <div
                    key={d.date}
                    title={`${d.date}: ${formatInt(d.volume)} units (Avg ${formatISK(d.average, true)})`}
                    className="flex-1 bg-cyan-500/35 hover:bg-cyan-400/80 rounded-t transition-all"
                    style={{ height: `${d.volume === 0 ? 8 : hPct}%` }}
                  />
                );
              });
            })()}
          </div>
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
