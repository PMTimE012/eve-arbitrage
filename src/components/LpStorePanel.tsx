import {
  AlertTriangle,
  ArrowUpDown,
  Award,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Search,
  TrendingUp,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { FwLpDataset, MarketDataset, UniverseStationsData } from '../types';
import { formatISK, formatInt, formatStationForCopy, formatVolume } from '../utils/arbitrage';
import {
  evaluateLpOffers,
  type LpSellMethod,
} from '../utils/lpStore';
import type { TradeTheme } from '../utils/theme';
import { ItemImage } from './ItemImage';

interface LpStorePanelProps {
  theme: TradeTheme;
  data: FwLpDataset | null;
  dataset: MarketDataset | null;
  universe: UniverseStationsData | null;
  salesTaxPct: number;
  brokerFeePct: number;
  maxCargo: number;
  loading: boolean;
  error: string | null;
  onOpenInArbitrage: (itemName: string, stationId: number) => void;
}

type LpSortKey =
  | 'iskPerLp'
  | 'netProfitPerRedeem'
  | 'lpCost'
  | 'totalCostPerRedeem'
  | 'avgDailyVol7d'
  | 'totalProfitForLp';

const FACTION_ID_BY_CORP: Record<number, number> = {
  1000180: 500001, // Caldari State
  1000181: 500004, // Gallente Federation
  1000179: 500003, // Amarr Empire
  1000182: 500002, // Minmatar Republic
  1000437: 500010, // Guristas Pirates
  1000436: 500011, // Angel Cartel
};

export function LpStorePanel({
  theme,
  data,
  dataset,
  universe,
  salesTaxPct,
  brokerFeePct,
  maxCargo,
  loading,
  error,
  onOpenInArbitrage,
}: LpStorePanelProps) {
  const [selectedCorpId, setSelectedCorpId] = useState<number>(1000180);
  const [selectedLpStationIdx, setSelectedLpStationIdx] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sellHubKey, setSellHubKey] = useState<string>('jita');
  const [sellMethod, setSellMethod] = useState<LpSellMethod>('instant');
  const [availableLp, setAvailableLp] = useState<number>(100_000);
  const [minIskPerLp, setMinIskPerLp] = useState<number>(0);
  const [minDailyVol, setMinDailyVol] = useState<number>(5);
  const [hideMissingReq, setHideMissingReq] = useState<boolean>(true);
  const [hideUnprofitable, setHideUnprofitable] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<LpSortKey>('iskPerLp');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [expandedOfferId, setExpandedOfferId] = useState<number | null>(null);

  const activeCorp = useMemo(
    () =>
      data?.corporations.find((c) => c.corporationId === selectedCorpId) ??
      data?.corporations[0] ??
      null,
    [data, selectedCorpId]
  );

  const lpStations = useMemo(() => {
    if (!activeCorp) return [];
    const isPirate = activeCorp.corporationId === 1000437 || activeCorp.corporationId === 1000436;
    if (isPirate) {
      const fulcrum = universe?.stations.find((s) => s[1].includes('The Fulcrum'));
      if (fulcrum && universe) {
        const sys = universe.systems[fulcrum[2]];
        return [
          {
            stationId: fulcrum[0],
            name: fulcrum[1],
            systemName: sys ? sys[0] : 'Zarzakh',
            sec: sys ? sys[2] : -1.0,
          },
        ];
      }
      return [
        {
          stationId: 60015187,
          name: 'Zarzakh - Deathless Custodians - The Fulcrum',
          systemName: 'Zarzakh',
          sec: -1.0,
        },
      ];
    }

    if (!universe) return [];
    const list: { stationId: number; name: string; systemName: string; sec: number }[] = [];
    for (const [stationId, name, systemId] of universe.stations) {
      if (!name.includes(activeCorp.name)) continue;
      const sys = universe.systems[systemId];
      list.push({
        stationId,
        name,
        systemName: sys ? sys[0] : name.split(' ')[0],
        sec: sys ? sys[2] : 0,
      });
    }
    list.sort((a, b) => b.sec - a.sec || a.name.localeCompare(b.name));
    return list;
  }, [activeCorp, universe]);

  const activeLpStation = lpStations[selectedLpStationIdx] ?? lpStations[0] ?? null;

  const copyText = (text: string, key: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
  };

  const evaluations = useMemo(() => {
    if (!activeCorp || !dataset) return [];
    return evaluateLpOffers({
      offers: activeCorp.offers,
      dataset,
      sellHubKey,
      sellMethod,
      salesTaxPct,
      brokerFeePct,
      availableLp,
      minIskPerLp,
      minDailyVol,
      hideMissingReq,
      hideUnprofitable,
      searchQuery,
    });
  }, [
    activeCorp,
    dataset,
    sellHubKey,
    sellMethod,
    salesTaxPct,
    brokerFeePct,
    availableLp,
    minIskPerLp,
    minDailyVol,
    hideMissingReq,
    hideUnprofitable,
    searchQuery,
  ]);

  const sortedRows = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  }, [evaluations, sortKey, sortAsc]);

  const handleSort = (key: LpSortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === 'lpCost' || key === 'totalCostPerRedeem');
    }
  };

  return (
    <section className={`rounded-2xl ${theme.card} border p-4 sm:p-5 shadow-xl space-y-4`}>
      {/* Header (matches TrendingMarketsPanel) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${theme.pillActive}`}>
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">
              Faction Warfare LP Store Optimizer
            </h2>
            <p className="text-xs text-slate-400">
              ISK/LP return after required items, sales tax ({salesTaxPct}%), and broker fee ({brokerFeePct}%) • Prices capped by 7d avg
            </p>
          </div>
        </div>
        {data && (
          <div className="text-xs text-slate-400 tabular-nums">
            Showing <strong className="text-white">{formatInt(sortedRows.length)}</strong> of{' '}
            {formatInt(activeCorp?.offers.length ?? 0)} offers
          </div>
        )}
      </div>

      {/* Militia Corporation Selector Pills */}
      {data && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {data.corporations.map((corp) => {
              const active = activeCorp?.corporationId === corp.corporationId;
              return (
                <button
                  key={corp.corporationId}
                  type="button"
                  onClick={() => {
                    setSelectedCorpId(corp.corporationId);
                    setSelectedLpStationIdx(0);
                    setCopiedKey(null);
                    setExpandedOfferId(null);
                  }}
                  className={`text-left rounded-xl border px-3 py-2 transition cursor-pointer flex items-center gap-2.5 ${
                    active ? theme.pillActive : theme.pillInactive
                  }`}
                >
                  <img
                    src={`https://images.evetech.net/corporations/${FACTION_ID_BY_CORP[corp.corporationId] ?? corp.corporationId}/logo?size=128`}
                    alt={corp.factionName}
                    width={44}
                    height={44}
                    loading="lazy"
                    className="w-11 h-11 rounded-lg shrink-0 bg-[#090d16] border border-slate-800/80 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate">{corp.shortName}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {corp.offers.length}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">{corp.name}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* LP Exchange Station Bar + Copy Icon */}
          {activeLpStation ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800/80 bg-[#090d16]/70 px-3 py-2">
              <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-[11px] text-slate-400 shrink-0">LP Store Station:</span>
              {lpStations.length > 1 ? (
                <select
                  value={selectedLpStationIdx}
                  onChange={(e) => {
                    setSelectedLpStationIdx(Number(e.target.value));
                    setCopiedKey(null);
                  }}
                  className="min-w-0 max-w-full bg-[#0e1526] border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  {lpStations.map((st, idx) => (
                    <option key={st.stationId} value={idx}>
                      [{st.sec.toFixed(2)}] {st.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-medium text-slate-100 truncate">
                  [{activeLpStation.sec.toFixed(2)}] {activeLpStation.name}
                </span>
              )}

              <button
                type="button"
                onClick={() => copyText(formatStationForCopy(activeLpStation.name), 'station')}
                title="Copy station name"
                className="p-1 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800 transition cursor-pointer shrink-0"
              >
                {copiedKey === 'station' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800/80 bg-[#090d16]/70 px-3 py-2 text-xs text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Loading LP Store stations...</span>
            </div>
          )}
        </div>
      )}

      {/* Filter Controls (matches TrendingMarketsPanel style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Sell Hub & Strategy */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Sell Hub</label>
            <select
              value={sellHubKey}
              onChange={(e) => setSellHubKey(e.target.value)}
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="jita">Jita 4-4</option>
              <option value="amarr">Amarr VIII</option>
              <option value="dodixie">Dodixie IX-20</option>
              <option value="rens">Rens VI-8</option>
              <option value="hek">Hek VIII-12</option>
              <option value="best">Best of 5 Hubs</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Sell Method</label>
            <select
              value={sellMethod}
              onChange={(e) => setSellMethod(e.target.value as LpSellMethod)}
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="order">Sell Order</option>
              <option value="instant">Instant Sell</option>
            </select>
          </div>
        </div>

        {/* Search */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Filter LP Item</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Navy, Implant, Ammo, Hull..."
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* My LP Balance Presets */}
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            My LP Balance ({formatInt(availableLp)} LP)
          </label>
          <div className="flex gap-1">
            {[
              { label: '50K', val: 50_000 },
              { label: '100K', val: 100_000 },
              { label: '250K', val: 250_000 },
              { label: '500K', val: 500_000 },
              { label: '1M', val: 1_000_000 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setAvailableLp(p.val)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                  availableLp === p.val ? theme.pillActive : theme.pillInactive
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Min Daily Vol & Min ISK/LP */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Min 7d Vol/d</label>
            <div className="flex gap-1">
              {[0, 5, 20, 100].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMinDailyVol(v)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                    minDailyVol === v ? theme.pillActive : theme.pillInactive
                  }`}
                >
                  {v === 0 ? 'All' : `${v}+`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Min ISK / LP</label>
            <select
              value={minIskPerLp}
              onChange={(e) => setMinIskPerLp(Number(e.target.value))}
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value={0}>Any (&gt;0)</option>
              <option value={500}>500+ ISK/LP</option>
              <option value={1000}>1,000+ ISK/LP</option>
              <option value={1500}>1,500+ ISK/LP</option>
              <option value={2000}>2,000+ ISK/LP</option>
            </select>
          </div>
        </div>
      </div>

      {/* Secondary toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideUnprofitable}
              onChange={(e) => setHideUnprofitable(e.target.checked)}
              className="rounded border-slate-700 bg-[#090d16] accent-cyan-500"
            />
            <span>Profitable only (&gt;0 ISK/LP)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideMissingReq}
              onChange={(e) => setHideMissingReq(e.target.checked)}
              className="rounded border-slate-700 bg-[#090d16] accent-cyan-500"
            />
            <span>Hide missing req. prices</span>
          </label>
        </div>
        {maxCargo > 0 && (
          <span className="text-[11px] text-slate-500 tabular-nums">
            Hauling capacity: {formatVolume(maxCargo)} (from Arbitrage settings)
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-14 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <span>Loading Faction Warfare LP Store offers...</span>
        </div>
      ) : error ? (
        <div className="py-10 text-center text-xs text-rose-400">{error}</div>
      ) : !dataset ? (
        <div className="py-10 text-center text-xs text-slate-400">Waiting for market dataset...</div>
      ) : sortedRows.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No LP offers match current filters. Try lowering Min 7d Vol/d or switching Sell Hub.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800/90 bg-[#090d16]/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b ${theme.tableHead} text-[11px] uppercase tracking-wider text-slate-400`}>
                  <th className="py-2.5 px-3 w-8" />
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('lpCost')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      <span>LP Cost</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('totalCostPerRedeem')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      <span>ISK + Req.</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">Sell Price</th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('netProfitPerRedeem')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      <span>Net Profit</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('iskPerLp')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      <span>ISK / LP</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('avgDailyVol7d')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      <span>7d Vol/d</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  {availableLp > 0 && (
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('totalProfitForLp')}
                        className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                      >
                        <span>For {formatInt(availableLp / 1000)}K LP</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {sortedRows.slice(0, 150).map((row) => {
                  const isExpanded = expandedOfferId === row.offerId;
                  const tripsNeeded =
                    maxCargo > 0 && row.totalVolumeForLp > 0
                      ? Math.ceil(row.totalVolumeForLp / maxCargo)
                      : null;

                  return (
                    <Fragment key={row.offerId}>
                      <tr
                        onClick={() => setExpandedOfferId(isExpanded ? null : row.offerId)}
                        className="group hover:bg-white/[0.03] transition cursor-pointer"
                      >
                        <td className="py-2.5 px-3 text-slate-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <ItemImage typeId={row.typeId} name={row.name} size={32} />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                                <span className="truncate max-w-[260px]">{row.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyText(row.name, `item:${row.offerId}`);
                                  }}
                                  title="Copy item name"
                                  className="p-1 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition cursor-pointer shrink-0"
                                >
                                  {copiedKey === `item:${row.offerId}` ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                {row.quantity > 1 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                                    ×{formatInt(row.quantity)}
                                  </span>
                                )}
                                {row.priceCappedByHist && (
                                  <span
                                    title={`Sell price capped at 7d avg (${formatISK(row.grossSellUnitPrice)}) vs current lowest sell (${formatISK(row.rawSellUnitPrice)})`}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                                  >
                                    7d cap
                                  </span>
                                )}
                                {row.missingReqPrice && (
                                  <span
                                    title="One or more required items have no orders at this hub"
                                    className="text-amber-400"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                                <span>{row.sellHub.name}</span>
                                <span>•</span>
                                <span>{formatVolume(row.unitVolume * row.quantity)}</span>
                                {row.trendPct7d !== null && (
                                  <>
                                    <span>•</span>
                                    <span
                                      className={
                                        row.trendPct7d >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                      }
                                    >
                                      {row.trendPct7d >= 0 ? '+' : ''}
                                      {row.trendPct7d.toFixed(1)}% 7d
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-200 font-medium">
                          {formatInt(row.lpCost)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {formatISK(row.totalCostPerRedeem)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-200">
                          {formatISK(row.grossSellUnitPrice)}
                          {row.quantity > 1 && (
                            <div className="text-[10px] text-slate-500">each</div>
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums font-semibold ${
                            row.netProfitPerRedeem > 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatISK(row.netProfitPerRedeem)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold ${
                              row.iskPerLp >= 1500
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                : row.iskPerLp >= 800
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : row.iskPerLp > 0
                                ? 'bg-slate-800 text-slate-200'
                                : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {formatInt(Math.round(row.iskPerLp))}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <div className={row.lowLiquidity ? 'text-amber-400' : 'text-slate-300'}>
                            {row.avgDailyVol7d !== null ? formatInt(Math.round(row.avgDailyVol7d)) : '—'}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {row.activeDays14d !== null ? `${row.activeDays14d}/14d` : ''} B:{formatInt(row.hubBuyVol)}
                          </div>
                        </td>
                        {availableLp > 0 && (
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <div className="font-semibold text-emerald-400">
                              {row.maxRedemptionsFromLp > 0 ? formatISK(row.totalProfitForLp) : '—'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {row.maxRedemptionsFromLp > 0
                                ? `${formatInt(row.maxRedemptionsFromLp)}×${tripsNeeded ? ` • ${tripsNeeded} trip${tripsNeeded > 1 ? 's' : ''}` : ''}`
                                : 'Insufficient LP'}
                            </div>
                          </td>
                        )}
                      </tr>

                      {isExpanded && (
                        <tr className={`border-b ${theme.expandedRow}`}>
                          <td colSpan={availableLp > 0 ? 9 : 8} className="p-4">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                              {/* Cost & Required Items Breakdown */}
                              <div className={`rounded-xl ${theme.subCard} border p-3 space-y-2`}>
                                <div className="font-semibold text-slate-200 flex items-center justify-between">
                                  <span>Redemption Cost (1× Offer)</span>
                                  <span className="font-mono text-cyan-300">{formatInt(row.lpCost)} LP</span>
                                </div>
                                <div className="space-y-1 text-slate-300">
                                  <div className="flex justify-between">
                                    <span>ISK Fee:</span>
                                    <span className="font-mono">{formatISK(row.iskCost)}</span>
                                  </div>
                                  {row.requiredItemsDetail.map((req) => (
                                    <div key={req.typeId} className="flex justify-between gap-2 text-[11px]">
                                      <span className="text-slate-400 truncate">
                                        {formatInt(req.quantity)}× {req.name}
                                      </span>
                                      <span className="font-mono shrink-0">
                                        {req.totalPrice !== null ? (
                                          formatISK(req.totalPrice)
                                        ) : (
                                          <span className="text-amber-400">No orders</span>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="border-t border-slate-800 pt-1 flex justify-between font-semibold text-white">
                                    <span>Total ISK Cost:</span>
                                    <span className="font-mono">{formatISK(row.totalCostPerRedeem)}</span>
                                  </div>
                                </div>
                                <div className="border-t border-slate-800 pt-2 space-y-1 text-slate-300">
                                  <div className="flex justify-between">
                                    <span>Net Revenue ({row.sellHub.name}):</span>
                                    <span className="font-mono">{formatISK(row.netRevenuePerRedeem)}</span>
                                  </div>
                                  <div className="flex justify-between font-semibold">
                                    <span>Net Profit / Redeem:</span>
                                    <span
                                      className={`font-mono ${
                                        row.netProfitPerRedeem > 0 ? 'text-emerald-400' : 'text-rose-400'
                                      }`}
                                    >
                                      {formatISK(row.netProfitPerRedeem)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Hub Order Book (Top 5 Sell & Buy at Sell Hub) */}
                              <div className={`rounded-xl ${theme.subCard} border p-3 space-y-2`}>
                                <div className="font-semibold text-slate-200">
                                  {row.sellHub.name} Order Book
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-[11px]">
                                  <div>
                                    <div className="text-rose-300 font-medium mb-1">
                                      Lowest Sells ({formatInt(row.hubSellVol)})
                                    </div>
                                    <div className="space-y-0.5 font-mono tabular-nums text-slate-300">
                                      {row.destSells.length === 0 ? (
                                        <div className="text-slate-500">None</div>
                                      ) : (
                                        row.destSells.slice(0, 5).map(([p, v], i) => (
                                          <div key={i} className="flex justify-between">
                                            <span>{formatISK(p)}</span>
                                            <span className="text-slate-500">×{formatInt(v)}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-emerald-300 font-medium mb-1">
                                      Highest Buys ({formatInt(row.hubBuyVol)})
                                    </div>
                                    <div className="space-y-0.5 font-mono tabular-nums text-slate-300">
                                      {row.destBuys.length === 0 ? (
                                        <div className="text-slate-500">None</div>
                                      ) : (
                                        row.destBuys.slice(0, 5).map(([p, v], i) => (
                                          <div key={i} className="flex justify-between">
                                            <span>{formatISK(p)}</span>
                                            <span className="text-slate-500">×{formatInt(v)}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Hauling & Cross-Tab Actions */}
                              <div className={`rounded-xl ${theme.subCard} border p-3 space-y-2 flex flex-col justify-between`}>
                                <div className="space-y-1.5">
                                  <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>Hauling &amp; Actions</span>
                                  </div>
                                  <div className="flex justify-between text-slate-300">
                                    <span>Volume / Redeem:</span>
                                    <span className="font-mono">
                                      {formatVolume(row.unitVolume * row.quantity)}
                                    </span>
                                  </div>
                                  {availableLp > 0 && row.maxRedemptionsFromLp > 0 && (
                                    <>
                                      <div className="flex justify-between text-slate-300">
                                        <span>Total ISK Needed:</span>
                                        <span className="font-mono">{formatISK(row.totalIskRequiredForLp)}</span>
                                      </div>
                                      <div className="flex justify-between text-slate-300">
                                        <span>Total Cargo ({formatInt(row.maxRedemptionsFromLp)}×):</span>
                                        <span className="font-mono">
                                          {formatVolume(row.totalVolumeForLp)}
                                          {tripsNeeded ? ` (${tripsNeeded} trip${tripsNeeded > 1 ? 's' : ''})` : ''}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>

                                <div className="flex flex-wrap gap-2 pt-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenInArbitrage(row.name, row.sellHub.stationId);
                                    }}
                                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${theme.pillActive}`}
                                  >
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    <span>Check in Arbitrage</span>
                                  </button>
                                  <a
                                    href={`https://evetycoon.com/market/${row.typeId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition ${theme.pillInactive}`}
                                  >
                                    <span>EVE Tycoon</span>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
