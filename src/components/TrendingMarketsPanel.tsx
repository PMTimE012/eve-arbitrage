import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  MapPin,
  Search,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  ArbitrageOpportunity,
  MarketDataset,
  OrderLevel,
  TrendingDataset,
  TrendingMarketItem,
  UniverseStationsData,
} from '../types';
import { formatISK, formatInt, formatStationForCopy } from '../utils/arbitrage';
import { fetchDestDailyVolume, type DailyVolumeStats } from '../utils/history';
import { getSystemJumpMap } from '../utils/routing';
import type { TradeTheme } from '../utils/theme';
import { ItemImage } from './ItemImage';
import { OrderBookGrid } from './OrderBookGrid';
import { VolumeComparison } from './VolumeComparison';

interface TrendingMarketsPanelProps {
  theme: TradeTheme;
  data: TrendingDataset | null;
  dataset: MarketDataset | null;
  universe: UniverseStationsData | null;
  maxBudget: number;
  maxCargo: number;
  salesTaxPct: number;
  brokerFeePct: number;
  loading: boolean;
  error: string | null;
  onSearchAllToDest: (itemName: string, regionId: number) => void;
}

type TrendingSortKey =
  | 'sellScore'
  | 'roiPct'
  | 'dailyProfit'
  | 'avgToTop5Ratio'
  | 'iskVol1d';
type SellerSortMode = 'price' | 'volume';
type LiqBadgeTier = 'high' | 'med' | 'low';
type ScoreLabel = 'High' | 'Good' | 'Moderate' | 'Risky';

interface StationOrderEntry {
  stationId: number;
  stationName: string;
  systemId: number;
  regionId: number;
  regionName: string;
  security: number;
  bestPrice: number;
  totalVol: number;
  levels: [number, number][];
}

interface EnrichedTrendingRow {
  item: TrendingMarketItem;
  netSell1d: number;
  cheapestOrigin: StationOrderEntry | null;
  cheapestJumps: number | undefined;
  top5SellAvg: number | null;
  avgToTop5Ratio: number | null;
  liqTier: LiqBadgeTier;
  sellScore: number;
  scoreLabel: ScoreLabel;
  profitPerUnit: number;
  avgCostPerUnit: number;
  availQty: number;
  availTotalProfit: number;
  roiPct: number;
  dailyProfit: number;
  originMatchCount: number;
}

function computeSellScore(
  avgToTop5Ratio: number | null,
  liqTier: LiqBadgeTier,
  iskVol1d: number,
  roiPct: number,
  availTotalProfit: number
): { sellScore: number; scoreLabel: ScoreLabel } {
  let pricePts = 4;
  if (avgToTop5Ratio === null) {
    pricePts = 22;
  } else if (avgToTop5Ratio >= 0.8 && avgToTop5Ratio <= 1.25) {
    pricePts = 35;
  } else if (avgToTop5Ratio >= 0.65 && avgToTop5Ratio <= 1.45) {
    pricePts = 26;
  } else if (avgToTop5Ratio >= 0.45 && avgToTop5Ratio <= 1.8) {
    pricePts = 15;
  }

  let liqPts = liqTier === 'high' ? 27 : liqTier === 'med' ? 18 : 8;
  if (iskVol1d >= 20_000_000) liqPts += 3;

  const roiPts = Math.min(20, Math.max(0, Math.round((roiPct / 100) * 20)));

  let profitPts = 2;
  if (availTotalProfit >= 50_000_000) profitPts = 15;
  else if (availTotalProfit >= 10_000_000) profitPts = 12;
  else if (availTotalProfit >= 2_000_000) profitPts = 8;
  else if (availTotalProfit >= 500_000) profitPts = 5;

  const sellScore = Math.min(100, pricePts + liqPts + roiPts + profitPts);
  const scoreLabel: ScoreLabel =
    sellScore >= 80
      ? 'High'
      : sellScore >= 65
      ? 'Good'
      : sellScore >= 45
      ? 'Moderate'
      : 'Risky';
  return { sellScore, scoreLabel };
}

function calcRealOriginProfit(
  levels: OrderLevel[],
  netSell1d: number,
  unitVolume = 0,
  maxBudget = 0,
  maxCargo = 0
) {
  let qty = 0;
  let totalCost = 0;
  let totalProfit = 0;
  let remBudget = maxBudget > 0 ? maxBudget : Infinity;
  let remCargo = maxCargo > 0 && unitVolume > 0 ? maxCargo : Infinity;

  for (const [price, levelQty] of levels) {
    if (price >= netSell1d || price <= 0 || levelQty <= 0) break;
    const maxByBudget = Number.isFinite(remBudget) ? Math.floor(remBudget / price) : levelQty;
    const maxByCargo =
      Number.isFinite(remCargo) && unitVolume > 0 ? Math.floor(remCargo / unitVolume) : levelQty;
    const take = Math.min(levelQty, maxByBudget, maxByCargo);
    if (take <= 0) break;

    qty += take;
    totalCost += price * take;
    totalProfit += (netSell1d - price) * take;
    if (Number.isFinite(remBudget)) remBudget -= price * take;
    if (Number.isFinite(remCargo)) remCargo -= unitVolume * take;
  }
  const roiPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const avgProfitPerUnit = qty > 0 ? totalProfit / qty : 0;
  const avgCostPerUnit = qty > 0 ? totalCost / qty : 0;
  return { qty, totalCost, totalProfit, roiPct, avgProfitPerUnit, avgCostPerUnit };
}

function getAllHubStations(dataset: MarketDataset | null) {
  if (!dataset) return [];
  const map = new Map<
    number,
    {
      stationId: number;
      stationName: string;
      systemId: number;
      regionId: number;
      regionName: string;
      security: number;
    }
  >();
  for (const s of [...dataset.topStations, ...(dataset.fwStations ?? [])]) {
    if (!map.has(s.stationId)) {
      map.set(s.stationId, s);
    }
  }
  return Array.from(map.values());
}

export function TrendingMarketsPanel({
  theme,
  data,
  dataset,
  universe,
  maxBudget,
  maxCargo,
  salesTaxPct,
  brokerFeePct,
  loading,
  error,
  onSearchAllToDest,
}: TrendingMarketsPanelProps) {
  const [regionFilter, setRegionFilter] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [minIskVol, setMinIskVol] = useState<number>(1_000_000);
  const [minActiveDays, setMinActiveDays] = useState<number>(2);
  const [minRoiPct, setMinRoiPct] = useState<number>(20);
  const [sortKey, setSortKey] = useState<TrendingSortKey>('sellScore');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [collapsedRegions, setCollapsedRegions] = useState<Record<number, boolean>>({});
  const [expandedRegions, setExpandedRegions] = useState<Record<number, boolean>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [selectedOriginId, setSelectedOriginId] = useState<number | null>(null);
  const [copiedStationId, setCopiedStationId] = useState<number | null>(null);
  const [sellerSort, setSellerSort] = useState<SellerSortMode>('price');
  const [origHistStats, setOrigHistStats] = useState<DailyVolumeStats | null>(null);
  const [destHistStats, setDestHistStats] = useState<DailyVolumeStats | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  const allHubStations = useMemo(() => getAllHubStations(dataset), [dataset]);
  const sellFeeMultiplier = Math.max(0, 1 - (salesTaxPct + brokerFeePct) / 100);

  // Target primary station per region + cached jump maps
  const regionTargetMap = useMemo(() => {
    const map = new Map<
      number,
      {
        stationId: number;
        stationName: string;
        systemId: number;
        systemName: string;
        jumpMap: Map<number, number> | null;
      }
    >();
    if (!dataset) return map;
    for (const st of [...dataset.topStations, ...(dataset.fwStations ?? [])]) {
      if (!map.has(st.regionId)) {
        map.set(st.regionId, {
          stationId: st.stationId,
          stationName: st.stationName,
          systemId: st.systemId,
          systemName: st.systemName,
          jumpMap: universe ? getSystemJumpMap(st.systemId, universe, 'highsec') : null,
        });
      }
    }
    return map;
  }, [dataset, universe]);

  const getOrdersForItem = (
    typeId: number
  ): { sellers: StationOrderEntry[]; buyers: StationOrderEntry[] } => {
    if (!dataset) return { sellers: [], buyers: [] };
    const sellers: StationOrderEntry[] = [];
    const buyers: StationOrderEntry[] = [];
    const tKey = String(typeId);
    for (const st of allHubStations) {
      const entry = dataset.orders[String(st.stationId)]?.[tKey];
      if (!entry) continue;
      if (entry.s.length > 0) {
        sellers.push({
          stationId: st.stationId,
          stationName: st.stationName,
          systemId: st.systemId,
          regionId: st.regionId,
          regionName: st.regionName,
          security: st.security,
          bestPrice: entry.s[0][0],
          totalVol: entry.sv,
          levels: entry.s.slice(0, 3),
        });
      }
      if (entry.b.length > 0) {
        buyers.push({
          stationId: st.stationId,
          stationName: st.stationName,
          systemId: st.systemId,
          regionId: st.regionId,
          regionName: st.regionName,
          security: st.security,
          bestPrice: entry.b[0][0],
          totalVol: entry.bv,
          levels: entry.b.slice(0, 3),
        });
      }
    }
    return { sellers, buyers };
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows: EnrichedTrendingRow[] = [];

    for (const it of data.items) {
      if (regionFilter !== 0 && it.regionId !== regionFilter) continue;
      if ((it.iskVol1d ?? 0) < minIskVol) continue;
      if ((it.activeDays7 ?? 0) < minActiveDays) continue;
      if (q && !it.name.toLowerCase().includes(q) && !it.regionName.toLowerCase().includes(q)) {
        continue;
      }

      const netSell1d = (it.avg1d ?? 0) * sellFeeMultiplier;
      const target = regionTargetMap.get(it.regionId);
      const tKey = String(it.typeId);

      let cheapestOrigin: StationOrderEntry | null = null;
      let top5SellAvg: number | null = null;
      let originMatchCount = 0;

      if (dataset) {
        if (target) {
          const targetEntry = dataset.orders[String(target.stationId)]?.[tKey];
          if (targetEntry && targetEntry.s.length > 0) {
            const top5 = targetEntry.s.slice(0, 5);
            top5SellAvg = top5.reduce((sum, [p]) => sum + p, 0) / top5.length;
          }
        }
        for (const st of allHubStations) {
          const entry = dataset.orders[String(st.stationId)]?.[tKey];
          if (!entry || entry.s.length === 0) continue;
          const bestPrice = entry.s[0][0];

          if (st.regionId !== it.regionId) {
            if (bestPrice < netSell1d) {
              originMatchCount++;
            }
            if (!cheapestOrigin || bestPrice < cheapestOrigin.bestPrice) {
              cheapestOrigin = {
                stationId: st.stationId,
                stationName: st.stationName,
                systemId: st.systemId,
                regionId: st.regionId,
                regionName: st.regionName,
                security: st.security,
                bestPrice,
                totalVol: entry.sv,
                levels: entry.s.slice(0, 3),
              };
            }
          }
        }
      }

      const avgToTop5Ratio =
        top5SellAvg !== null && top5SellAvg > 0 && it.avg1d > 0
          ? it.avg1d / top5SellAvg
          : null;

      const liqTier: LiqBadgeTier =
        (it.vol7dAvg ?? 0) >= 10 && (it.activeDays7 ?? 0) >= 5
          ? 'high'
          : (it.vol7dAvg ?? 0) >= 3 && (it.activeDays7 ?? 0) >= 3
          ? 'med'
          : 'low';

      const unitVol = dataset?.items[tKey]?.v ?? 0;
      const realOrigin = cheapestOrigin
        ? calcRealOriginProfit(
            dataset?.orders[String(cheapestOrigin.stationId)]?.[tKey]?.s ?? [],
            netSell1d,
            unitVol,
            maxBudget,
            maxCargo
          )
        : { qty: 0, totalCost: 0, totalProfit: 0, roiPct: 0, avgProfitPerUnit: 0, avgCostPerUnit: 0 };

      const profitPerUnit = realOrigin.avgProfitPerUnit;
      const avgCostPerUnit = realOrigin.avgCostPerUnit;
      const roiPct = realOrigin.roiPct;
      const availQty = realOrigin.qty;
      const availTotalProfit = realOrigin.totalProfit;
      const dailyProfit =
        cheapestOrigin && netSell1d > cheapestOrigin.bestPrice
          ? (netSell1d - cheapestOrigin.bestPrice) * (it.vol1d ?? 0)
          : 0;

      if (availTotalProfit <= 0 || roiPct < minRoiPct) continue;

      const cheapestJumps =
        cheapestOrigin && target?.jumpMap
          ? target.jumpMap.get(cheapestOrigin.systemId)
          : undefined;

      const { sellScore, scoreLabel } = computeSellScore(
        avgToTop5Ratio,
        liqTier,
        it.iskVol1d ?? 0,
        roiPct,
        availTotalProfit
      );

      rows.push({
        item: it,
        netSell1d,
        cheapestOrigin,
        cheapestJumps,
        top5SellAvg,
        avgToTop5Ratio,
        liqTier,
        sellScore,
        scoreLabel,
        profitPerUnit,
        avgCostPerUnit,
        availQty,
        availTotalProfit,
        roiPct,
        dailyProfit,
        originMatchCount,
      });
    }

    const dir = sortDir === 'desc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === 'sellScore') return (b.sellScore - a.sellScore) * dir;
      if (sortKey === 'dailyProfit') return (b.availTotalProfit - a.availTotalProfit) * dir;
      if (sortKey === 'roiPct') return (b.roiPct - a.roiPct) * dir;
      if (sortKey === 'avgToTop5Ratio') {
        const da = a.avgToTop5Ratio !== null ? Math.abs(1 - a.avgToTop5Ratio) : 999;
        const db = b.avgToTop5Ratio !== null ? Math.abs(1 - b.avgToTop5Ratio) : 999;
        return (da - db) * dir;
      }
      return ((b.item.iskVol1d ?? 0) - (a.item.iskVol1d ?? 0)) * dir;
    });

    return rows;
  }, [
    data,
    dataset,
    allHubStations,
    regionTargetMap,
    regionFilter,
    search,
    minIskVol,
    minActiveDays,
    minRoiPct,
    sortKey,
    sortDir,
    sellFeeMultiplier,
    maxBudget,
    maxCargo,
  ]);

  const regionGroups = useMemo(() => {
    const map = new Map<
      number,
      {
        regionId: number;
        regionName: string;
        totalDailyProfit: number;
        totalIskVol: number;
        rows: EnrichedTrendingRow[];
      }
    >();
    for (const row of filtered) {
      const it = row.item;
      let grp = map.get(it.regionId);
      if (!grp) {
        grp = {
          regionId: it.regionId,
          regionName: it.regionName,
          totalDailyProfit: 0,
          totalIskVol: 0,
          rows: [],
        };
        map.set(it.regionId, grp);
      }
      grp.totalDailyProfit += row.dailyProfit;
      grp.totalIskVol += it.iskVol1d ?? 0;
      grp.rows.push(row);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.totalDailyProfit - a.totalDailyProfit || b.totalIskVol - a.totalIskVol
    );
  }, [filtered]);

  const expandedRow = useMemo(() => {
    if (!expandedKey) return null;
    return filtered.find((r) => `${r.item.regionId}:${r.item.typeId}` === expandedKey) ?? null;
  }, [expandedKey, filtered]);

  const activeExpandedOriginRegionId = useMemo(() => {
    if (!expandedRow || !dataset) return null;
    if (selectedOriginId) {
      const st = allHubStations.find((s) => s.stationId === selectedOriginId);
      if (st) return st.regionId;
    }
    return expandedRow.cheapestOrigin?.regionId ?? null;
  }, [expandedRow, selectedOriginId, allHubStations, dataset]);

  useEffect(() => {
    if (!expandedRow) {
      setOrigHistStats(null);
      setDestHistStats(null);
      setHistError(null);
      setHistLoading(false);
      return;
    }
    const typeId = expandedRow.item.typeId;
    const destRegId = expandedRow.item.regionId;
    const origRegId = activeExpandedOriginRegionId;
    let cancelled = false;
    setHistLoading(true);
    setHistError(null);
    Promise.all([
      origRegId ? fetchDestDailyVolume(origRegId, typeId) : Promise.resolve(null),
      origRegId === destRegId ? Promise.resolve(null) : fetchDestDailyVolume(destRegId, typeId),
    ])
      .then(([origStats, destStats]) => {
        if (!cancelled) {
          setOrigHistStats(origStats);
          setDestHistStats(origRegId === destRegId ? origStats : destStats);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHistError(err instanceof Error ? err.message : 'Failed to load volume history');
        }
      })
      .finally(() => {
        if (!cancelled) setHistLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedRow, activeExpandedOriginRegionId]);

  const toggleSort = (key: TrendingSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <section className={`rounded-2xl ${theme.card} border p-4 sm:p-5 shadow-xl space-y-4`}>
      {/* Header & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg border flex items-center justify-center ${theme.pillActive}`}
          >
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">
              1-Day Avg Price & Vol vs Cross-Hub Sell Orders
            </h2>
            <p className="text-xs text-slate-400">
              Compares yesterday&apos;s regional 1d Avg Price &amp; Volume against the cheapest
              sell station across 98 hubs (net after {salesTaxPct}% tax + {brokerFeePct}% broker).
            </p>
          </div>
        </div>
        {data && (
          <div className="text-right space-y-0.5 tabular-nums">
            <div className="text-[11px] text-slate-400">
              Showing <span className="text-white font-semibold">{formatInt(filtered.length)}</span>{' '}
              opportunities across{' '}
              <span className="text-cyan-300 font-semibold">{regionGroups.length}</span> regions
            </div>
            <div className="text-[11px] text-slate-500">
              Budget: {maxBudget > 0 ? `${formatISK(maxBudget, true)} ISK` : 'Unlimited'} • Cargo:{' '}
              {maxCargo > 0 ? `${formatInt(maxCargo)} m³` : 'Unlimited'} • Tax: {salesTaxPct}% •
              Broker: {brokerFeePct}%
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Target Region</label>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(Number(e.target.value))}
            className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value={0}>All Regions ({data?.regions.length ?? 0})</option>
            {data?.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Search Item</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Item or region..."
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Min 1d ISK Vol</label>
          <div className="flex gap-1">
            {[
              { label: 'All', val: 0 },
              { label: '1M', val: 1_000_000 },
              { label: '5M', val: 5_000_000 },
              { label: '10M', val: 10_000_000 },
              { label: '50M', val: 50_000_000 },
            ].map((p) => (
              <button
                key={p.val}
                type="button"
                onClick={() => setMinIskVol(p.val)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                  minIskVol === p.val ? theme.pillActive : theme.pillInactive
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Min Active (7d)</label>
          <div className="flex gap-1">
            {[2, 4, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setMinActiveDays(d)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                  minActiveDays === d ? theme.pillActive : theme.pillInactive
                }`}
              >
                {d}d+
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Min Margin (ROI)</label>
          <div className="flex gap-1">
            {[
              { label: '>0%', val: 0 },
              { label: '20%+', val: 20 },
              { label: '50%+', val: 50 },
              { label: '100%+', val: 100 },
            ].map((r) => (
              <button
                key={r.val}
                type="button"
                onClick={() => setMinRoiPct(r.val)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                  minRoiPct === r.val ? theme.pillActive : theme.pillInactive
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-14 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <span>Loading 1-day regional market data...</span>
        </div>
      ) : error ? (
        <div className="py-10 text-center text-xs text-rose-400">{error}</div>
      ) : regionGroups.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No items match current filters. Try lowering Min 1d ISK Vol or toggling Profitable Only.
        </div>
      ) : (
        <div className="space-y-4">
          {regionGroups.map((group) => {
            const isCollapsed = Boolean(collapsedRegions[group.regionId]);
            const isExpandedAll =
              regionFilter !== 0 || Boolean(expandedRegions[group.regionId]);
            const visibleRows = isExpandedAll ? group.rows : group.rows.slice(0, 12);

            return (
              <div
                key={group.regionId}
                className="rounded-xl border border-slate-800/90 bg-[#090d16]/50 overflow-hidden"
              >
                {/* Region Header */}
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedRegions((prev) => ({
                      ...prev,
                      [group.regionId]: !prev[group.regionId],
                    }))
                  }
                  className="w-full px-4 py-2 bg-slate-900/90 hover:bg-slate-800/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-left transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-cyan-400" />
                    )}
                    <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-sm font-bold text-white">{group.regionName}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-semibold tabular-nums">
                      {formatInt(group.rows.length)} items
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-400 tabular-nums">
                    <span>
                      1d Vol:{' '}
                      <span className="font-semibold text-cyan-300">
                        {formatISK(group.totalIskVol, true)}/d
                      </span>
                    </span>
                    <span>
                      Est. Profit Pool:{' '}
                      <span className="font-semibold text-emerald-400">
                        +{formatISK(group.totalDailyProfit, true)}/d
                      </span>
                    </span>
                  </div>
                </button>

                {/* Table Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-800/60">
                    <div className="hidden lg:grid lg:grid-cols-[minmax(220px,2fr)_95px_175px_185px_135px] gap-3 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-black/20">
                      <div>Item</div>
                      <button
                        type="button"
                        onClick={() => toggleSort('sellScore')}
                        className={`flex items-center justify-center gap-1 cursor-pointer transition hover:text-white ${
                          sortKey === 'sellScore' ? 'text-cyan-300' : ''
                        }`}
                      >
                        <span>Score</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSort('avgToTop5Ratio')}
                        className={`flex items-center justify-end gap-1 cursor-pointer transition hover:text-white ${
                          sortKey === 'avgToTop5Ratio' ? 'text-cyan-300' : ''
                        }`}
                      >
                        <span>1d Avg / Top 5 Sell</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSort('dailyProfit')}
                          className={`flex items-center gap-1 cursor-pointer transition hover:text-white ${
                            sortKey === 'dailyProfit' ? 'text-cyan-300' : ''
                          }`}
                        >
                          <span>Margin</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <span>/</span>
                        <button
                          type="button"
                          onClick={() => toggleSort('roiPct')}
                          className={`flex items-center gap-1 cursor-pointer transition hover:text-white ${
                            sortKey === 'roiPct' ? 'text-cyan-300' : ''
                          }`}
                        >
                          <span>ROI</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-right">Action</div>
                    </div>

                    {visibleRows.map((row) => {
                      const it = row.item;
                      const rowKey = `${it.regionId}:${it.typeId}`;
                      const isRowExpanded = expandedKey === rowKey;
                      const targetInfo = regionTargetMap.get(it.regionId);
                      const { sellers: allSellers } = isRowExpanded
                        ? getOrdersForItem(it.typeId)
                        : { sellers: [] };
                      const globalSellers = isRowExpanded
                        ? [...allSellers]
                            .filter((s) => s.regionId !== it.regionId)
                            .sort((a, b) =>
                              sellerSort === 'price'
                                ? a.bestPrice - b.bestPrice
                                : b.totalVol - a.totalVol || a.bestPrice - b.bestPrice
                            )
                            .slice(0, 12)
                        : [];

                      const activeOrigin = isRowExpanded
                        ? globalSellers.find((s) => s.stationId === selectedOriginId) ??
                          row.cheapestOrigin ??
                          globalSellers[0] ??
                          null
                        : null;

                      const orderBookOpp: ArbitrageOpportunity | null = (() => {
                        if (!isRowExpanded || !dataset || !targetInfo) return null;
                        const tKey = String(it.typeId);
                        const origBook = activeOrigin
                          ? dataset.orders[String(activeOrigin.stationId)]?.[tKey]
                          : undefined;
                        const destBook = dataset.orders[String(targetInfo.stationId)]?.[tKey];
                        const origPrice = origBook?.s?.[0]?.[0] ?? activeOrigin?.bestPrice ?? 0;
                        const destPrice = destBook?.s?.[0]?.[0] ?? it.avg1d;
                        const unitVol = dataset.items[tKey]?.v ?? 0;
                        const profitPerUnit = row.netSell1d - origPrice;
                        return {
                          typeId: it.typeId,
                          name: it.name,
                          unitVolume: unitVol,
                          buyPrice: origPrice,
                          sellPrice: destPrice,
                          profitPerUnit,
                          roiPct: origPrice > 0 ? (profitPerUnit / origPrice) * 100 : 0,
                          profitPerM3: unitVol > 0 ? profitPerUnit / unitVol : 0,
                          recommendedQty: it.vol1d,
                          totalCost: origPrice * it.vol1d,
                          budgetUsedPct: null,
                          totalRevenueAfterTax: row.netSell1d * it.vol1d,
                          totalVolume: unitVol * it.vol1d,
                          cargoFillPct: null,
                          totalProfit: profitPerUnit * it.vol1d,
                          tradeScore: 0,
                          scoreLabel: row.liqTier === 'high' ? 'High' : row.liqTier === 'med' ? 'Good' : 'Moderate',
                          liquidityLabel: row.liqTier === 'high' ? 'High' : row.liqTier === 'med' ? 'Moderate' : 'Low',
                          avg7d: it.vol7dAvg,
                          activeDays14d: it.activeDays7,
                          originSellVol: origBook?.sv ?? 0,
                          originBuyVol: origBook?.bv ?? 0,
                          destBuyVol: destBook?.bv ?? 0,
                          destSellVol: destBook?.sv ?? 0,
                          originSells: origBook?.s ?? [],
                          originBuys: origBook?.b ?? [],
                          destSells: destBook?.s ?? [],
                          destBuys: destBook?.b ?? [],
                          originStationId: activeOrigin?.stationId,
                          originStationName: activeOrigin?.stationName ?? 'No Origin',
                          originSystemId: activeOrigin?.systemId,
                          originSystemName: activeOrigin?.stationName,
                          originRegionId: activeOrigin?.regionId,
                          originRegionName: activeOrigin?.regionName,
                          destStationId: targetInfo.stationId,
                          destStationName: targetInfo.stationName,
                          destSystemId: targetInfo.systemId,
                          destSystemName: targetInfo.stationName,
                          destRegionId: it.regionId,
                          destRegionName: it.regionName,
                        };
                      })();

                      return (
                        <Fragment key={rowKey}>
                          <div
                            onClick={() => {
                              setSelectedOriginId(null);
                              setExpandedKey((prev) => (prev === rowKey ? null : rowKey));
                            }}
                            className={`px-4 py-2 transition cursor-pointer flex flex-col lg:grid lg:grid-cols-[minmax(220px,2fr)_95px_175px_185px_135px] lg:items-center gap-2 lg:gap-3 text-xs tabular-nums ${
                              isRowExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/35'
                            }`}
                          >
                            {/* Item + Liquidity Badge */}
                            <div className="flex items-center gap-2 min-w-0">
                              {isRowExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              )}
                              <ItemImage
                                typeId={it.typeId}
                                name={it.name}
                                size={32}
                                className="w-7 h-7 rounded-md border-slate-700 shrink-0"
                              />
                              <span className="font-semibold text-white truncate" title={it.name}>
                                {it.name}
                              </span>
                              <span
                                title={`7d Avg: ${it.vol7dAvg.toFixed(1)}/d | Active ${it.activeDays7}/7d | 1d Vol: ${formatInt(it.vol1d)}u`}
                                className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ${
                                  row.liqTier === 'high'
                                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                    : row.liqTier === 'med'
                                    ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                                    : 'bg-slate-800/80 border-slate-700 text-slate-400'
                                }`}
                              >
                                {row.liqTier === 'high'
                                  ? 'High'
                                  : row.liqTier === 'med'
                                  ? 'Med'
                                  : 'Low'}
                              </span>
                              {row.top5SellAvg === null && (
                                <span
                                  title={`No sell orders currently at ${targetInfo?.stationName ?? it.regionName}`}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 shrink-0"
                                >
                                  No Seller
                                </span>
                              )}
                            </div>

                            {/* Sell Score */}
                            <div className="flex items-center justify-between lg:justify-center">
                              <span className="lg:hidden text-[10px] text-slate-500">Score:</span>
                              <span
                                title={`Sell Score ${row.sellScore}/100 (${row.scoreLabel}) — combines Price Match, Liquidity, ROI & Real Profit`}
                                className={`text-[11px] font-bold px-2 py-0.5 rounded border tabular-nums ${
                                  row.scoreLabel === 'High'
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                                    : row.scoreLabel === 'Good'
                                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                                    : row.scoreLabel === 'Moderate'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                                    : 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                                }`}
                              >
                                {row.sellScore}
                              </span>
                            </div>

                            {/* 1d Avg / Top 5 Sell */}
                            <div className="flex items-center justify-between lg:justify-end">
                              <span className="lg:hidden text-[10px] text-slate-500">
                                1d Avg / Top 5 Sell:
                              </span>
                              {row.avgToTop5Ratio !== null && row.top5SellAvg !== null ? (
                                <div
                                  className="text-right"
                                  title={`1d Avg: ${formatISK(it.avg1d)} ÷ Top 5 Sell Avg (${targetInfo?.stationName ?? it.regionName}): ${formatISK(row.top5SellAvg)}`}
                                >
                                  <div
                                    className={`font-bold ${
                                      row.avgToTop5Ratio >= 0.75 && row.avgToTop5Ratio <= 1.35
                                        ? 'text-emerald-400'
                                        : row.avgToTop5Ratio >= 0.45
                                        ? 'text-amber-300'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {row.avgToTop5Ratio.toFixed(2)}x
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {formatISK(it.avg1d, true)} / {formatISK(row.top5SellAvg, true)}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-right">
                                  <span className="text-[11px] text-amber-300 font-medium">
                                    Empty Sell
                                  </span>
                                  <div className="text-[10px] text-slate-400">
                                    1d: {formatISK(it.avg1d, true)}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Margin / ROI */}
                            <div className="flex items-center justify-between lg:justify-end">
                              <span className="lg:hidden text-[10px] text-slate-500">
                                Margin / ROI:
                              </span>
                              {row.cheapestOrigin ? (
                                <div
                                  className="text-right"
                                  title={`Buy ${formatInt(row.availQty)}x at ${row.cheapestOrigin.stationName} (from ${formatISK(row.cheapestOrigin.bestPrice)})${row.cheapestJumps !== undefined ? ` • ${row.cheapestJumps}j` : ''}`}
                                >
                                  <div className="font-semibold text-white">
                                    +{formatISK(row.availTotalProfit, true)}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {formatInt(row.availQty)}x • +{formatISK(row.profitPerUnit, true)}/ea
                                  </div>
                                  <div className="mt-1">
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${
                                        row.roiPct > 150
                                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                                          : row.roiPct > 100
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                          : row.roiPct >= 50
                                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                          : row.roiPct >= 25
                                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                                          : 'bg-slate-800/80 text-slate-300 border-slate-700/60'
                                      }`}
                                    >
                                      {row.roiPct.toFixed(1)}% ROI
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={row.originMatchCount === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSearchAllToDest(it.name, it.regionId);
                                }}
                                title={
                                  row.originMatchCount === 0
                                    ? `No origin hubs cheaper than 1d Avg (after fees)`
                                    : `Search ${row.originMatchCount} origin hubs → ${it.regionName}`
                                }
                                className={`text-[11px] font-semibold px-2 py-1 rounded border transition tabular-nums ${
                                  row.originMatchCount === 0
                                    ? 'bg-slate-800/60 border-slate-700/60 text-slate-500 cursor-not-allowed'
                                    : `${theme.pillActive} cursor-pointer`
                                }`}
                              >
                                {row.originMatchCount > 0
                                  ? `All → Dest (${row.originMatchCount})`
                                  : 'All → Dest'}
                              </button>
                              <a
                                href={`https://evetycoon.com/market/${it.typeId}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="View on EVE Tycoon"
                                className="p-1 text-slate-400 hover:text-cyan-300 transition"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>

                          {/* Expanded Detail */}
                          {isRowExpanded && (
                            <div className="px-4 py-3.5 bg-[#070b14] border-t border-slate-800/80 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg bg-[#0e1526] border border-slate-800">
                                <div className="flex flex-wrap items-center gap-4 tabular-nums">
                                  <span>
                                    1d Avg:{' '}
                                    <strong className="text-amber-300">
                                      {formatISK(it.avg1d)}
                                    </strong>
                                  </span>
                                  <span className="text-slate-400">
                                    Net Sell (after fees):{' '}
                                    <strong className="text-emerald-300">
                                      {formatISK(row.netSell1d)}
                                    </strong>
                                  </span>
                                  <span className="text-slate-400">
                                    1d Range:{' '}
                                    <span className="text-slate-200">
                                      {formatISK(it.low1d, true)} – {formatISK(it.high1d, true)}
                                    </span>
                                  </span>
                                  <span className="text-slate-400">
                                    7d Avg:{' '}
                                    <span className="text-slate-200">
                                      {formatISK(it.avg7dPrice)} ({it.vol7dAvg.toFixed(1)}/d)
                                    </span>
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                {/* Left: Cheapest Origins Across Hubs */}
                                <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-3 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                                    <span className="font-bold text-white">
                                      Other Stations Selling (Where to Buy)
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setSellerSort('price')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition ${
                                          sellerSort === 'price'
                                            ? theme.pillActive
                                            : theme.pillInactive
                                        }`}
                                      >
                                        Cheapest
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setSellerSort('volume')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition ${
                                          sellerSort === 'volume'
                                            ? theme.pillActive
                                            : theme.pillInactive
                                        }`}
                                      >
                                        Most Stock
                                      </button>
                                    </div>
                                  </div>
                                  {globalSellers.length === 0 ? (
                                    <div className="text-[11px] text-slate-500 py-2">
                                      No other hub sell orders found in preloaded snapshot.
                                    </div>
                                  ) : (
                                    <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                                      {globalSellers.map((s) => {
                                        const jumps = targetInfo?.jumpMap?.get(s.systemId);
                                        const fullLevels =
                                          dataset?.orders[String(s.stationId)]?.[String(it.typeId)]?.s ??
                                          s.levels;
                                        const real = calcRealOriginProfit(
                                          fullLevels,
                                          row.netSell1d,
                                          dataset?.items[String(it.typeId)]?.v ?? 0,
                                          maxBudget,
                                          maxCargo
                                        );
                                        const isSelected = activeOrigin?.stationId === s.stationId;
                                        return (
                                          <div
                                            key={s.stationId}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedOriginId(s.stationId)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setSelectedOriginId(s.stationId);
                                              }
                                            }}
                                            className={`w-full text-left py-1.5 px-1.5 rounded flex items-center justify-between gap-2 tabular-nums transition cursor-pointer ${
                                              isSelected
                                                ? 'bg-cyan-500/15 border border-cyan-500/35'
                                                : 'hover:bg-slate-800/50'
                                            }`}
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-1 min-w-0">
                                                <span className="text-[11px] font-medium text-slate-200 truncate">
                                                  {s.stationName}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(
                                                      formatStationForCopy(s.stationName)
                                                    );
                                                    setCopiedStationId(s.stationId);
                                                    setTimeout(() => {
                                                      setCopiedStationId((prev) =>
                                                        prev === s.stationId ? null : prev
                                                      );
                                                    }, 1200);
                                                  }}
                                                  title="Copy station name"
                                                  className="p-0.5 text-slate-500 hover:text-white cursor-pointer shrink-0"
                                                >
                                                  {copiedStationId === s.stationId ? (
                                                    <Check className="w-3 h-3 text-emerald-400" />
                                                  ) : (
                                                    <Copy className="w-3 h-3" />
                                                  )}
                                                </button>
                                              </div>
                                              <div className="text-[10px] text-cyan-400/80 flex items-center gap-1.5">
                                                <span>
                                                  {s.regionName} • {s.security.toFixed(1)}
                                                </span>
                                                {jumps !== undefined && (
                                                  <span className="px-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                                                    {jumps}j
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                              <div className="text-[11px] font-bold text-rose-300">
                                                {real.avgCostPerUnit > 0
                                                  ? `Avg ${formatISK(real.avgCostPerUnit)}`
                                                  : formatISK(s.bestPrice)}
                                              </div>
                                              <div className="text-[10px] flex items-center justify-end gap-1.5">
                                                <span
                                                  className={
                                                    real.totalProfit > 0
                                                      ? 'text-emerald-400 font-semibold'
                                                      : 'text-rose-400'
                                                  }
                                                >
                                                  {real.totalProfit > 0
                                                    ? `+${formatISK(real.totalProfit, true)} (${real.qty}x, +${real.roiPct.toFixed(0)}%)`
                                                    : 'No profit'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* Right: Arbitrage-style OrderBookGrid + Origin/Dest VolumeComparison */}
                                <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-3 space-y-3">
                                  {orderBookOpp ? (
                                    <>
                                      <OrderBookGrid
                                        opp={orderBookOpp}
                                        buyMethod="instant"
                                        tradeMode="patient"
                                        destSystemFallback={targetInfo?.systemName}
                                        originStats={origHistStats}
                                        destStats={destHistStats}
                                      />
                                      <VolumeComparison
                                        originLabel={`Origin Volume — ${activeOrigin?.regionName ?? 'Origin'}`}
                                        destLabel={`Dest Volume — ${it.regionName}`}
                                        originStats={origHistStats}
                                        destStats={destHistStats}
                                        loading={histLoading}
                                        error={histError}
                                        qty={row.availQty > 0 ? row.availQty : it.vol1d}
                                      />
                                    </>
                                  ) : (
                                    <div className="text-[11px] text-slate-500 py-4 text-center">
                                      No order book data available for {it.regionName}.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </Fragment>
                      );
                    })}

                    {!isExpandedAll && group.rows.length > 12 && (
                      <div className="flex justify-center py-2 bg-black/15">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRegions((prev) => ({
                              ...prev,
                              [group.regionId]: true,
                            }))
                          }
                          className="text-xs font-medium px-3.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700 transition cursor-pointer"
                        >
                          Show all {group.rows.length} items in {group.regionName}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
