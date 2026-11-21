import { ChevronDown, ChevronRight, ExternalLink, Flame, Loader2, MapPin, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { MarketDataset, TrendingDataset, TrendingMarketItem } from '../types';
import { formatISK, formatInt } from '../utils/arbitrage';
import type { TradeTheme } from '../utils/theme';
import { ItemImage } from './ItemImage';

interface TrendingMarketsPanelProps {
  theme: TradeTheme;
  data: TrendingDataset | null;
  dataset: MarketDataset | null;
  salesTaxPct: number;
  brokerFeePct: number;
  loading: boolean;
  error: string | null;
  onSearchAllToDest: (itemName: string, regionId: number) => void;
}

type TrendingSortKey = 'trendPct' | 'iskVol7d' | 'med7d';
type SellerSortMode = 'price' | 'volume';

interface StationOrderEntry {
  stationId: number;
  stationName: string;
  regionId: number;
  regionName: string;
  security: number;
  bestPrice: number;
  totalVol: number;
  levels: [number, number][];
}

function getAllHubStations(dataset: MarketDataset | null) {
  if (!dataset) return [];
  const map = new Map<
    number,
    { stationId: number; stationName: string; regionId: number; regionName: string; security: number }
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
  salesTaxPct,
  brokerFeePct,
  loading,
  error,
  onSearchAllToDest,
}: TrendingMarketsPanelProps) {
  const [regionFilter, setRegionFilter] = useState<number>(0); // 0 = All Regions
  const [search, setSearch] = useState('');
  const [minIskVol, setMinIskVol] = useState<number>(10_000_000);
  const [minActiveDays, setMinActiveDays] = useState<number>(10);
  const [sortKey, setSortKey] = useState<TrendingSortKey>('trendPct');
  const [collapsedRegions, setCollapsedRegions] = useState<Record<number, boolean>>({});
  const [expandedRegions, setExpandedRegions] = useState<Record<number, boolean>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sellerSort, setSellerSort] = useState<SellerSortMode>('price');

  const allHubStations = useMemo(() => getAllHubStations(dataset), [dataset]);

  const countAllToDestOrigins = (typeId: number, regionId: number): number => {
    if (!dataset) return 0;
    const targetStation =
      dataset.topStations.find((s) => s.regionId === regionId) ??
      dataset.fwStations?.find((s) => s.regionId === regionId);
    if (!targetStation) return 0;

    const destEntry = dataset.orders[String(targetStation.stationId)]?.[String(typeId)];
    if (!destEntry) return 0;

    const histSell = dataset.historySellPrice7d?.[String(regionId)]?.[String(typeId)];
    const rawDestSell = destEntry.s.length > 0 ? destEntry.s[0][0] : 0;
    const cappedDestSell =
      rawDestSell > 0 && histSell && histSell > 0 ? Math.min(rawDestSell, histSell) : rawDestSell;

    const instantNet = destEntry.b.length > 0 ? destEntry.b[0][0] * (1 - salesTaxPct / 100) : 0;
    const orderNet =
      cappedDestSell > 0 ? cappedDestSell * (1 - (salesTaxPct + brokerFeePct) / 100) : 0;
    const maxDestNet = Math.max(instantNet, orderNet);
    if (maxDestNet <= 0) return 0;

    let count = 0;
    for (const st of allHubStations) {
      if (st.stationId === targetStation.stationId) continue;
      const origEntry = dataset.orders[String(st.stationId)]?.[String(typeId)];
      if (!origEntry || origEntry.s.length === 0) continue;
      if (origEntry.s[0][0] < maxDestNet) {
        count++;
      }
    }
    return count;
  };

  const getOrdersForItem = (typeId: number): { sellers: StationOrderEntry[]; buyers: StationOrderEntry[] } => {
    if (!dataset) return { sellers: [], buyers: [] };
    const sellers: StationOrderEntry[] = [];
    const buyers: StationOrderEntry[] = [];
    for (const st of allHubStations) {
      const entry = dataset.orders[String(st.stationId)]?.[String(typeId)];
      if (!entry) continue;
      if (entry.s.length > 0) {
        sellers.push({
          stationId: st.stationId,
          stationName: st.stationName,
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
    const list = data.items.filter((it) => {
      if (regionFilter !== 0 && it.regionId !== regionFilter) return false;
      if (it.med7d < 10) return false;
      if (it.iskVol7d < minIskVol) return false;
      if (it.activeDays7 < minActiveDays) return false;
      if (q && !it.name.toLowerCase().includes(q) && !it.regionName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    list.sort((a, b) => b[sortKey] - a[sortKey]);
    return list;
  }, [data, regionFilter, search, minIskVol, minActiveDays, sortKey]);

  const regionGroups = useMemo(() => {
    const map = new Map<
      number,
      { regionId: number; regionName: string; totalIskVol: number; items: TrendingMarketItem[] }
    >();
    for (const it of filtered) {
      let grp = map.get(it.regionId);
      if (!grp) {
        grp = { regionId: it.regionId, regionName: it.regionName, totalIskVol: 0, items: [] };
        map.set(it.regionId, grp);
      }
      grp.totalIskVol += it.iskVol7d;
      grp.items.push(it);
    }
    return Array.from(map.values()).sort((a, b) => b.totalIskVol - a.totalIskVol);
  }, [filtered]);

  return (
    <section className={`rounded-2xl ${theme.card} border p-4 sm:p-5 shadow-xl space-y-4`}>
      {/* Header & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${theme.pillActive}`}>
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">
              Trending Markets (Buyer-Driven • 14d Median vs 30d Avg)
            </h2>
            <p className="text-xs text-slate-400">
              Items actively bought from Sell Orders (≥50% buyer-driven volume) across High/Low-Sec regions
            </p>
          </div>
        </div>
        {data && (
          <div className="text-xs text-slate-400 tabular-nums">
            Showing <strong className="text-white">{formatInt(filtered.length)}</strong> trending items
          </div>
        )}
      </div>

      {/* Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Region */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Region</label>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(Number(e.target.value))}
            className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value={0}>All High/Low-Sec Regions</option>
            {(data?.regions ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Filter Item / Region</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. PLEX, Muninn, Black Rise..."
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Min ISK Vol/d */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Min Daily ISK Vol (7d)</label>
          <div className="flex gap-1">
            {[
              { label: '500K+', val: 0 },
              { label: '1M+', val: 1_000_000 },
              { label: '10M+', val: 10_000_000 },
              { label: '50M+', val: 50_000_000 },
              { label: '100M+', val: 100_000_000 },
            ].map((p) => (
              <button
                key={p.label}
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

        {/* Active Days & Sort */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Active Days (14d)</label>
            <div className="flex gap-1">
              {[6, 10, 14].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMinActiveDays(d)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                    minActiveDays === d ? theme.pillActive : theme.pillInactive
                  }`}
                >
                  {d}/14d
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Sort By</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as TrendingSortKey)}
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="trendPct">Trend % (Highest)</option>
              <option value="iskVol7d">ISK Vol/d (Highest)</option>
              <option value="med7d">14d Med/d (Highest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-14 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <span>Loading 30-day regional trending data...</span>
        </div>
      ) : error ? (
        <div className="py-10 text-center text-xs text-rose-400">{error}</div>
      ) : regionGroups.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No trending items match current filters. Try lowering Min Daily ISK Vol or Active Days.
        </div>
      ) : (
        <div className="space-y-4">
          {regionGroups.map((group) => {
            const isCollapsed = Boolean(collapsedRegions[group.regionId]);
            const isExpandedAll = regionFilter !== 0 || Boolean(expandedRegions[group.regionId]);
            const visibleItems = isExpandedAll ? group.items : group.items.slice(0, 12);

            return (
              <div
                key={group.regionId}
                className="rounded-xl border border-slate-800/90 bg-[#090d16]/50 overflow-hidden"
              >
                {/* Region Row Header */}
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
                      {formatInt(group.items.length)} items
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    Total Trending Vol:{' '}
                    <span className="font-semibold text-emerald-400">
                      {formatISK(group.totalIskVol, true)}/d
                    </span>
                  </div>
                </button>

                {/* Compact Horizontal Item Rows under this Region */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-800/60">
                    {/* Column Header (desktop) */}
                    <div className="hidden lg:grid lg:grid-cols-[minmax(200px,1.8fr)_120px_80px_90px_65px_150px_140px] gap-3 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-black/20">
                      <div>Item</div>
                      <div className="text-right">14d Med/d</div>
                      <div className="text-right">30d Avg/d</div>
                      <div className="text-right">ISK Vol/d</div>
                      <div className="text-center">Active</div>
                      <div className="text-center">14d Trend</div>
                      <div className="text-right">Action</div>
                    </div>

                    {visibleItems.map((it) => {
                      const rowKey = `${it.regionId}:${it.typeId}`;
                      const isRowExpanded = expandedKey === rowKey;
                      const maxVol = Math.max(1, ...it.spark14);
                      const originMatchCount = countAllToDestOrigins(it.typeId, it.regionId);
                      const { sellers: allSellers, buyers: allBuyers } = isRowExpanded
                        ? getOrdersForItem(it.typeId)
                        : { sellers: [], buyers: [] };
                      const regionSellers = isRowExpanded
                        ? allSellers
                            .filter((s) => s.regionId === it.regionId)
                            .sort((a, b) => a.bestPrice - b.bestPrice)
                        : [];
                      const globalSellers = isRowExpanded
                        ? [...allSellers]
                            .sort((a, b) =>
                              sellerSort === 'price'
                                ? a.bestPrice - b.bestPrice
                                : b.totalVol - a.totalVol || a.bestPrice - b.bestPrice
                            )
                            .slice(0, 8)
                        : [];
                      const highestBuyers = isRowExpanded
                        ? [...allBuyers]
                            .sort((a, b) => b.bestPrice - a.bestPrice || b.totalVol - a.totalVol)
                            .slice(0, 12)
                        : [];

                      return (
                        <Fragment key={rowKey}>
                          <div
                            onClick={() =>
                              setExpandedKey((prev) => (prev === rowKey ? null : rowKey))
                            }
                            className={`px-4 py-2 transition cursor-pointer flex flex-col lg:grid lg:grid-cols-[minmax(200px,1.8fr)_120px_80px_90px_65px_150px_140px] lg:items-center gap-2 lg:gap-3 text-xs tabular-nums ${
                              isRowExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/35'
                            }`}
                          >
                            {/* Item */}
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
                              {it.buyPressurePct !== undefined && (
                                <span
                                  title="Estimated % of 7d volume bought directly from Sell Orders"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 shrink-0"
                                >
                                  Buy {it.buyPressurePct}%
                                </span>
                              )}
                            </div>

                            {/* 14d Med/d + Trend */}
                            <div className="flex items-center justify-between lg:justify-end gap-1.5">
                              <span className="lg:hidden text-[10px] text-slate-500">14d Med/d:</span>
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-white">{it.med7d.toFixed(1)}</span>
                                <span
                                  title={`14d Median vs 30d Avg (${it.avg30d.toFixed(1)}/d)`}
                                  className="text-[10px] font-semibold text-emerald-400"
                                >
                                  +{it.trendPct.toFixed(0)}%↑
                                </span>
                              </div>
                            </div>

                            {/* 30d Avg/d */}
                            <div className="flex items-center justify-between lg:justify-end">
                              <span className="lg:hidden text-[10px] text-slate-500">30d Avg/d:</span>
                              <span className="text-slate-300">{it.avg30d.toFixed(1)}</span>
                            </div>

                            {/* ISK Vol/d */}
                            <div className="flex items-center justify-between lg:justify-end">
                              <span className="lg:hidden text-[10px] text-slate-500">ISK Vol/d:</span>
                              <span className="font-semibold text-cyan-300">{formatISK(it.iskVol7d, true)}</span>
                            </div>

                            {/* Active Days */}
                            <div className="flex items-center justify-between lg:justify-center">
                              <span className="lg:hidden text-[10px] text-slate-500">Active:</span>
                              <span
                                className={`font-semibold ${
                                  it.activeDays7 >= 11 ? 'text-emerald-400' : 'text-amber-300'
                                }`}
                              >
                                {it.activeDays7}/14d
                              </span>
                            </div>

                            {/* Compact 14d Sparkline */}
                            <div className="h-6 flex items-end gap-0.5" title={`Peak: ${formatInt(maxVol)}/d`}>
                              {it.spark14.map((v, idx) => {
                                const isLast = idx === it.spark14.length - 1;
                                const hPct = Math.max(12, Math.round((v / maxVol) * 100));
                                const barColor =
                                  v === 0
                                    ? 'bg-slate-800/80'
                                    : isLast
                                    ? 'bg-emerald-400/80 hover:bg-emerald-300'
                                    : 'bg-cyan-500/45 hover:bg-cyan-400/85';
                                return (
                                  <div
                                    key={idx}
                                    title={`Day -${it.spark14.length - 1 - idx}: ${formatInt(v)} units`}
                                    className={`flex-1 rounded-t transition-all ${barColor}`}
                                    style={{ height: `${v === 0 ? 12 : hPct}%` }}
                                  />
                                );
                              })}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={originMatchCount === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSearchAllToDest(it.name, it.regionId);
                                }}
                                title={
                                  originMatchCount === 0
                                    ? `No profitable All → ${it.regionName} routes in 98 hubs (both Instant & Sell Order)`
                                    : `Search ${originMatchCount} profitable origin stations → ${it.regionName}`
                                }
                                className={`text-[11px] font-semibold px-2 py-1 rounded border transition tabular-nums ${
                                  originMatchCount === 0
                                    ? 'bg-slate-800/60 border-slate-700/60 text-slate-500 cursor-not-allowed'
                                    : `${theme.pillActive} cursor-pointer`
                                }`}
                              >
                                {originMatchCount > 0 ? `All → Dest (${originMatchCount})` : 'All → Dest'}
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

                          {/* Inline Dropdown Detail */}
                          {isRowExpanded && (
                            <div className="px-4 py-3.5 bg-[#070b14] border-t border-slate-800/80">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                {/* Left Frame: Sellers in Target Region + Sellers Across Hubs below */}
                                <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-3 space-y-3">
                                  {/* Top: Sellers in Target Region */}
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                                      <span className="font-bold text-rose-300">
                                        Sellers in {it.regionName} (Target Region)
                                      </span>
                                      <span className="text-[11px] text-slate-400 tabular-nums">
                                        {regionSellers.length} hubs
                                      </span>
                                    </div>
                                    {regionSellers.length === 0 ? (
                                      <div className="text-[11px] text-slate-500 py-1">
                                        No preloaded hub sell orders in {it.regionName} (low competition / empty market).
                                      </div>
                                    ) : (
                                      <div className="divide-y divide-slate-800/60 max-h-44 overflow-y-auto">
                                        {regionSellers.map((s) => (
                                          <div
                                            key={s.stationId}
                                            className="py-1.5 flex items-center justify-between gap-2 tabular-nums"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="text-[11px] font-medium text-slate-200 truncate">
                                                {s.stationName}
                                              </div>
                                              <div className="text-[10px] text-slate-500">
                                                Top levels:{' '}
                                                {s.levels
                                                  .map(([p, q]) => `${formatISK(p, true)} (${formatInt(q)}x)`)
                                                  .join(' • ')}
                                              </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                              <div className="text-[11px] font-bold text-rose-300">
                                                {formatISK(s.bestPrice)}
                                              </div>
                                              <div className="text-[10px] text-slate-400">
                                                {formatInt(s.totalVol)} units
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Bottom: Sellers Across Hubs */}
                                  <div className="space-y-2 pt-2.5 border-t border-slate-800">
                                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                                      <span className="font-bold text-white">
                                        Sellers Across Hubs (Where to Buy)
                                      </span>
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setSellerSort('price')}
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition ${
                                            sellerSort === 'price' ? theme.pillActive : theme.pillInactive
                                          }`}
                                        >
                                          Cheapest
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setSellerSort('volume')}
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition ${
                                            sellerSort === 'volume' ? theme.pillActive : theme.pillInactive
                                          }`}
                                        >
                                          Most Stock
                                        </button>
                                      </div>
                                    </div>
                                    {globalSellers.length === 0 ? (
                                      <div className="text-[11px] text-slate-500 py-1">
                                        No hub sell orders found in preloaded snapshot.
                                      </div>
                                    ) : (
                                      <div className="divide-y divide-slate-800/60 max-h-44 overflow-y-auto">
                                        {globalSellers.map((s) => (
                                          <div
                                            key={s.stationId}
                                            className="py-1.5 flex items-center justify-between gap-2 tabular-nums"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="text-[11px] font-medium text-slate-200 truncate">
                                                {s.stationName}
                                              </div>
                                              <div className="text-[10px] text-cyan-400/80">
                                                {s.regionName} • {s.security.toFixed(1)}
                                              </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                              <div className="text-[11px] font-bold text-rose-300">
                                                {formatISK(s.bestPrice)}
                                              </div>
                                              <div className="text-[10px] text-slate-400">
                                                {formatInt(s.totalVol)} units
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Right Frame: Buyers Sorted by Highest Price */}
                                <div className="rounded-xl bg-[#0e1526] border border-slate-800 p-3 space-y-2">
                                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                                    <span className="font-bold text-emerald-300">
                                      Buyers Across Hubs (Highest Buy Orders)
                                    </span>
                                    <span className="text-[11px] text-slate-400 tabular-nums">
                                      {allBuyers.length} hubs
                                    </span>
                                  </div>
                                  {highestBuyers.length === 0 ? (
                                    <div className="text-[11px] text-slate-500 py-2">
                                      No hub buy orders found in preloaded snapshot.
                                    </div>
                                  ) : (
                                    <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
                                      {highestBuyers.map((b) => (
                                        <div
                                          key={b.stationId}
                                          className="py-1.5 flex items-center justify-between gap-2 tabular-nums"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                              <span className="text-[11px] font-medium text-slate-200 truncate">
                                                {b.stationName}
                                              </span>
                                              {b.regionId === it.regionId && (
                                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 shrink-0">
                                                  Target Region
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-[10px] text-slate-400">
                                              {b.regionName} • {b.security.toFixed(1)} • Top:{' '}
                                              {b.levels
                                                .map(([p, q]) => `${formatISK(p, true)} (${formatInt(q)}x)`)
                                                .join(' • ')}
                                            </div>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <div className="text-[11px] font-bold text-emerald-300">
                                              {formatISK(b.bestPrice)}
                                            </div>
                                            <div className="text-[10px] text-slate-400">
                                              {formatInt(b.totalVol)} units
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </Fragment>
                      );
                    })}

                    {!isExpandedAll && group.items.length > 12 && (
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
                          Show all {group.items.length} items in {group.regionName}
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
