import { Bookmark, BookmarkCheck, Check, Copy, Loader2, Sparkles } from 'lucide-react';
import type React from 'react';
import { formatISK, formatInt } from '../utils/arbitrage';
import type { TradeTheme } from '../utils/theme';
import type { TripItemPick, TripPlan } from '../utils/tripPlanner';

interface TripPlansPanelProps {
  theme: TradeTheme;
  tripPlans: TripPlan[] | null;
  maxStops: number;
  disabled: boolean;
  verifying?: boolean;
  justSavedPlanId: string | null;
  copiedStationKey: string | null;
  copiedId: number | null;
  isDestAll?: boolean;
  originStationName?: string | null;
  onGenerate: () => void;
  onHide: () => void;
  onSetMaxStops: (n: number) => void;
  onSavePlan: (plan: TripPlan) => void;
  onCopyStation: (e: React.MouseEvent, key: string, stationName: string) => void;
  onCopyName: (e: React.MouseEvent, typeId: number, name: string) => void;
  onSelectItem: (item: TripItemPick) => void;
}

export function TripPlansPanel({
  theme,
  tripPlans,
  maxStops,
  disabled,
  verifying = false,
  justSavedPlanId,
  copiedStationKey,
  copiedId,
  isDestAll = false,
  originStationName = null,
  onGenerate,
  onHide,
  onSetMaxStops,
  onSavePlan,
  onCopyStation,
  onCopyName,
  onSelectItem,
}: TripPlansPanelProps) {
  return (
    <>
      {/* Auto-Fill Ship (5 Trip Plans) Bar */}
      <div className={`px-4 sm:px-5 py-3 border-b ${theme.sectionHead} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={disabled || verifying}
            onClick={onGenerate}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
              verifying
                ? 'border-slate-600 bg-slate-700 text-slate-200 cursor-not-allowed'
                : disabled
                ? 'border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                : `${theme.pillActive} cursor-pointer`
            }`}
          >
            {verifying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{verifying ? 'Waiting...' : 'Auto Trip Plans (Top 5 • ISK/Jump)'}</span>
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

      {/* 5 Generated Trip Plans Grid */}
      {tripPlans && (
        <div className={`relative p-3 sm:p-4 border-b ${theme.sectionHead}`}>
          {verifying && (
            <div className="absolute inset-0 z-10 bg-[#070b14]/70 backdrop-blur-[2px] flex items-center justify-center p-4">
              <div className="rounded-xl border border-cyan-500/35 bg-[#0b1120]/95 px-4 py-3 shadow-2xl flex items-center gap-2.5 text-xs text-slate-100 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                <span>Checking latest market prices (ESI)...</span>
              </div>
            </div>
          )}
          {tripPlans.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-4">
              Could not build trip plans with current filters. Try relaxing Min ROI or Min Profit.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {tripPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-xl border p-3 flex flex-col gap-2.5 min-w-0 ${theme.subCard}`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-white truncate">{plan.title}</span>
                        <button
                          type="button"
                          onClick={() => onSavePlan(plan)}
                          title="Save to My Plan"
                          className="p-0.5 text-slate-500 hover:text-cyan-300 cursor-pointer shrink-0 transition"
                        >
                          {justSavedPlanId === plan.id ? (
                            <BookmarkCheck className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Bookmark className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{plan.subtitle}</div>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${theme.pillActive}`}>
                      Score {plan.avgScore}
                    </span>
                  </div>

                  {/* Plan KPIs */}
                  {(() => {
                    const roiOnUsedPct = plan.totalCost > 0 ? (plan.totalProfit / plan.totalCost) * 100 : 0;
                    const profitColor =
                      roiOnUsedPct >= 200
                        ? 'text-rose-400'
                        : roiOnUsedPct >= 100
                        ? 'text-amber-400'
                        : roiOnUsedPct >= 40
                        ? 'text-emerald-400'
                        : roiOnUsedPct >= 15
                        ? 'text-cyan-300'
                        : 'text-slate-300';
                    return (
                      <div className="grid grid-cols-3 gap-1.5 text-[11px] bg-black/25 rounded-lg p-2 border border-white/5 tabular-nums">
                        <div title={`ROI on actual budget used: ${roiOnUsedPct.toFixed(1)}%`}>
                          <div className="text-[10px] text-slate-400">Net Profit</div>
                          <div className={`font-bold ${profitColor}`}>
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
                    );
                  })()}

                  {/* Stops & Items */}
                  <div className="space-y-2.5 text-xs flex-1">
                    {isDestAll && originStationName && (
                      <div className="rounded px-2 py-1.5 border bg-emerald-500/10 border-emerald-500/25 flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-medium text-emerald-200 bg-emerald-500/15 border border-emerald-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
                            0j
                          </span>
                          <span title={originStationName} className="font-medium text-emerald-100 truncate">
                            {originStationName}
                          </span>
                          <button
                            type="button"
                            onClick={(e) =>
                              onCopyStation(e, `plan:${plan.id}:orig`, originStationName)
                            }
                            title="Copy station name"
                            className="p-0.5 text-slate-400 hover:text-white cursor-pointer shrink-0"
                          >
                            {copiedStationKey === `plan:${plan.id}:orig` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                    {plan.stops.map((stop) => (
                      <div
                        key={stop.stationId}
                        className="rounded-lg bg-black/20 border border-white/5 p-2.5 space-y-1.5"
                      >
                        <div
                          className={`rounded px-2 py-1.5 border flex items-center justify-between gap-1.5 ${
                            isDestAll
                              ? 'bg-rose-500/10 border-rose-500/25'
                              : 'bg-emerald-500/10 border-emerald-500/25'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                title="Jumps from previous point"
                                className="text-[10px] font-medium text-slate-300 bg-slate-800/70 border border-slate-700 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                              >
                                +{stop.jumpsFromPrev}j
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
                  </div>

                  {plan.finalDestName && (
                    <div className="mt-auto flex items-center justify-between gap-1.5 text-[11px] px-2.5 py-1.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-200">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          title="Jumps to final destination"
                          className="text-[10px] font-medium text-rose-200 bg-rose-500/15 border border-rose-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                        >
                          +{plan.jumpsToFinalDest}j
                        </span>
                        <span title={plan.finalDestName} className="font-medium text-rose-100 truncate">
                          {plan.finalDestName}
                        </span>
                        <button
                          type="button"
                          onClick={(e) =>
                            onCopyStation(e, `plan:${plan.id}:dest`, plan.finalDestName!)
                          }
                          title="Copy station name"
                          className="p-0.5 text-rose-300/70 hover:text-white cursor-pointer shrink-0"
                        >
                          {copiedStationKey === `plan:${plan.id}:dest` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
