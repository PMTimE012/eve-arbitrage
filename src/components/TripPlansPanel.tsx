import { Check, Copy, Skull, Sparkles } from 'lucide-react';
import type React from 'react';
import { formatISK, formatInt } from '../utils/arbitrage';
import type { TradeTheme } from '../utils/theme';
import type { TripItemPick, TripPlan } from '../utils/tripPlanner';

interface TripPlansPanelProps {
  theme: TradeTheme;
  tripPlans: TripPlan[] | null;
  maxStops: number;
  disabled: boolean;
  copiedPlanId: string | null;
  copiedStationKey: string | null;
  copiedId: number | null;
  onGenerate: () => void;
  onHide: () => void;
  onSetMaxStops: (n: number) => void;
  onCopyPlan: (plan: TripPlan) => void;
  onCopyStation: (e: React.MouseEvent, key: string, stationName: string) => void;
  onCopyName: (e: React.MouseEvent, typeId: number, name: string) => void;
  onSelectItem: (item: TripItemPick) => void;
}

export function TripPlansPanel({
  theme,
  tripPlans,
  maxStops,
  disabled,
  copiedPlanId,
  copiedStationKey,
  copiedId,
  onGenerate,
  onHide,
  onSetMaxStops,
  onCopyPlan,
  onCopyStation,
  onCopyName,
  onSelectItem,
}: TripPlansPanelProps) {
  return (
    <>
      {/* Auto-Fill Ship (3 Trip Plans) Bar */}
      <div className={`px-4 sm:px-5 py-3 border-b ${theme.sectionHead} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onGenerate}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${theme.pillActive}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Fill Ship (Generate 3 Plans)</span>
          </button>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400">Max Stops:</span>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onSetMaxStops(n)}
                className={`w-6 h-6 rounded text-xs font-semibold border transition cursor-pointer ${
                  maxStops === n ? theme.pillActive : theme.pillInactive
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {tripPlans && (
          <button
            type="button"
            onClick={onHide}
            className="text-xs text-slate-400 hover:text-white cursor-pointer"
          >
            Hide Plans
          </button>
        )}
      </div>

      {/* 3 Generated Trip Plans Grid */}
      {tripPlans && (
        <div className={`p-4 sm:p-5 border-b ${theme.sectionHead}`}>
          {tripPlans.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-4">
              Could not build trip plans with current filters. Try relaxing Min ROI or Min Profit.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {tripPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-xl border p-4 flex flex-col gap-3 ${theme.subCard}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white truncate">{plan.title}</span>
                        <button
                          type="button"
                          onClick={() => onCopyPlan(plan)}
                          title="Copy full plan details"
                          className="p-0.5 text-slate-500 hover:text-white cursor-pointer shrink-0 transition"
                        >
                          {copiedPlanId === plan.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-[11px] text-slate-400">{plan.subtitle}</div>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 ${theme.pillActive}`}>
                      Avg Score {plan.avgScore}
                    </span>
                  </div>

                  {/* Plan KPIs */}
                  <div className="grid grid-cols-3 gap-2 text-xs bg-black/25 rounded-lg p-2.5 border border-white/5 tabular-nums">
                    <div>
                      <div className="text-[10px] text-slate-400">Net Profit</div>
                      <div className="font-bold text-emerald-400">
                        +{formatISK(plan.totalProfit, true)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Route / ISK·j</div>
                      <div className="font-semibold text-white">
                        {plan.totalJumps}j • {formatISK(plan.iskPerJump, true)}/j
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Cargo / Budget</div>
                      <div className="font-semibold text-slate-200">
                        {plan.cargoFillPct !== null ? `${plan.cargoFillPct.toFixed(0)}%` : '∞'} /{' '}
                        {plan.budgetUsedPct !== null ? `${plan.budgetUsedPct.toFixed(0)}%` : '∞'}
                      </div>
                    </div>
                  </div>

                  {/* Route Safety / 1h Ship Kills along full path */}
                  <div
                    className={`flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg border tabular-nums ${
                      plan.routeShipKills1h >= 15
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : plan.routeShipKills1h >= 3
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Skull className="w-3.5 h-3.5 shrink-0" />
                      <span>Route Kills (1h): {formatInt(plan.routeShipKills1h)} ships</span>
                    </span>
                    {plan.hottestSystem && (
                      <span className="text-[10px] opacity-85 truncate max-w-[140px]">
                        Hot: {plan.hottestSystem.name} ({plan.hottestSystem.kills})
                      </span>
                    )}
                  </div>

                  {/* Stops & Items */}
                  <div className="space-y-2.5 text-xs flex-1">
                    {plan.stops.map((stop) => (
                      <div
                        key={stop.stationId}
                        className="rounded-lg bg-black/20 border border-white/5 p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              title="Jumps from previous point"
                              className="text-[10px] font-medium text-slate-300 bg-slate-800/70 border border-slate-700 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                            >
                              {stop.jumpsFromPrev}j
                            </span>
                            {stop.security !== null && (
                              <span
                                title={`Security Status: ${stop.security.toFixed(2)}`}
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 tabular-nums ${
                                  stop.security >= 0.45
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : stop.security > 0
                                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                    : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                }`}
                              >
                                {stop.security.toFixed(1)}
                              </span>
                            )}
                            <span
                              title={stop.stationName}
                              className="font-medium text-white truncate"
                            >
                              {stop.stationName}
                            </span>
                            <button
                              type="button"
                              onClick={(e) =>
                                onCopyStation(
                                  e,
                                  `plan:${plan.id}:${stop.stationId}`,
                                  stop.stationName
                                )
                              }
                              title="Copy station name"
                              className="p-0.5 text-slate-500 hover:text-white cursor-pointer shrink-0"
                            >
                              {copiedStationKey === `plan:${plan.id}:${stop.stationId}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1 pl-1">
                          {stop.items.map((it) => (
                            <div
                              key={it.typeId}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-slate-300 font-semibold shrink-0 tabular-nums">
                                  {formatInt(it.qty)}x
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onSelectItem(it)}
                                  title={`View details for ${it.name}`}
                                  className="text-slate-200 hover:text-cyan-300 hover:underline truncate text-left cursor-pointer transition"
                                >
                                  {it.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => onCopyName(e, it.typeId, it.name)}
                                  title="Copy item name"
                                  className="p-0.5 text-slate-500 hover:text-white cursor-pointer shrink-0"
                                >
                                  {copiedId === it.typeId ? (
                                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-2.5 h-2.5" />
                                  )}
                                </button>
                              </div>
                              <span className="text-emerald-400 font-medium shrink-0 tabular-nums">
                                +{formatISK(it.totalProfit, true)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {plan.finalDestName && (
                      <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
                        <span className="truncate font-medium">
                          → Deliver to {plan.finalDestName}
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold">
                          +{plan.jumpsToFinalDest}j
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
