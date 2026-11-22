import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Navigation,
  Package,
  RefreshCw,
  Trash2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArbitrageOpportunity,
  EmpireInstantDataset,
  HubBook,
  MarketDataset,
  StationOption,
  SystemActivity,
  UniverseStationsData,
} from '../types';
import { formatISK, formatInt, formatStationForCopy, formatVolume } from '../utils/arbitrage';
import { fetchLiveBooksForPlanItems, loadStationMarketBook } from '../utils/esiClient';
import { fetchDestDailyVolume, type DailyVolumeStats } from '../utils/history';
import { getSystemJumpMap, type RoutePreference } from '../utils/routing';
import {
  buildEnRouteApproachLeg,
  evaluateSavedPlanItem,
  type LiveItemStatus,
  type SavedPlanItem,
  type SavedTripPlan,
} from '../utils/savedPlans';
import { getTradeTheme } from '../utils/theme';
import { ItemImage } from './ItemImage';
import { OrderBookGrid } from './OrderBookGrid';
import { RouteMap2D } from './RouteMap2D';
import { StationSelector } from './StationSelector';
import { VolumeComparison } from './VolumeComparison';

const CURRENT_STATION_KEY = 'eve_arbitrage_current_station_v1';

function calcOrderBookTotal(
  levels: [number, number][] | undefined,
  qty: number,
  fallbackUnit: number
): number {
  if (!levels || levels.length === 0) return fallbackUnit * qty;
  let rem = qty;
  let total = 0;
  let lastPrice = fallbackUnit;
  for (const [price, vol] of levels) {
    if (rem <= 0) break;
    const take = Math.min(rem, vol);
    total += take * price;
    rem -= take;
    lastPrice = price;
  }
  if (rem > 0) total += rem * lastPrice;
  return total;
}

function formatRelativeAgo(ts: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ts) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
}

function renderSecBadge(sec: number | null) {
  if (sec === null) return null;
  return (
    <span
      title={`Security Status: ${sec.toFixed(2)}`}
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 tabular-nums ${
        sec >= 0.45
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          : sec > 0
          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      }`}
    >
      {sec.toFixed(1)}
    </span>
  );
}

function renderStopMetricsBar(
  iskPerJump: number,
  cost: number,
  volume: number,
  maxBudget: number,
  maxCargo: number
) {
  const cargoPct = maxCargo > 0 ? Math.min(100, Math.round((volume / maxCargo) * 100)) : null;
  const budgetPct = maxBudget > 0 ? Math.min(100, Math.round((cost / maxBudget) * 100)) : null;
  return (
    <div className="flex flex-wrap items-center gap-5 px-1 pt-0.5 text-[11px] tabular-nums">
      <span className="text-emerald-400 font-bold shrink-0">
        {formatISK(iskPerJump, true)}/j
      </span>
      <div className="space-y-1 min-w-[140px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Cargo</span>
          <span className="text-cyan-300 font-semibold">
            {formatVolume(volume)}
            {cargoPct !== null && <span className="text-slate-400"> ({cargoPct}%)</span>}
          </span>
        </div>
        {cargoPct !== null && (
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${cargoPct}%` }}
            />
          </div>
        )}
      </div>
      <div className="space-y-1 min-w-[140px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400">Budget</span>
          <span className="text-emerald-300 font-semibold">
            {formatISK(cost, true)}
            {budgetPct !== null && <span className="text-slate-400"> ({budgetPct}%)</span>}
          </span>
        </div>
        {budgetPct !== null && (
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface MyPlansModalProps {
  open: boolean;
  plans: SavedTripPlan[];
  dataset: MarketDataset | null;
  empireData: EmpireInstantDataset | null;
  universe: UniverseStationsData | null;
  activityMap: Record<number, SystemActivity>;
  routePref: RoutePreference;
  maxBudget: number;
  maxCargo: number;
  sessionBooks?: Record<number, Record<string, HubBook>>;
  onClose: () => void;
  onDeletePlan: (uid: string) => void;
  onUpdatePlan: (plan: SavedTripPlan) => void;
  onClearAll: () => void;
}

const STATUS_BADGE: Record<LiveItemStatus, { label: string; cls: string }> = {
  active: {
    label: 'Active',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  changed: {
    label: 'Changed',
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  unprofitable: {
    label: 'Loss',
    cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  },
  missing_origin: {
    label: 'Orig Gone',
    cls: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
  },
  missing_dest: {
    label: 'Dest Gone',
    cls: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
  },
  missing_both: {
    label: 'Gone',
    cls: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
  },
};

export function MyPlansModal({
  open,
  plans,
  dataset,
  empireData,
  universe,
  activityMap,
  routePref,
  maxBudget,
  maxCargo,
  sessionBooks,
  onClose,
  onDeletePlan,
  onUpdatePlan,
  onClearAll,
}: MyPlansModalProps) {
  const theme = useMemo(() => getTradeTheme('instant', 'instant', 'lp'), []);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const [liveBooks, setLiveBooks] = useState<Record<number, Record<string, HubBook>>>({});
  const mergedLiveBooks = useMemo(() => {
    const out: Record<number, Record<string, HubBook>> = {};
    if (sessionBooks) {
      for (const [sidStr, bk] of Object.entries(sessionBooks)) {
        out[Number(sidStr)] = { ...bk };
      }
    }
    for (const [sidStr, bk] of Object.entries(liveBooks)) {
      const sid = Number(sidStr);
      out[sid] = { ...(out[sid] ?? {}), ...bk };
    }
    return out;
  }, [sessionBooks, liveBooks]);
  const [refreshing, setRefreshing] = useState(false);
  const [fillingApproach, setFillingApproach] = useState(false);
  const [approachCooldownSec, setApproachCooldownSec] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [approachMsg, setApproachMsg] = useState<string | null>(null);
  const [itemOrigStats, setItemOrigStats] = useState<DailyVolumeStats | null>(null);
  const [itemDestStats, setItemDestStats] = useState<DailyVolumeStats | null>(null);
  const [itemHistLoading, setItemHistLoading] = useState(false);
  const [itemHistError, setItemHistError] = useState<string | null>(null);
  const [currentStation, setCurrentStation] = useState<StationOption | null>(() => {
    try {
      const raw = localStorage.getItem(CURRENT_STATION_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as StationOption;
    } catch {
      return null;
    }
  });

  const handleSelectCurrentStation = (st: StationOption) => {
    setCurrentStation(st);
    setApproachMsg(null);
    try {
      localStorage.setItem(CURRENT_STATION_KEY, JSON.stringify(st));
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleFillApproach = async () => {
    if (!activePlan || !currentStation || !dataset || fillingApproach || approachCooldownSec > 0) return;
    setApproachMsg(null);
    setFillingApproach(true);
    try {
      let nextBooks = mergedLiveBooks;
      const oriStop = activePlan.stops[0];
      if (universe && oriStop) {
        const curMap = getSystemJumpMap(currentStation.systemId, universe, routePref);
        const directJ =
          currentStation.systemId === oriStop.systemId
            ? 0
            : curMap?.get(oriStop.systemId);
        const stationsToFetch: StationOption[] = [];
        const seenIds = new Set<number>();

        const addIfNeeded = (st: StationOption | null) => {
          if (!st || st.stationId <= 0 || seenIds.has(st.stationId)) return;
          seenIds.add(st.stationId);
          if (!mergedLiveBooks[st.stationId]) {
            stationsToFetch.push(st);
          }
        };

        addIfNeeded(currentStation);
        const oriMeta =
          dataset.topStations.find((s) => s.stationId === oriStop.stationId) ??
          dataset.fwStations?.find((s) => s.stationId === oriStop.stationId);
        if (oriMeta) {
          addIfNeeded({
            stationId: oriMeta.stationId,
            stationName: oriMeta.stationName,
            systemId: oriMeta.systemId,
            systemName: oriMeta.systemName,
            regionId: oriMeta.regionId,
            regionName: oriMeta.regionName,
            security: oriMeta.security,
            hubKey: 'hubKey' in oriMeta ? (oriMeta.hubKey as string | null) : null,
          });
        }

        if (directJ !== undefined) {
          for (const st of dataset.topStations) {
            if (stationsToFetch.length >= 6) break;
            const jCur =
              st.systemId === currentStation.systemId ? 0 : curMap?.get(st.systemId);
            if (jCur === undefined) continue;
            const jOri =
              st.systemId === oriStop.systemId
                ? 0
                : getSystemJumpMap(st.systemId, universe, routePref)?.get(oriStop.systemId);
            if (jOri === undefined) continue;
            if (jCur + jOri - directJ <= 3) {
              addIfNeeded({
                stationId: st.stationId,
                stationName: st.stationName,
                systemId: st.systemId,
                systemName: st.systemName,
                regionId: st.regionId,
                regionName: st.regionName,
                security: st.security,
                hubKey: st.hubKey,
              });
            }
          }
        }

        if (stationsToFetch.length > 0) {
          const updates: Record<number, Record<string, HubBook>> = {};
          await Promise.all(
            stationsToFetch.map(async (st) => {
              try {
                const book = await loadStationMarketBook(st, dataset, undefined, false);
                updates[st.stationId] = book;
              } catch {
                // Keep snapshot fallback if ESI fails for a station
              }
            })
          );
          if (Object.keys(updates).length > 0) {
            setLiveBooks((prev) => ({ ...prev, ...updates }));
            nextBooks = { ...mergedLiveBooks, ...updates };
          }
        }
      }

      const res = buildEnRouteApproachLeg(
        activePlan,
        currentStation,
        dataset,
        empireData,
        universe,
        routePref,
        maxBudget,
        maxCargo,
        nextBooks
      );
      if (!res.approach) {
        setApproachMsg(res.reason ?? 'No profitable en-route trades found.');
        return;
      }
      onUpdatePlan({ ...activePlan, approach: res.approach });
    } finally {
      setFillingApproach(false);
      setApproachCooldownSec(2);
    }
  };

  useEffect(() => {
    if (approachCooldownSec <= 0) return;
    const id = setTimeout(() => {
      setApproachCooldownSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(id);
  }, [approachCooldownSec]);

  const handleClearApproach = () => {
    if (!activePlan) return;
    setApproachMsg(null);
    onUpdatePlan({ ...activePlan, approach: undefined });
  };

  useEffect(() => {
    if (!open || lastRefreshedAt === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, [open, lastRefreshedAt]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const activePlan = useMemo(
    () => plans.find((p) => p.uid === selectedUid) ?? plans[0] ?? null,
    [plans, selectedUid]
  );

  const resolveStationMeta = useCallback(
    (stationId: number, fallbackRegionId?: number) => {
      const fromTop = dataset?.topStations.find((s) => s.stationId === stationId);
      if (fromTop) return { regionId: fromTop.regionId, regionName: fromTop.regionName, systemName: fromTop.systemName };
      const fromFw = dataset?.fwStations?.find((s) => s.stationId === stationId);
      if (fromFw) return { regionId: fromFw.regionId, regionName: fromFw.regionName, systemName: fromFw.systemName };
      const fromEmp = empireData?.stations[String(stationId)];
      if (fromEmp) return { regionId: fromEmp.regionId, regionName: fromEmp.regionName, systemName: fromEmp.systemName };
      if (universe) {
        const st = universe.stations.find((s) => s[0] === stationId);
        if (st) {
          const sys = universe.systems[String(st[2])];
          if (sys) {
            return {
              regionId: sys[1],
              regionName: universe.regions[String(sys[1])] ?? '',
              systemName: sys[0],
            };
          }
        }
      }
      return {
        regionId: fallbackRegionId ?? 0,
        regionName: fallbackRegionId && universe ? (universe.regions[String(fallbackRegionId)] ?? '') : '',
        systemName: '',
      };
    },
    [dataset, empireData, universe]
  );

  const expandedItemInfo = useMemo(() => {
    if (!activePlan || !expandedItemKey) return null;
    if (activePlan.approach) {
      for (const it of activePlan.approach.items) {
        if (`${activePlan.uid}:app:${it.typeId}` === expandedItemKey) {
          return {
            item: it,
            origMeta: resolveStationMeta(it.originStationId, it.originRegionId),
            destMeta: resolveStationMeta(it.destStationId, it.destRegionId),
          };
        }
      }
    }
    for (const stop of activePlan.stops) {
      for (const it of stop.items) {
        if (`${activePlan.uid}:${stop.stationId}:${it.typeId}` === expandedItemKey) {
          return {
            item: it,
            origMeta: resolveStationMeta(it.originStationId, it.originRegionId),
            destMeta: resolveStationMeta(it.destStationId, it.destRegionId),
          };
        }
      }
    }
    return null;
  }, [activePlan, expandedItemKey, resolveStationMeta]);

  useEffect(() => {
    if (!expandedItemInfo) {
      setItemOrigStats(null);
      setItemDestStats(null);
      setItemHistError(null);
      return;
    }
    const origReg = expandedItemInfo.origMeta.regionId;
    const destReg = expandedItemInfo.destMeta.regionId;
    const hasOrig = origReg > 0;
    const hasDest = destReg > 0;
    if (!hasOrig && !hasDest) {
      setItemOrigStats(null);
      setItemDestStats(null);
      return;
    }

    let cancelled = false;
    setItemHistLoading(true);
    setItemHistError(null);
    Promise.all([
      hasOrig ? fetchDestDailyVolume(origReg, expandedItemInfo.item.typeId) : Promise.resolve(null),
      hasDest
        ? destReg === origReg
          ? Promise.resolve(null)
          : fetchDestDailyVolume(destReg, expandedItemInfo.item.typeId)
        : Promise.resolve(null),
    ])
      .then(([origStats, destStats]) => {
        if (!cancelled) {
          setItemOrigStats(origStats);
          setItemDestStats(destReg === origReg ? origStats : destStats);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItemHistError(err instanceof Error ? err.message : 'Failed to load history');
        }
      })
      .finally(() => {
        if (!cancelled) setItemHistLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expandedItemInfo]);

  const planSummaries = useMemo(() => {
    return plans.map((plan) => {
      let liveProfit = 0;
      let missingCount = 0;
      let changedCount = 0;
      for (const stop of plan.stops) {
        for (const item of stop.items) {
          const ev = evaluateSavedPlanItem(item, plan, dataset, empireData, mergedLiveBooks);
          liveProfit += ev.liveProfit;
          if (
            ev.status === 'missing_origin' ||
            ev.status === 'missing_dest' ||
            ev.status === 'missing_both' ||
            ev.status === 'unprofitable'
          ) {
            missingCount++;
          } else if (ev.status === 'changed') {
            changedCount++;
          }
        }
      }
      return {
        uid: plan.uid,
        liveProfit,
        missingCount,
        changedCount,
      };
    });
  }, [plans, dataset, empireData, mergedLiveBooks]);

  const handleCopy = (text: string, key: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
  };

  const handleCopyStation = (stationName: string, key: string) => {
    handleCopy(formatStationForCopy(stationName), key);
  };

  const handleCopyStationItems = (items: SavedPlanItem[], key: string, mode: 'buy' | 'sell') => {
    const valid = items.filter((it) => it.qty > 0);
    if (valid.length === 0) return;
    const text =
      mode === 'buy'
        ? valid.map((it) => `${it.name}\t${it.qty}`).join('\n')
        : valid
            .map((it) => {
              const unitSell = activePlan
                ? evaluateSavedPlanItem(it, activePlan, dataset, empireData, mergedLiveBooks).liveSellPrice ??
                  it.savedSellPrice
                : it.savedSellPrice;
              return `${it.name}\t${it.qty}\t${formatISK(unitSell)}`;
            })
            .join('\n');
    handleCopy(text, key);
  };

  const renderStationListCopyButton = (items: SavedPlanItem[], key: string, mode: 'buy' | 'sell') => {
    const valid = items.filter((it) => it.qty > 0);
    const validCount = valid.length;
    if (validCount === 0) return null;
    const isCopied = copiedKey === key;
    const label = mode === 'buy' ? 'Multi-Buy' : 'Multi-Sell';
    const totalIsk = valid.reduce((sum, it) => {
      const ev = activePlan
        ? evaluateSavedPlanItem(it, activePlan, dataset, empireData, mergedLiveBooks)
        : null;
      if (mode === 'buy') {
        return sum + calcOrderBookTotal(ev?.origEntry?.s, it.qty, it.savedBuyPrice);
      }
      if (activePlan?.tradeMode === 'instant') {
        return sum + calcOrderBookTotal(ev?.destEntry?.b, it.qty, it.savedSellPrice);
      }
      const unitSell = ev?.liveSellPrice ?? it.savedSellPrice;
      return sum + unitSell * it.qty;
    }, 0);
    const colorCls = isCopied
      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
      : mode === 'buy'
      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20 hover:text-white'
      : 'bg-rose-500/10 border-rose-500/30 text-rose-200 hover:bg-rose-500/20 hover:text-white';
    const title =
      mode === 'buy'
        ? `Copy ${validCount} item${validCount > 1 ? 's' : ''} for EVE Multi-Buy (Item\\tQty)`
        : `Copy ${validCount} item${validCount > 1 ? 's' : ''} to sell here (Item\\tQty\\tTarget Sell Price)`;
    return (
      <>
        <button
          type="button"
          onClick={() => handleCopyStationItems(valid, key, mode)}
          title={title}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer shrink-0 ${colorCls}`}
        >
          {isCopied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
          <span>{isCopied ? 'Copied' : label}</span>
        </button>
        <span
          title={`Expected ${mode === 'buy' ? 'Buy' : 'Sell'} Total: ${formatISK(totalIsk)}`}
          className={`text-[11px] font-semibold tabular-nums shrink-0 ${
            mode === 'buy' ? 'text-emerald-300/90' : 'text-rose-300/90'
          }`}
        >
          {formatISK(totalIsk, true)}
        </span>
      </>
    );
  };

  const handleCopySavedPlan = (plan: SavedTripPlan) => {
    const modeLabel = `${plan.buyMethod === 'order' ? 'Buy Order' : 'Instant Buy'} -> ${
      plan.tradeMode === 'instant' ? 'Instant Sell' : 'Sell Order'
    }`;
    const effCargo = plan.maxCargo ?? maxCargo;
    const effBudget = plan.maxBudget ?? maxBudget;
    const routeLabel = (plan.routePref ?? routePref) === 'highsec' ? 'High-Sec' : 'Shortest';

    const combinedProfit = plan.totalProfit + (plan.approach?.totalProfit ?? 0);
    const combinedJumps = plan.totalJumps + (plan.approach?.totalJumps ?? 0);
    const combinedIskPerJump = combinedProfit / Math.max(1, combinedJumps);

    const lines: string[] = [
      `=== ${plan.title} ===`,
      `Settings: ${modeLabel} | Max Cargo: ${effCargo > 0 ? formatVolume(effCargo) : 'Unlimited'} | Max Budget: ${effBudget > 0 ? `${formatISK(effBudget, true)} ISK` : 'Unlimited'}`,
      `Fees & Route: Tax ${plan.salesTaxPct}% | Broker ${plan.brokerFeePct}% | Route: ${routeLabel} | Saved: ${new Date(plan.savedAt).toLocaleString()}`,
      `Total Summary: +${formatISK(combinedProfit, true)} ISK | ${combinedJumps}j | ${formatISK(combinedIskPerJump, true)}/j`,
    ];

    const formatDiff = (diff: number): string => {
      if (Math.abs(diff) < 0.5) return '0';
      return `${diff >= 0 ? '+' : ''}${formatISK(diff, true)}`;
    };

    const formatItemLine = (it: SavedPlanItem): string => {
      const vol = formatVolume(it.qty * it.unitVolume);
      const base = `  - ${formatInt(it.qty)}x ${it.name} (${vol}) | Buy: ${formatISK(it.savedBuyPrice)} -> Sell: ${formatISK(it.savedSellPrice)} | +${formatISK(it.savedProfit, true)} (${it.savedRoiPct.toFixed(1)}% ROI)`;
      if (!lastRefreshedAt) return base;
      const ev = evaluateSavedPlanItem(it, plan, dataset, empireData, mergedLiveBooks);
      const liveBuyText =
        ev.liveBuyPrice !== null
          ? `${formatISK(ev.liveBuyPrice)} (${formatDiff(ev.liveBuyPrice - it.savedBuyPrice)})`
          : 'Gone';
      const liveSellText =
        ev.liveSellPrice !== null
          ? `${formatISK(ev.liveSellPrice)} (${formatDiff(ev.liveSellPrice - it.savedSellPrice)})`
          : 'Gone';
      return `${base} [Live (${STATUS_BADGE[ev.status].label}): Buy ${liveBuyText} -> Sell ${liveSellText} | Profit ${ev.liveProfit >= 0 ? '+' : ''}${formatISK(ev.liveProfit, true)} (Diff ${formatDiff(ev.profitDiff)})]`;
    };

    if (plan.approach) {
      const a = plan.approach;
      const appCargoPct = effCargo > 0 ? ` (${Math.round((a.totalVolume / effCargo) * 100)}%)` : '';
      const appBudgetPct = effBudget > 0 ? ` (${Math.round((a.totalCost / effBudget) * 100)}%)` : '';
      lines.push('');
      lines.push(`[APPROACH] (${a.totalJumps}j, ${a.detourJumps > 0 ? `+${a.detourJumps}j detour` : 'On-Route'})`);
      if (a.currentStationId !== a.buyStationId) {
        lines.push(
          `  DEPART (0j${a.currentSecurity !== null ? ` | ${a.currentSecurity.toFixed(1)}` : ''}): ${formatStationForCopy(a.currentStationName)}`
        );
      }
      lines.push(
        `  BUY (+${a.jumpsCurToBuy}j${a.buySecurity !== null ? ` | ${a.buySecurity.toFixed(1)}` : ''}): ${formatStationForCopy(a.buyStationName)}`
      );
      lines.push(
        `  Metrics: ${formatISK(a.iskPerJump, true)}/j | Cargo ${formatVolume(a.totalVolume)}${appCargoPct} | Budget ${formatISK(a.totalCost, true)}${appBudgetPct} | +${formatISK(a.totalProfit, true)} ISK`
      );
      for (const it of a.items) {
        lines.push(formatItemLine(it));
      }
      const sameSellOri = a.sellStationId === plan.stops[0]?.stationId;
      lines.push(
        `  SELL (+${a.jumpsBuyToSell}j): ${formatStationForCopy(a.sellStationName)}${
          !sameSellOri ? ` (+${a.jumpsSellToOri}j to Stop #1)` : ''
        }`
      );
    }

    lines.push('');
    lines.push(`[MAIN PLAN] (+${formatISK(plan.totalProfit, true)} ISK | ${plan.totalJumps}j | ${formatISK(plan.iskPerJump, true)}/j)`);
    for (let i = 0; i < plan.stops.length; i++) {
      const s = plan.stops[i];
      const stopCost = s.items.reduce((sum, it) => sum + it.savedCost, 0);
      const stopVol = s.items.reduce((sum, it) => sum + it.qty * it.unitVolume, 0);
      const stopProfit = s.items.reduce((sum, it) => sum + it.savedProfit, 0);
      const stopJumps = Math.max(
        1,
        s.jumpsFromPrev + (i === plan.stops.length - 1 ? plan.jumpsToFinalDest : 0)
      );
      const stopCargoPct = effCargo > 0 ? ` (${Math.round((stopVol / effCargo) * 100)}%)` : '';
      const stopBudgetPct = effBudget > 0 ? ` (${Math.round((stopCost / effBudget) * 100)}%)` : '';

      lines.push(
        `  Stop #${i + 1} (+${s.jumpsFromPrev}j${s.security !== null ? ` | ${s.security.toFixed(1)}` : ''} | BUY): ${formatStationForCopy(s.stationName)}`
      );
      lines.push(
        `  Metrics: ${formatISK(stopProfit / stopJumps, true)}/j | Cargo ${formatVolume(stopVol)}${stopCargoPct} | Budget ${formatISK(stopCost, true)}${stopBudgetPct} | +${formatISK(stopProfit, true)} ISK`
      );
      for (const it of s.items) {
        lines.push(formatItemLine(it));
      }
    }
    if (plan.finalDestName) {
      lines.push(`  SELL (+${plan.jumpsToFinalDest}j): ${formatStationForCopy(plan.finalDestName)}`);
    }
    handleCopy(lines.join('\n'), `plan:${plan.uid}`);
  };

  const refreshingRef = useRef(false);
  const handleRefreshLiveEsi = useCallback(async () => {
    if (plans.length === 0 || !dataset || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const resolveRegionId = (stationId: number, fallbackRegionId?: number): number => {
        if (fallbackRegionId && fallbackRegionId > 0) return fallbackRegionId;
        const known =
          dataset.topStations.find((s) => s.stationId === stationId) ??
          dataset.fwStations?.find((s) => s.stationId === stationId) ??
          empireData?.stations[String(stationId)];
        if (known) return known.regionId;
        if (universe) {
          const st = universe.stations.find((s) => s[0] === stationId);
          if (st) {
            const sys = universe.systems[String(st[2])];
            if (sys) return sys[1];
          }
        }
        return 0;
      };

      const queries: { regionId: number; typeId: number; stationIds: number[] }[] = [];
      const addItem = (it: SavedPlanItem) => {
        const origReg = resolveRegionId(it.originStationId, it.originRegionId);
        const destReg = resolveRegionId(it.destStationId, it.destRegionId);
        if (origReg > 0 && it.originStationId > 0) {
          queries.push({ regionId: origReg, typeId: it.typeId, stationIds: [it.originStationId] });
        }
        if (destReg > 0 && it.destStationId > 0) {
          queries.push({ regionId: destReg, typeId: it.typeId, stationIds: [it.destStationId] });
        }
      };

      for (const plan of plans) {
        if (plan.approach) {
          for (const it of plan.approach.items) addItem(it);
        }
        for (const stop of plan.stops) {
          for (const it of stop.items) addItem(it);
        }
      }

      const updates = await fetchLiveBooksForPlanItems(queries);
      setLiveBooks((prev) => {
        const next = { ...prev };
        for (const [sidStr, bk] of Object.entries(updates)) {
          const sid = Number(sidStr);
          next[sid] = { ...(next[sid] ?? {}), ...bk };
        }
        return next;
      });
      const now = Date.now();
      setLastRefreshedAt(now);
      setNowMs(now);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [plans, dataset, empireData, universe]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current && plans.length > 0 && dataset) {
      void handleRefreshLiveEsi();
    }
    wasOpenRef.current = open;
  }, [open, plans.length, dataset, handleRefreshLiveEsi]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const renderPlanItemRow = (it: SavedPlanItem, rowKey: string) => {
    if (!activePlan) return null;
    const isExpanded = expandedItemKey === rowKey;
    const ev = evaluateSavedPlanItem(it, activePlan, dataset, empireData, mergedLiveBooks);
    const badge = STATUS_BADGE[ev.status];

    return (
      <Fragment key={rowKey}>
        {/* Ultra-compact 1-line item row (click to toggle comparison dropdown) */}
        <div
          onClick={() => setExpandedItemKey(isExpanded ? null : rowKey)}
          className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-white/[0.03] cursor-pointer transition"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <ItemImage
              typeId={it.typeId}
              name={it.name}
              size={32}
              className="w-6 h-6 rounded shrink-0"
            />
            <span className="font-semibold text-slate-100 truncate">
              {formatInt(it.qty)}× {it.name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(it.name, `it:${it.typeId}`);
              }}
              title="Copy item name"
              className="p-0.5 rounded text-slate-500 hover:text-cyan-300 cursor-pointer shrink-0"
            >
              {copiedKey === `it:${it.typeId}` ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
            <span
              className={`font-semibold ${
                ev.liveProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {ev.liveProfit >= 0 ? '+' : ''}
              {formatISK(ev.liveProfit, true)}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
        </div>

        {/* Expanded Comparison Panel (Saved vs Live) */}
        {isExpanded && (
          <div className="px-4 py-2.5 bg-[#070b14] border-t border-slate-800/70 text-[11px] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-slate-300">{it.originStationName}</span>
                <ArrowRight className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate text-emerald-300">{it.destStationName}</span>
                <button
                  type="button"
                  onClick={() => handleCopyStation(it.destStationName, `dst:${rowKey}`)}
                  title="Copy destination station"
                  className="p-0.5 rounded text-slate-500 hover:text-cyan-300 cursor-pointer shrink-0"
                >
                  {copiedKey === `dst:${rowKey}` ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
              <span className="tabular-nums">
                {formatVolume(it.qty * it.unitVolume)} • {it.savedRoiPct.toFixed(1)}% saved ROI
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 tabular-nums">
              <div className="rounded-lg bg-[#090d16]/80 border border-slate-800 px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Buy Price (Origin)</div>
                <div className="text-slate-300">
                  Saved: <strong className="text-slate-100">{formatISK(it.savedBuyPrice)}</strong>
                </div>
                <div className="text-slate-400">
                  Live:{' '}
                  {ev.liveBuyPrice !== null ? (
                    <strong className="text-cyan-300">{formatISK(ev.liveBuyPrice)}</strong>
                  ) : (
                    <span className="text-rose-400">Gone</span>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-[#090d16]/80 border border-slate-800 px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Sell Price (Dest)</div>
                <div className="text-slate-300">
                  Saved: <strong className="text-slate-100">{formatISK(it.savedSellPrice)}</strong>
                </div>
                <div className="text-slate-400">
                  Live:{' '}
                  {ev.liveSellPrice !== null ? (
                    <strong className="text-emerald-300">{formatISK(ev.liveSellPrice)}</strong>
                  ) : (
                    <span className="text-rose-400">Gone</span>
                  )}
                </div>
                <div className="text-slate-400">
                  Available:{' '}
                  <strong className="text-slate-200">{formatInt(ev.liveAvailableQty)}</strong> /{' '}
                  {formatInt(it.qty)}
                </div>
              </div>

              <div className="rounded-lg bg-[#090d16]/80 border border-slate-800 px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Profit Comparison</div>
                <div
                  className={`font-bold ${
                    ev.liveProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  Now: {ev.liveProfit >= 0 ? '+' : ''}
                  {formatISK(ev.liveProfit, true)} ISK
                </div>
                <div className={ev.profitDiff >= 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}>
                  Diff: {ev.profitDiff >= 0 ? '+' : ''}
                  {formatISK(ev.profitDiff, true)} ISK
                </div>
              </div>
            </div>

            {/* Detailed Market Order Book & 30d Daily Volume (matching Arbitrage tab) */}
            {(() => {
              const origMeta = resolveStationMeta(it.originStationId, it.originRegionId);
              const destMeta = resolveStationMeta(it.destStationId, it.destRegionId);
              const buyP = ev.liveBuyPrice ?? it.savedBuyPrice;
              const sellP = ev.liveSellPrice ?? it.savedSellPrice;
              const unitProfit = sellP - buyP;
              const opp: ArbitrageOpportunity = {
                typeId: it.typeId,
                name: it.name,
                unitVolume: it.unitVolume,
                buyPrice: buyP,
                sellPrice: sellP,
                profitPerUnit: unitProfit,
                roiPct: it.savedRoiPct,
                profitPerM3: it.unitVolume > 0 ? unitProfit / it.unitVolume : 0,
                recommendedQty: it.qty,
                totalCost: buyP * it.qty,
                budgetUsedPct: null,
                totalRevenueAfterTax: sellP * it.qty,
                totalVolume: it.qty * it.unitVolume,
                cargoFillPct: null,
                totalProfit: ev.liveProfit,
                tradeScore: it.savedScore,
                scoreLabel:
                  it.savedScore >= 75
                    ? 'High'
                    : it.savedScore >= 55
                    ? 'Good'
                    : it.savedScore >= 35
                    ? 'Moderate'
                    : 'Risky',
                liquidityLabel: 'Moderate',
                avg7d: null,
                originSellVol: ev.origEntry?.sv ?? 0,
                originBuyVol: ev.origEntry?.bv ?? 0,
                destBuyVol: ev.destEntry?.bv ?? 0,
                destSellVol: ev.destEntry?.sv ?? 0,
                originSells: ev.origEntry?.s ?? [],
                originBuys: ev.origEntry?.b ?? [],
                destBuys: ev.destEntry?.b ?? [],
                destSells: ev.destEntry?.s ?? [],
                originStationId: it.originStationId,
                originStationName: it.originStationName,
                originRegionId: origMeta.regionId,
                originRegionName: origMeta.regionName,
                destStationId: it.destStationId,
                destStationName: it.destStationName,
                destRegionId: destMeta.regionId,
                destRegionName: destMeta.regionName,
              };
              const isThisExpanded = expandedItemInfo?.item.typeId === it.typeId;
              return (
                <div className="pt-2 border-t border-slate-800/70 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-400">
                      Type ID: <span className="text-slate-200">{it.typeId}</span> • Score{' '}
                      <span className="text-cyan-300 font-semibold">{it.savedScore}/100</span>
                    </div>
                    <a
                      href={`https://evetycoon.com/market/${it.typeId}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-medium transition"
                    >
                      <span>View on EVE Tycoon</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <OrderBookGrid
                    opp={opp}
                    buyMethod={activePlan.buyMethod}
                    tradeMode={activePlan.tradeMode}
                    originSystemFallback={origMeta.systemName}
                    destSystemFallback={destMeta.systemName}
                    originStats={isThisExpanded ? itemOrigStats : null}
                    destStats={isThisExpanded ? itemDestStats : null}
                  />

                  <VolumeComparison
                    originLabel={`Origin Volume — ${origMeta.regionName || 'Origin'}`}
                    destLabel={`Dest Volume — ${destMeta.regionName || 'Destination'}`}
                    originStats={isThisExpanded ? itemOrigStats : null}
                    destStats={isThisExpanded ? itemDestStats : null}
                    loading={isThisExpanded && itemHistLoading}
                    error={isThisExpanded ? itemHistError : null}
                    qty={it.qty}
                  />
                </div>
              );
            })()}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#090d16] flex flex-col overscroll-contain">
      <div
        className={`w-full h-full border-0 ${theme.card} flex flex-col overflow-hidden`}
      >
        {/* Modal Header */}
        <div className={`px-4 sm:px-5 py-3 border-b ${theme.sectionHead} flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${theme.pillActive}`}>
              <Bookmark className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                My Saved Plans ({plans.length})
              </h2>
              <p className="text-[11px] text-slate-400">
                2D Stargate Route Map • Click any item row to expand Saved vs Live comparison
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activePlan && lastRefreshedAt && !refreshing && (() => {
              const ageMins = Math.max(0, Math.floor((nowMs - lastRefreshedAt) / 60000));
              const cls =
                ageMins >= 10
                  ? 'text-rose-400'
                  : ageMins >= 5
                  ? 'text-amber-400'
                  : 'text-slate-400';
              return (
                <span
                  title={`Last Live ESI check: ${new Date(lastRefreshedAt).toLocaleString()}`}
                  className={`text-[11px] tabular-nums ${cls}`}
                >
                  Live {formatRelativeAgo(lastRefreshedAt, nowMs)}
                </span>
              );
            })()}
            {activePlan && (
              <button
                type="button"
                onClick={handleRefreshLiveEsi}
                disabled={refreshing || !dataset}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                  refreshing
                    ? 'border-slate-600 bg-slate-700 text-slate-200 cursor-not-allowed'
                    : !dataset
                    ? 'border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                    : `${theme.pillActive} cursor-pointer`
                }`}
              >
                {refreshing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{refreshing ? 'Waiting...' : 'Check Live ESI'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {plans.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Bookmark className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-slate-200">No saved plans yet</div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Generate <strong className="text-slate-200">Auto Trip Plans</strong> in the Arbitrage tab and click the bookmark icon on any plan card to save it here.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
            {/* Left Sidebar: Saved Plans List */}
            <div className="border-b lg:border-b-0 lg:border-r border-slate-800/90 flex flex-col bg-[#090d16]/50 max-h-[210px] lg:max-h-none min-h-0">
              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
                {plans.map((plan) => {
                const isSelected = activePlan?.uid === plan.uid;
                const sum = planSummaries.find((s) => s.uid === plan.uid);
                const hasWarning = (sum?.missingCount ?? 0) > 0;
                const hasChanged = (sum?.changedCount ?? 0) > 0;
                return (
                  <div
                    key={plan.uid}
                    onClick={() => {
                      setSelectedUid(plan.uid);
                      setExpandedItemKey(null);
                    }}
                    className={`rounded-lg border px-2.5 py-2 cursor-pointer transition space-y-1 ${
                      isSelected
                        ? theme.pillActive
                        : 'border-slate-800/80 bg-[#0e1526]/70 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-white truncate">{plan.title}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopySavedPlan(plan);
                            }}
                            title="Copy full plan details"
                            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800/70 transition cursor-pointer shrink-0"
                          >
                            {copiedKey === `plan:${plan.uid}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">{plan.subtitle}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePlan(plan.uid);
                        }}
                        title="Delete saved plan"
                        className="p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] tabular-nums">
                      <span className="text-slate-400">
                        {formatISK(plan.totalProfit, true)} →{' '}
                        <strong
                          className={
                            (sum?.liveProfit ?? 0) >= plan.totalProfit * 0.9
                              ? 'text-emerald-400'
                              : (sum?.liveProfit ?? 0) > 0
                              ? 'text-amber-300'
                              : 'text-rose-400'
                          }
                        >
                          {formatISK(sum?.liveProfit ?? 0, true)}
                        </strong>
                      </span>
                      {hasWarning ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-400 font-semibold">
                          <XCircle className="w-3 h-3" />
                          {sum?.missingCount}
                        </span>
                      ) : hasChanged ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300 font-semibold">
                          <AlertTriangle className="w-3 h-3" />
                          {sum?.changedCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400 font-semibold">OK</span>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
              <div className="p-2.5 border-t border-slate-800/80 bg-[#090d16]/80 shrink-0">
                <button
                  type="button"
                  onClick={onClearAll}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-900/60 bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 text-xs font-medium transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              </div>
            </div>

            {/* Right Pane: Top Saved Settings Frame + (2D Map Left | Approach & Stops Right) */}
            {activePlan && (
              <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden">
                {(refreshing || fillingApproach) && (
                  <div className="absolute inset-0 z-20 bg-[#070b14]/70 backdrop-blur-[2px] flex items-center justify-center p-4">
                    <div className="rounded-xl border border-cyan-500/35 bg-[#0b1120]/95 px-4 py-3 shadow-2xl flex items-center gap-2.5 text-xs text-slate-100 font-medium">
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                      <span>
                        {fillingApproach
                          ? 'Checking en-route market prices (ESI)...'
                          : 'Checking latest market prices (ESI)...'}
                      </span>
                    </div>
                  </div>
                )}
                {/* Separate Top Frame: Saved Plan Settings */}
                <div className="px-3 sm:px-4 pt-3 shrink-0">
                  <div className={`rounded-xl border ${theme.subCard} p-2.5 text-xs tabular-nums`}>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-black/25 rounded-lg p-2 border border-white/5">
                      <div>
                        <div className="text-[10px] text-slate-400">Trade Mode</div>
                        <div className="font-semibold text-white">
                          {activePlan.buyMethod === 'order' ? 'Buy Order' : 'Instant Buy'} →{' '}
                          {activePlan.tradeMode === 'instant' ? 'Instant Sell' : 'Sell Order'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Max Cargo / Budget</div>
                        <div className="font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-cyan-300">
                            <Package className="w-3 h-3" />
                            {(activePlan.maxCargo ?? maxCargo) > 0
                              ? formatVolume(activePlan.maxCargo ?? maxCargo)
                              : '∞'}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <Wallet className="w-3 h-3" />
                            {(activePlan.maxBudget ?? maxBudget) > 0
                              ? formatISK(activePlan.maxBudget ?? maxBudget, true)
                              : '∞'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Fees &amp; Route</div>
                        <div className="font-semibold text-slate-200">
                          Tax {activePlan.salesTaxPct}% • Broker {activePlan.brokerFeePct}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Route:{' '}
                          {(activePlan.routePref ?? routePref) === 'highsec'
                            ? 'High-Sec'
                            : 'Shortest'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Saved At</div>
                        <div className="font-semibold text-slate-200">
                          {new Date(activePlan.savedAt).toLocaleString()}
                        </div>
                        {lastRefreshedAt && (
                          <div className="text-[10px] text-cyan-300">
                            Live @ {new Date(lastRefreshedAt).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Combined Plan + Approach Summary Frame */}
                {(() => {
                  const mainLiveProfit = activePlan.stops.reduce(
                    (sum, stop) =>
                      sum +
                      stop.items.reduce(
                        (s, it) =>
                          s +
                          evaluateSavedPlanItem(
                            it,
                            activePlan,
                            dataset,
                            empireData,
                            mergedLiveBooks
                          ).liveProfit,
                        0
                      ),
                    0
                  );
                  const approachLiveProfit = activePlan.approach
                    ? activePlan.approach.items.reduce(
                        (s, it) =>
                          s +
                          evaluateSavedPlanItem(
                            it,
                            activePlan,
                            dataset,
                            empireData,
                            mergedLiveBooks
                          ).liveProfit,
                        0
                      )
                    : 0;
                  const actualTotalProfit = mainLiveProfit + approachLiveProfit;
                  const approachJumps = activePlan.approach?.totalJumps ?? 0;
                  const combinedJumps = activePlan.totalJumps + approachJumps;
                  const mainIskPerJump = mainLiveProfit / Math.max(1, activePlan.totalJumps);
                  const combinedIskPerJump = actualTotalProfit / Math.max(1, combinedJumps);
                  return (
                    <div className="px-3 sm:px-4 pt-2 shrink-0">
                      <div className={`rounded-xl border ${theme.subCard} p-2.5 text-xs tabular-nums`}>
                        <div className="bg-black/25 rounded-lg p-2 border border-white/5 space-y-2">
                          {/* Top Row: Basic Plan (Main trip only) */}
                          <div className="grid grid-cols-4 gap-2 items-center pb-1.5 border-b border-white/5">
                            <div>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800/80 border border-slate-700 text-slate-300">
                                Basic Plan
                              </span>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Net Profit</div>
                              <div
                                title={`Basic Plan Live Profit: ${formatISK(mainLiveProfit)} (Saved: ${formatISK(activePlan.totalProfit)})`}
                                className={`font-semibold ${
                                  mainLiveProfit > 0 ? 'text-emerald-300' : 'text-rose-400'
                                }`}
                              >
                                {mainLiveProfit >= 0 ? '+' : ''}
                                {formatISK(mainLiveProfit, true)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">ISK / Jump</div>
                              <div
                                title={`Basic Plan ISK / Jump: ${formatISK(mainIskPerJump)}/j`}
                                className={`font-semibold ${
                                  mainIskPerJump > 0 ? 'text-amber-200' : 'text-rose-400'
                                }`}
                              >
                                {formatISK(mainIskPerJump, true)}/j
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Jumps</div>
                              <div className="font-semibold text-cyan-200">
                                {activePlan.totalJumps}j
                              </div>
                            </div>
                          </div>

                          {/* Bottom Row: Actual Combined (Main + Approach) */}
                          <div className="grid grid-cols-4 gap-2 items-center">
                            <div>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                                {activePlan.approach ? 'Total (+App)' : 'Actual'}
                              </span>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Actual Net Profit</div>
                              <div
                                title={`Exact Net Profit: ${formatISK(actualTotalProfit)}`}
                                className={`font-bold text-sm ${
                                  actualTotalProfit > 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {actualTotalProfit >= 0 ? '+' : ''}
                                {formatISK(actualTotalProfit, true)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">ISK / Jump</div>
                              <div
                                title={`Exact ISK / Jump: ${formatISK(combinedIskPerJump)}/j`}
                                className={`font-bold text-sm ${
                                  combinedIskPerJump > 0 ? 'text-amber-300' : 'text-rose-400'
                                }`}
                              >
                                {formatISK(combinedIskPerJump, true)}/j
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Total Jumps</div>
                              <div className="font-bold text-sm text-cyan-300">{combinedJumps}j</div>
                              {activePlan.approach && (
                                <div className="text-[10px] text-slate-400 truncate">
                                  Main {activePlan.totalJumps}j + App {approachJumps}j
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Split View: Vertical 2D Map (Left) + Approach & Stops (Right) */}
                <div className="min-h-0 flex-1 grid grid-cols-1 md:grid-cols-[225px_minmax(0,1fr)] gap-3 p-3 sm:p-4 overflow-y-auto md:overflow-hidden">
                  {/* Vertical 2D EVE-style Stargate Route Map (Left) */}
                  <div className="md:h-full md:min-h-0">
                    <RouteMap2D
                      plan={activePlan}
                      universe={universe}
                      dataset={dataset}
                      activityMap={activityMap}
                      routePref={routePref}
                    />
                  </div>

                  {/* Approach + Stops (Right) */}
                  <div className="space-y-2.5 md:overflow-y-auto md:pr-1">
                    {/* Unified Approach Card (Current Location Selector + En-Route Result) */}
                    <div className="rounded-lg bg-black/20 border border-white/5 p-2.5 space-y-2 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                        <div className="flex-1 min-w-[220px]">
                          <StationSelector
                            label="Current Location (Approach to Ori)"
                            selected={currentStation}
                            topStations={dataset?.topStations ?? []}
                            fwStations={dataset?.fwStations ?? []}
                            universe={universe}
                            allowAllHubs={false}
                            onSelect={handleSelectCurrentStation}
                          />
                        </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleFillApproach}
                          disabled={
                            fillingApproach ||
                            refreshing ||
                            approachCooldownSec > 0 ||
                            !currentStation ||
                            !dataset ||
                            !universe
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                            fillingApproach || refreshing || approachCooldownSec > 0
                              ? 'border-slate-600 bg-slate-700 text-slate-200 cursor-not-allowed'
                              : !currentStation || !dataset || !universe
                              ? 'border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                              : `${theme.pillActive} cursor-pointer`
                          }`}
                          title="Fetch live ESI corridor books & find the most profitable en-route instant trade from Current Location to Ori"
                        >
                          {fillingApproach ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Navigation className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {fillingApproach
                              ? 'Waiting...'
                              : approachCooldownSec > 0
                              ? `CD ${approachCooldownSec}s`
                              : 'Fill Approach'}
                          </span>
                        </button>
                        {activePlan.approach && (
                          <button
                            type="button"
                            onClick={handleClearApproach}
                            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-slate-300 transition cursor-pointer"
                            title="Remove approach leg"
                          >
                            <X className="w-3.5 h-3.5" />
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {approachMsg && (
                      <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                        {approachMsg}
                      </div>
                    )}

                    {activePlan.approach && (() => {
                      const app = activePlan.approach;
                      const oriStop = activePlan.stops[0];
                      const sameCurBuy = app.currentStationId === app.buyStationId;
                      const sameSellOri = app.sellStationId === oriStop?.stationId;
                      return (
                        <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                          {!sameCurBuy && (
                            <div className="rounded bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="text-[10px] font-medium text-amber-200 bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
                                0j
                              </span>
                              {renderSecBadge(app.currentSecurity)}
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-amber-500/35 bg-amber-500/15 text-amber-300 shrink-0">
                                DEPART
                              </span>
                              <span className="font-medium truncate text-amber-100">{app.currentStationName}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyStation(
                                    app.currentStationName,
                                    `app-cur:${app.currentStationId}`
                                  )
                                }
                                title="Copy station name"
                                className="p-0.5 rounded text-amber-300/70 hover:text-white cursor-pointer shrink-0"
                              >
                                {copiedKey === `app-cur:${app.currentStationId}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          )}

                          <div className="rounded bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              <span
                                title="Jumps to pickup"
                                className="text-[10px] font-medium text-emerald-200 bg-emerald-500/15 border border-emerald-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                              >
                                +{app.jumpsCurToBuy}j
                              </span>
                              {renderSecBadge(app.buySecurity)}
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 shrink-0">
                                BUY
                              </span>
                              <span className="font-medium text-emerald-100 truncate">{app.buyStationName}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyStation(app.buyStationName, `app-buy:${app.buyStationId}`)
                                }
                                title="Copy station name"
                                className="p-0.5 rounded text-slate-500 hover:text-white cursor-pointer shrink-0"
                              >
                                {copiedKey === `app-buy:${app.buyStationId}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                              {renderStationListCopyButton(app.items, `mb-app:${app.buyStationId}`, 'buy')}
                            </div>
                          </div>

                          {renderStopMetricsBar(
                            app.iskPerJump,
                            app.totalCost,
                            app.totalVolume,
                            maxBudget,
                            maxCargo
                          )}

                          <div className="divide-y divide-slate-800/60">
                            {app.items.map((it) =>
                              renderPlanItemRow(it, `${activePlan.uid}:app:${it.typeId}`)
                            )}
                          </div>

                          <div className="rounded bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                title="Jumps to sell approach items"
                                className="text-[10px] font-medium text-rose-200 bg-rose-500/15 border border-rose-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                              >
                                +{app.jumpsBuyToSell}j
                              </span>
                              <span className="font-medium text-rose-100 truncate">
                                {app.sellStationName}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyStation(app.sellStationName, `app-sell:${app.sellStationId}`)
                                }
                                title="Copy station name"
                                className="p-0.5 rounded text-rose-300/70 hover:text-white cursor-pointer shrink-0"
                              >
                                {copiedKey === `app-sell:${app.sellStationId}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                              {renderStationListCopyButton(app.items, `ms-app:${app.sellStationId}`, 'sell')}
                            </div>
                            {!sameSellOri && oriStop && (
                              <span className="text-[10px] text-slate-300 shrink-0 tabular-nums">
                                +{app.jumpsSellToOri}j to Stop #1
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                {/* Stops (matching Auto Trip Plans card style) */}
                <div className="space-y-2">
                  {activePlan.stops.map((stop, idx) => {
                    const stopCost = stop.items.reduce((sum, it) => sum + it.savedCost, 0);
                    const stopVol = stop.items.reduce((sum, it) => sum + it.qty * it.unitVolume, 0);
                    const stopProfit = stop.items.reduce((sum, it) => sum + it.savedProfit, 0);
                    const stopJumps = Math.max(
                      1,
                      stop.jumpsFromPrev +
                        (idx === activePlan.stops.length - 1 ? activePlan.jumpsToFinalDest : 0)
                    );
                    const stopIskPerJump = stopProfit / stopJumps;
                    return (
                    <div
                      key={`${stop.stationId}-${idx}`}
                      className="rounded-lg bg-black/20 border border-white/5 p-2.5 space-y-1.5 text-xs"
                    >
                      <div className="rounded bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            title="Jumps from previous point"
                            className="text-[10px] font-medium text-emerald-200 bg-emerald-500/15 border border-emerald-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
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
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 shrink-0">
                            BUY
                          </span>
                          <span className="font-medium text-emerald-100 truncate">{stop.stationName}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyStation(stop.stationName, `st:${stop.stationId}`)}
                            title="Copy station name"
                            className="p-0.5 rounded text-slate-500 hover:text-white cursor-pointer shrink-0"
                          >
                            {copiedKey === `st:${stop.stationId}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          {renderStationListCopyButton(stop.items, `mb-st:${stop.stationId}`, 'buy')}
                        </div>
                      </div>

                      {renderStopMetricsBar(stopIskPerJump, stopCost, stopVol, maxBudget, maxCargo)}

                      <div className="divide-y divide-slate-800/60">
                        {stop.items.map((it) =>
                          renderPlanItemRow(it, `${activePlan.uid}:${stop.stationId}:${it.typeId}`)
                        )}
                      </div>
                      {idx === activePlan.stops.length - 1 &&
                        activePlan.finalDestName &&
                        (() => {
                          const finalDestId = activePlan.stops[0]?.items[0]?.destStationId;
                          return (
                            <div className="rounded bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  title="Jumps to final destination"
                                  className="text-[10px] font-medium text-rose-200 bg-rose-500/15 border border-rose-500/35 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                                >
                                  +{activePlan.jumpsToFinalDest}j
                                </span>
                                <span className="font-medium text-rose-100 truncate">
                                  {activePlan.finalDestName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyStation(
                                      activePlan.finalDestName!,
                                      `dest:${finalDestId ?? activePlan.uid}`
                                    )
                                  }
                                  title="Copy station name"
                                  className="p-0.5 rounded text-rose-300/70 hover:text-white cursor-pointer shrink-0"
                                >
                                  {copiedKey === `dest:${finalDestId ?? activePlan.uid}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                                {renderStationListCopyButton(
                                  activePlan.stops
                                    .flatMap((s) => s.items)
                                    .filter((it) => !finalDestId || it.destStationId === finalDestId),
                                  `ms-dest:${finalDestId ?? activePlan.uid}`,
                                  'sell'
                                )}
                              </div>
                            </div>
                          );
                        })()}
                    </div>
                    );
                  })}
                </div>
                </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}