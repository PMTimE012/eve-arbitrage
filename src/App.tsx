import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  ArrowUpDown,
  Award,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  Flame,
  Loader2,
  Package,
  RefreshCw,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Skull,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import type {
  ArbitrageOpportunity,
  BuyMethod,
  EmpireInstantDataset,
  FwLpDataset,
  FwStationInfo,
  HubBook,
  JumpFilter,
  LiquidityTier,
  MarketDataset,
  RouteInfo,
  StationOption,
  SystemActivity,
  TradeMode,
  TrendingDataset,
  UniverseStationsData,
} from './types';
import { ItemImage } from './components/ItemImage';
import { OrderBookGrid } from './components/OrderBookGrid';
import { ALL_HUBS_OPTION, StationSelector } from './components/StationSelector';
import { LpStorePanel } from './components/LpStorePanel';
import { TrendingMarketsPanel } from './components/TrendingMarketsPanel';
import { TripItemModal } from './components/TripItemModal';
import { TripPlansPanel } from './components/TripPlansPanel';
import { VolumeComparison } from './components/VolumeComparison';
import { getTradeTheme } from './utils/theme';
import {
  calculateAllHubsArbitrage,
  calculateAllOriginHubsArbitrage,
  calculateAllToAllArbitrage,
  calculateArbitrage,
  formatISK,
  formatInt,
  formatVolume,
} from './utils/arbitrage';
import {
  fetchRouteBetweenSystems,
  fetchSystemActivityMap,
  fetchTopFwStations,
  loadStationMarketBook,
  summarizeStationBook,
} from './utils/esiClient';
import { fetchDestDailyVolume, type DailyVolumeStats } from './utils/history';
import { getSystemJumpMap, type RoutePreference } from './utils/routing';
import {
  generateTripPlans,
  type TripItemPick,
  type TripPlan,
} from './utils/tripPlanner';

type SortKey =
  | 'tradeScore'
  | 'totalProfit'
  | 'roiPct'
  | 'profitPerM3'
  | 'totalCost'
  | 'profitPerUnit'
  | 'recommendedQty';

export function App() {
  const [dataset, setDataset] = useState<MarketDataset | null>(null);
  const [empireData, setEmpireData] = useState<EmpireInstantDataset | null>(null);
  const [empireLoading, setEmpireLoading] = useState(false);
  const [universe, setUniverse] = useState<UniverseStationsData | null>(null);
  const [activityMap, setActivityMap] = useState<Record<number, SystemActivity>>({});
  const [fwStations, setFwStations] = useState<FwStationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Section 1: Origin & Destination
  const [originStation, setOriginStation] = useState<StationOption | null>(null);
  const [destStation, setDestStation] = useState<StationOption | null>(null);
  const [originBook, setOriginBook] = useState<Record<string, HubBook> | null>(null);
  const [destBook, setDestBook] = useState<Record<string, HubBook> | null>(null);
  const [originProgress, setOriginProgress] = useState<string | null>(null);
  const [destProgress, setDestProgress] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  // Section 0 & 2: Buy/Sell Strategy (Alpha-friendly defaults)
  const [buyMethod, setBuyMethod] = useState<BuyMethod>('instant');
  const [tradeMode, setTradeMode] = useState<TradeMode>('instant');
  const [maxBudget, setMaxBudget] = useState<number>(15_000_000);
  const [maxCargo, setMaxCargo] = useState<number>(650);
  const [salesTaxPct, setSalesTaxPct] = useState<number>(7.5);
  const [brokerFeePct, setBrokerFeePct] = useState<number>(3.3);
  const [minRoiPct, setMinRoiPct] = useState<number>(5);
  const [minProfit, setMinProfit] = useState<number>(3_000);
  const [liquidityTier, setLiquidityTier] = useState<LiquidityTier>('all');
  const [jumpFilter, setJumpFilter] = useState<JumpFilter>('all');
  const routePref: RoutePreference = 'shortest';
  const [skipBaitOrders, setSkipBaitOrders] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Section 3: Table & Inline Dropdown Row
  const [sortKey, setSortKey] = useState<SortKey>('tradeScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyStats, setHistoryStats] = useState<DailyVolumeStats | null>(null);
  const [originHistoryStats, setOriginHistoryStats] = useState<DailyVolumeStats | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedStationKey, setCopiedStationKey] = useState<string | null>(null);
  const [copiedPlanId, setCopiedPlanId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);

  // Auto-Fill Ship (5 Trip Plans)
  const [maxStops, setMaxStops] = useState<number>(4);
  const [showTripPlans, setShowTripPlans] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'arbitrage' | 'trending' | 'lp'>('arbitrage');
  const [trendingData, setTrendingData] = useState<TrendingDataset | null>(null);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [lpData, setLpData] = useState<FwLpDataset | null>(null);
  const [lpLoading, setLpLoading] = useState(false);
  const [lpError, setLpError] = useState<string | null>(null);
  const [tripPopupItem, setTripPopupItem] = useState<TripItemPick | null>(null);
  const [tripHistoryStats, setTripHistoryStats] = useState<DailyVolumeStats | null>(null);
  const [tripOriginHistoryStats, setTripOriginHistoryStats] = useState<DailyVolumeStats | null>(null);
  const [tripHistoryLoading, setTripHistoryLoading] = useState(false);
  const [tripHistoryError, setTripHistoryError] = useState<string | null>(null);
  const [liveAutoRefresh, setLiveAutoRefresh] = useState<boolean>(true);
  const [liveSyncing, setLiveSyncing] = useState<boolean>(false);
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<number | null>(null);
  const [liveSyncTick, setLiveSyncTick] = useState<number>(0);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mktRes, uniRes] = await Promise.all([
        fetch(`./data/market-hubs.json?t=${Date.now()}`),
        fetch(`./data/universe-stations.json`),
      ]);
      if (!mktRes.ok) throw new Error(`Failed to load market data (HTTP ${mktRes.status})`);
      if (!uniRes.ok) throw new Error(`Failed to load universe stations (HTTP ${uniRes.status})`);

      const mktJson: MarketDataset = await mktRes.json();
      const uniJson: UniverseStationsData = await uniRes.json();

      setDataset(mktJson);
      setUniverse(uniJson);
      if (mktJson.fwStations) {
        setFwStations(mktJson.fwStations);
      }

      if (!originStation) {
        setOriginStation(ALL_HUBS_OPTION);
      }
      if (!destStation && mktJson.topStations.length > 0) {
        setDestStation(mktJson.topStations[0]);
      }

      fetchSystemActivityMap()
        .then((act) => {
          setActivityMap(act);
          return fetchTopFwStations(uniJson, act);
        })
        .then(setFwStations)
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load Origin Station Book
  useEffect(() => {
    if (!dataset || !originStation) return;
    if (originStation.stationId === -1) {
      setOriginBook(null);
      setOriginProgress(null);
      return;
    }
    let cancelled = false;
    setExpandedId(null);
    const isPreloaded = Boolean(dataset.orders[String(originStation.stationId)]);
    if (!isPreloaded) setOriginBook(null);
    setOriginProgress(isPreloaded ? null : 'Connecting to ESI...');
    loadStationMarketBook(originStation, dataset, (done, total) => {
      if (!cancelled) setOriginProgress(`Loading ${originStation.regionName} (${done}/${total})`);
    })
      .then((book) => {
        if (!cancelled) {
          setOriginBook(book);
          setOriginProgress(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed loading origin orders');
          setOriginProgress(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, originStation]);

  // Load Destination Station Book
  useEffect(() => {
    if (!dataset || !destStation) return;
    if (destStation.stationId === -1) {
      setDestBook(null);
      setDestProgress(null);
      return;
    }
    let cancelled = false;
    setExpandedId(null);
    const isPreloaded = Boolean(dataset.orders[String(destStation.stationId)]);
    if (!isPreloaded) setDestBook(null);
    setDestProgress(isPreloaded ? null : 'Connecting to ESI...');
    loadStationMarketBook(destStation, dataset, (done, total) => {
      if (!cancelled) setDestProgress(`Loading ${destStation.regionName} (${done}/${total})`);
    })
      .then((book) => {
        if (!cancelled) {
          setDestBook(book);
          setDestProgress(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed loading destination orders');
          setDestProgress(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, destStation]);

  // Live 5-minute ESI auto-refresh for selected Origin/Destination stations (paused when tab/app is hidden)
  useEffect(() => {
    if (!liveAutoRefresh || !dataset || !originStation || !destStation) return;
    const hasOrigin = originStation.stationId !== -1;
    const hasDest = destStation.stationId !== -1;
    if (!hasOrigin && !hasDest) return;

    let cancelled = false;
    let lastAttemptAt = 0;
    const SYNC_INTERVAL_MS = 5 * 60 * 1000;

    const runLiveSync = async () => {
      if (cancelled || document.hidden) return;
      lastAttemptAt = Date.now();
      setLiveSyncing(true);
      try {
        const [freshOrigin, freshDest] = await Promise.all([
          hasOrigin ? loadStationMarketBook(originStation, dataset, undefined, true) : null,
          hasDest ? loadStationMarketBook(destStation, dataset, undefined, true) : null,
        ]);
        if (cancelled) return;
        if (freshOrigin) setOriginBook(freshOrigin);
        if (freshDest) setDestBook(freshDest);
        setLastLiveSyncAt(Date.now());
      } catch {
        // Keep existing books on transient ESI error
      } finally {
        if (!cancelled) setLiveSyncing(false);
      }
    };

    // If snapshot is already older than 5m (or manual trigger), sync immediately in background
    const snapshotAgeMs = dataset.updatedAt
      ? Date.now() - new Date(dataset.updatedAt).getTime()
      : Infinity;
    if (!document.hidden && (snapshotAgeMs > SYNC_INTERVAL_MS || liveSyncTick > 0)) {
      void runLiveSync();
    }

    const timer = setInterval(() => {
      if (!document.hidden) {
        void runLiveSync();
      }
    }, SYNC_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastAttemptAt >= SYNC_INTERVAL_MS) {
        void runLiveSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [liveAutoRefresh, dataset, originStation, destStation, liveSyncTick]);

  // Load Route Jumps
  useEffect(() => {
    if (!dataset || !originStation || !destStation) return;
    if (originStation.stationId === -1 || destStation.stationId === -1) {
      setRouteInfo(null);
      return;
    }
    if (originStation.stationId === destStation.stationId) {
      setRouteInfo({ secureJumps: 0, shortestJumps: 0 });
      return;
    }

    const pre = dataset.routes[`${originStation.systemId}->${destStation.systemId}`];
    if (pre) {
      setRouteInfo(pre);
      return;
    }

    let cancelled = false;
    fetchRouteBetweenSystems(originStation.systemId, destStation.systemId)
      .then((info) => {
        if (!cancelled) setRouteInfo(info);
      })
      .catch(() => {
        if (!cancelled) setRouteInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, originStation, destStation]);

  // Smoothly scroll expanded item dropdown to the center of the viewport
  useEffect(() => {
    if (!expandedId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`expanded-${expandedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => clearTimeout(timer);
  }, [expandedId]);

  const isOriginAll = originStation?.stationId === -1;
  const isDestAll = destStation?.stationId === -1;
  const isBothAll = isOriginAll && isDestAll;

  const activeJumpMap = useMemo(() => {
    if (!universe || !originStation || !destStation || isBothAll) return null;
    const anchor = isOriginAll ? destStation : originStation;
    return getSystemJumpMap(anchor.systemId, universe, routePref);
  }, [universe, originStation, destStation, isOriginAll, isBothAll, routePref]);

  const scannedStationCount = useMemo(() => {
    if (!dataset || !originStation || !destStation || isBothAll) return 0;
    if (!isOriginAll && !isDestAll) return 1;

    const specificStation = isOriginAll ? destStation : originStation;
    const hubJumps = dataset.jumpsFromHubs?.[String(specificStation.stationId)];

    const seen = new Set<number>();
    const matchesJump = (systemId: number): boolean => {
      if (tradeMode !== 'instant' || jumpFilter === 'all') return true;
      const j =
        activeJumpMap?.get(systemId) ??
        dataset.routes[`${specificStation.systemId}->${systemId}`]?.shortestJumps ??
        dataset.routes[`${systemId}->${specificStation.systemId}`]?.shortestJumps ??
        hubJumps?.[String(systemId)];
      if (j === undefined) return false;
      if (jumpFilter === 'le5') return j <= 5;
      if (jumpFilter === 'le10') return j <= 10;
      if (jumpFilter === 'le15') return j <= 15;
      return true;
    };

    for (const s of [...dataset.topStations, ...(dataset.fwStations ?? [])]) {
      if (s.stationId === specificStation.stationId) continue;
      if (!dataset.orders[String(s.stationId)]) continue;
      if (matchesJump(s.systemId)) seen.add(s.stationId);
    }

    if (tradeMode === 'instant' && empireData) {
      for (const st of Object.values(empireData.stations)) {
        if (st.stationId === specificStation.stationId) continue;
        if (matchesJump(st.systemId)) seen.add(st.stationId);
      }
    }

    return seen.size;
  }, [dataset, empireData, originStation, destStation, isOriginAll, isDestAll, isBothAll, tradeMode, jumpFilter, routePref, activeJumpMap]);

  // Lazy-load empire-instant.json when Instant Sell + All Stations is active
  useEffect(() => {
    if (tradeMode !== 'instant' || (!isOriginAll && !isDestAll) || empireData) return;
    let cancelled = false;
    setEmpireLoading(true);
    fetch(`./data/empire-instant.json?t=${Date.now()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: EmpireInstantDataset | null) => {
        if (!cancelled && json) setEmpireData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEmpireLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tradeMode, isOriginAll, isDestAll, empireData]);

  const rawScan = useMemo(() => {
    if (!dataset || !originStation || !destStation) {
      return { list: [] as ArbitrageOpportunity[], tripCandidates: [] as ArbitrageOpportunity[] };
    }
    if (!isOriginAll && !originBook) {
      return { list: [] as ArbitrageOpportunity[], tripCandidates: [] as ArbitrageOpportunity[] };
    }
    if (!isDestAll && !destBook) {
      return { list: [] as ArbitrageOpportunity[], tripCandidates: [] as ArbitrageOpportunity[] };
    }
    if (!isOriginAll && !isDestAll && originStation.stationId === destStation.stationId) {
      return { list: [] as ArbitrageOpportunity[], tripCandidates: [] as ArbitrageOpportunity[] };
    }

    const activeJumpFilter = tradeMode === 'instant' ? jumpFilter : 'all';
    const trimmedSearch = searchQuery.trim();
    const keepAllPerItem = trimmedSearch.length >= 2;
    const scanSearch = keepAllPerItem ? trimmedSearch : '';

    let list: ArbitrageOpportunity[] = [];
    const tripCandidates: ArbitrageOpportunity[] = [];

    if (isBothAll) {
      const getJumpsBetween = universe
        ? (fromSys: number, toSys: number) =>
            getSystemJumpMap(fromSys, universe, routePref)?.get(toSys)
        : undefined;
      list = calculateAllToAllArbitrage(
        dataset,
        {
          buyMethod,
          tradeMode,
          maxBudget,
          maxCargo,
          salesTaxPct,
          brokerFeePct,
          minRoiPct,
          minProfit,
          liquidityTier,
          jumpFilter: activeJumpFilter,
          skipBaitOrders,
          searchQuery: '',
        },
        empireData,
        getJumpsBetween,
        tripCandidates
      );
    } else if (isDestAll && originBook) {
      list = calculateAllHubsArbitrage(
        dataset,
        originStation.systemId,
        originStation.stationId,
        {
          originBook,
          buyMethod,
          tradeMode,
          maxBudget,
          maxCargo,
          salesTaxPct,
          brokerFeePct,
          minRoiPct,
          minProfit,
          liquidityTier,
          jumpFilter: activeJumpFilter,
          skipBaitOrders,
          searchQuery: scanSearch,
          originRegionId: originStation.regionId,
        },
        empireData,
        activeJumpMap,
        routePref,
        tripCandidates,
        keepAllPerItem
      );
    } else if (isOriginAll && destBook) {
      list = calculateAllOriginHubsArbitrage(
        dataset,
        destStation.systemId,
        destStation.stationId,
        {
          destBook,
          buyMethod,
          tradeMode,
          maxBudget,
          maxCargo,
          salesTaxPct,
          brokerFeePct,
          minRoiPct,
          minProfit,
          liquidityTier,
          jumpFilter: activeJumpFilter,
          skipBaitOrders,
          searchQuery: scanSearch,
          destRegionId: destStation.regionId,
        },
        empireData,
        activeJumpMap,
        routePref,
        tripCandidates,
        keepAllPerItem
      );
    } else if (originBook && destBook) {
      const singleJumps =
        activeJumpMap?.get(destStation.systemId) ?? routeInfo?.shortestJumps;
      list = calculateArbitrage(dataset, {
        originBook,
        destBook,
        buyMethod,
        tradeMode,
        maxBudget,
        maxCargo,
        salesTaxPct,
        brokerFeePct,
        minRoiPct,
        minProfit,
        liquidityTier,
        jumpFilter: activeJumpFilter,
        skipBaitOrders,
        searchQuery: '',
        routeJumps: singleJumps,
        originRegionId: originStation.regionId,
        destRegionId: destStation.regionId,
      });
    }

    return {
      list,
      tripCandidates: tripCandidates.length > 0 ? tripCandidates : list,
    };
  }, [
    dataset,
    empireData,
    originBook,
    destBook,
    originStation,
    destStation,
    isOriginAll,
    isDestAll,
    isBothAll,
    buyMethod,
    tradeMode,
    maxBudget,
    maxCargo,
    salesTaxPct,
    brokerFeePct,
    minRoiPct,
    minProfit,
    liquidityTier,
    jumpFilter,
    routePref,
    activeJumpMap,
    skipBaitOrders,
    universe,
    searchQuery.trim().length >= 2 ? searchQuery.trim() : '',
    routeInfo?.secureJumps,
    routeInfo?.shortestJumps,
  ]);

  const opportunities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? rawScan.list.filter((item) => item.name.toLowerCase().includes(query))
      : [...rawScan.list];

    filtered.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortAsc ? diff : -diff;
    });

    return filtered;
  }, [rawScan.list, searchQuery, sortKey, sortAsc]);

  const visibleRows = useMemo(
    () => opportunities.slice(0, pageSize),
    [opportunities, pageSize]
  );

  const getRowKey = (row: ArbitrageOpportunity) =>
    `${row.typeId}:${row.originStationId ?? 0}:${row.destStationId ?? 0}`;

  const expandedItem = useMemo(
    () => (expandedId ? opportunities.find((o) => getRowKey(o) === expandedId) ?? null : null),
    [expandedId, opportunities]
  );

  // Load Origin & Dest 30-day History when an item row is expanded
  useEffect(() => {
    const destRegId = expandedItem?.destRegionId ?? destStation?.regionId;
    const origRegId = expandedItem?.originRegionId ?? originStation?.regionId;
    const hasDest = Boolean(destRegId && destRegId !== -1);
    const hasOrig = Boolean(origRegId && origRegId !== -1);
    if (!expandedItem || (!hasDest && !hasOrig)) {
      setHistoryStats(null);
      setOriginHistoryStats(null);
      setHistoryError(null);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    Promise.all([
      hasOrig ? fetchDestDailyVolume(origRegId!, expandedItem.typeId) : Promise.resolve(null),
      hasDest
        ? destRegId === origRegId
          ? Promise.resolve(null)
          : fetchDestDailyVolume(destRegId!, expandedItem.typeId)
        : Promise.resolve(null),
    ])
      .then(([origStats, destStats]) => {
        if (!cancelled) {
          setOriginHistoryStats(origStats);
          setHistoryStats(destRegId === origRegId ? origStats : destStats);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    expandedId,
    expandedItem?.destRegionId,
    expandedItem?.originRegionId,
    destStation?.regionId,
    originStation?.regionId,
  ]);

  const originSummary = useMemo(() => summarizeStationBook(originBook), [originBook]);
  const destSummary = useMemo(() => summarizeStationBook(destBook), [destBook]);

  const originActivity = originStation ? activityMap[originStation.systemId] : undefined;
  const destActivity = destStation ? activityMap[destStation.systemId] : undefined;

  const handleSwapStations = () => {
    setExpandedId(null);
    setOriginStation(destStation);
    setDestStation(originStation);
    setOriginBook(destBook);
    setDestBook(originBook);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const handleToggleRow = (row: ArbitrageOpportunity) => {
    const key = getRowKey(row);
    setExpandedId((prev) => (prev === key ? null : key));
  };

  const handleCopyName = (e: React.MouseEvent, typeId: number, name: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(name);
    setCopiedId(typeId);
    setTimeout(() => setCopiedId((prev) => (prev === typeId ? null : prev)), 1500);
  };

  const handleCopyStation = (e: React.MouseEvent, key: string, stationName: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(stationName);
    setCopiedStationKey(key);
    setTimeout(() => setCopiedStationKey((prev) => (prev === key ? null : prev)), 1500);
  };

  const handleCopyPlan = (plan: TripPlan) => {
    const lines: string[] = [
      `[${plan.title}] (${buyMethod === 'order' ? 'BUY ORDER' : 'INSTANT BUY'} -> ${tradeMode === 'instant' ? 'INSTANT SELL' : 'SELL ORDER'} | ${routePref.toUpperCase()})`,
      `Route: ${originStation?.stationName ?? '?'} -> ${destStation?.stationName ?? '?'}`,
      `Net Profit: +${formatISK(plan.totalProfit, true)} ISK | Cost: ${formatISK(plan.totalCost, true)} ISK | Jumps: ${plan.totalJumps}j (${formatISK(plan.iskPerJump, true)}/j)`,
      `Cargo: ${plan.cargoFillPct !== null ? `${plan.cargoFillPct.toFixed(0)}%` : '∞'} (${formatVolume(plan.totalVolume)}) | Budget: ${plan.budgetUsedPct !== null ? `${plan.budgetUsedPct.toFixed(0)}%` : '∞'} | Avg Score: ${plan.avgScore}`,
      `Route Kills (1h): ${plan.routeShipKills1h} ships${plan.hottestSystem ? ` (Hot: ${plan.hottestSystem.name} ${plan.hottestSystem.kills})` : ''}`,
      '--- Stops ---',
    ];
    for (const stop of plan.stops) {
      const secStr = stop.security !== null ? `sec ${stop.security.toFixed(1)}` : 'sec ?';
      lines.push(`* (${stop.jumpsFromPrev}j) [${secStr}] ${stop.stationName} | Stop Profit: +${formatISK(stop.stopProfit, true)} ISK`);
      for (const it of stop.items) {
        lines.push(
          `  - ${formatInt(it.qty)}x ${it.name} (ID:${it.typeId}) | Buy: ${formatISK(it.buyPrice)} | Sell: ${formatISK(it.sellPrice)} | Profit: +${formatISK(it.totalProfit, true)} | ROI: +${it.roiPct.toFixed(1)}% | Score: ${it.tradeScore}`
        );
      }
    }
    if (plan.finalDestName) {
      lines.push(`-> Final Dest (+${plan.jumpsToFinalDest}j): ${plan.finalDestName}`);
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedPlanId(plan.id);
    setTimeout(() => setCopiedPlanId((prev) => (prev === plan.id ? null : prev)), 1500);
  };

  const tripPlans = useMemo<TripPlan[] | null>(() => {
    if (!showTripPlans) return null;
    return generateTripPlans({
      opportunities: rawScan.tripCandidates,
      originStation,
      destStation,
      universe,
      activityMap,
      buyMethod,
      tradeMode,
      routePref,
      maxBudget,
      maxCargo,
      maxStops,
      minProfit,
    });
  }, [
    showTripPlans,
    rawScan.tripCandidates,
    originStation,
    destStation,
    universe,
    activityMap,
    buyMethod,
    tradeMode,
    routePref,
    maxBudget,
    maxCargo,
    maxStops,
    minProfit,
  ]);

  const handleGenerateTripPlans = () => {
    setShowTripPlans(true);
  };

  // Load Origin & Dest 30-day History when a Trip Plan item popup is opened
  useEffect(() => {
    const destRegId = tripPopupItem?.opp.destRegionId ?? destStation?.regionId;
    const origRegId = tripPopupItem?.opp.originRegionId ?? originStation?.regionId;
    const hasDest = Boolean(destRegId && destRegId !== -1);
    const hasOrig = Boolean(origRegId && origRegId !== -1);
    if (!tripPopupItem || (!hasDest && !hasOrig)) {
      setTripHistoryStats(null);
      setTripOriginHistoryStats(null);
      setTripHistoryError(null);
      return;
    }

    let cancelled = false;
    setTripHistoryLoading(true);
    setTripHistoryError(null);
    Promise.all([
      hasOrig ? fetchDestDailyVolume(origRegId!, tripPopupItem.typeId) : Promise.resolve(null),
      hasDest
        ? destRegId === origRegId
          ? Promise.resolve(null)
          : fetchDestDailyVolume(destRegId!, tripPopupItem.typeId)
        : Promise.resolve(null),
    ])
      .then(([origStats, destStats]) => {
        if (!cancelled) {
          setTripOriginHistoryStats(origStats);
          setTripHistoryStats(destRegId === origRegId ? origStats : destStats);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTripHistoryError(err instanceof Error ? err.message : 'Failed to load history');
        }
      })
      .finally(() => {
        if (!cancelled) setTripHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    tripPopupItem,
    destStation?.regionId,
    originStation?.regionId,
  ]);

  // Close Trip Plan popup on Escape key
  useEffect(() => {
    if (!tripPopupItem) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTripPopupItem(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tripPopupItem]);

  // Close stale item popup when route or mode changes (keep trip plans auto-updating)
  useEffect(() => {
    setTripPopupItem(null);
  }, [originStation, destStation, buyMethod, tradeMode, jumpFilter, routePref]);

  // Lazy-load 30d regional trending data when user opens Trending Markets tab
  useEffect(() => {
    if (activeTab !== 'trending' || trendingData) return;
    let cancelled = false;
    setTrendingLoading(true);
    setTrendingError(null);
    fetch('./data/market-trending.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<TrendingDataset>;
      })
      .then((json) => {
        if (!cancelled) setTrendingData(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setTrendingError(err instanceof Error ? err.message : 'Failed to load trending data');
        }
      })
      .finally(() => {
        if (!cancelled) setTrendingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, trendingData]);

  // Lazy-load FW LP Store offers when user opens FW LP Store tab
  useEffect(() => {
    if (activeTab !== 'lp' || lpData) return;
    let cancelled = false;
    setLpLoading(true);
    setLpError(null);
    fetch('./data/fw-lp-offers.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading fw-lp-offers.json`);
        return res.json() as Promise<FwLpDataset>;
      })
      .then((json) => {
        if (!cancelled) setLpData(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setLpError(err instanceof Error ? err.message : 'Failed to load FW LP Store data');
        }
      })
      .finally(() => {
        if (!cancelled) setLpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, lpData]);

  const updatedLabel = useMemo(() => {
    if (!dataset?.updatedAt) return '';
    const diffMs = Date.now() - new Date(dataset.updatedAt).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  }, [dataset]);

  const topProfit = opportunities.reduce((max, o) => Math.max(max, o.totalProfit), 0);
  const bestRoi = useMemo(
    () => opportunities.reduce((max, o) => Math.max(max, o.roiPct), 0),
    [opportunities]
  );

  const isFetchingRegion = Boolean(originProgress || destProgress);
  const theme = getTradeTheme(buyMethod, tradeMode, activeTab);

  return (
    <div className={`min-h-screen ${theme.pageBg} text-slate-200 flex flex-col transition-colors duration-300`}>
      {/* Top Navbar */}
      <header className={`border-b ${theme.headerBg} backdrop-blur sticky top-0 z-30 transition-colors duration-300`}>
        <div className="max-w-[1760px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center border ${theme.pillActive}`}
            >
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                EVE Hub Arbitrage
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                Station-to-Station Market & Hauling Finder
              </p>
            </div>
          </div>

          {/* Primary Tab Switcher */}
          <nav className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setActiveTab('arbitrage')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                activeTab === 'arbitrage'
                  ? theme.pillActive
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Arbitrage</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trending')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                activeTab === 'trending'
                  ? theme.pillActive
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Trending 14d+</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lp')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                activeTab === 'lp'
                  ? theme.pillActive
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>FW LP Store</span>
            </button>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setLiveAutoRefresh((v) => !v)}
              title={
                liveAutoRefresh
                  ? lastLiveSyncAt
                    ? `Live ESI auto-refresh every 5m (Last synced: ${new Date(lastLiveSyncAt).toLocaleTimeString()})`
                    : 'Live ESI auto-refresh every 5m enabled (click to pause)'
                  : 'Live ESI auto-refresh paused (click to enable)'
              }
              className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition cursor-pointer ${
                liveAutoRefresh
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  liveSyncing
                    ? 'bg-amber-400 animate-ping'
                    : liveAutoRefresh
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-slate-600'
                }`}
              />
              <span>
                {liveSyncing
                  ? 'Syncing...'
                  : liveAutoRefresh
                  ? lastLiveSyncAt
                    ? `Live ${new Date(lastLiveSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Live 5m'
                  : 'Live Off'}
              </span>
            </button>
            {dataset && (
              <div
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300"
                title={`Snapshot: ${new Date(dataset.updatedAt).toLocaleString()}`}
              >
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Hubs {updatedLabel}</span>
              </div>
            )}
            <button
              onClick={() => {
                void loadData();
                if (liveAutoRefresh) setLiveSyncTick((t) => t + 1);
              }}
              disabled={loading || liveSyncing}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading || liveSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Reload</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1920px] w-full mx-auto px-3 sm:px-5 py-4 space-y-4">
        {/* Top Ad Margin / Leaderboard Slot */}
        <div
          id="ad-slot-top"
          className="w-full min-h-[72px] sm:min-h-[90px] rounded-xl border border-dashed border-slate-800/80 bg-black/20 flex items-center justify-center text-[11px] text-slate-600 select-none"
        >
          <span>Ad Space — Top Leaderboard (728×90 / 970×90)</span>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-xs font-medium cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          {/* Left Side Ad Margin */}
          <aside
            id="ad-slot-left"
            className="hidden 2xl:flex w-[140px] min-h-[600px] shrink-0 sticky top-20 rounded-xl border border-dashed border-slate-800/80 bg-black/20 items-center justify-center text-[11px] text-slate-600 text-center p-2 select-none"
          >
            <span>Ad Space<br />140×600</span>
          </aside>

          {/* Center Workspace */}
          {activeTab === 'lp' ? (
            <div className="flex-1 min-w-0">
              <LpStorePanel
                theme={theme}
                data={lpData}
                dataset={dataset}
                universe={universe}
                salesTaxPct={salesTaxPct}
                brokerFeePct={brokerFeePct}
                maxCargo={maxCargo}
                loading={lpLoading}
                error={lpError}
                onOpenInArbitrage={(itemName, stationId) => {
                  const targetStation =
                    dataset?.topStations.find((s) => s.stationId === stationId) ??
                    dataset?.fwStations?.find((s) => s.stationId === stationId) ??
                    ALL_HUBS_OPTION;
                  setOriginStation(ALL_HUBS_OPTION);
                  setDestStation(targetStation);
                  setSearchQuery(itemName);
                  setExpandedId(null);
                  setActiveTab('arbitrage');
                }}
              />
            </div>
          ) : activeTab === 'trending' ? (
            <div className="flex-1 min-w-0">
              <TrendingMarketsPanel
                theme={theme}
                data={trendingData}
                dataset={dataset}
                salesTaxPct={salesTaxPct}
                brokerFeePct={brokerFeePct}
                loading={trendingLoading}
                error={trendingError}
                onSearchAllToDest={(itemName, regionId) => {
                  const targetStation =
                    dataset?.topStations.find((s) => s.regionId === regionId) ??
                    dataset?.fwStations?.find((s) => s.regionId === regionId) ??
                    ALL_HUBS_OPTION;
                  setOriginStation(ALL_HUBS_OPTION);
                  setDestStation(targetStation);
                  setSearchQuery(itemName);
                  setExpandedId(null);
                  setActiveTab('arbitrage');
                }}
              />
            </div>
          ) : (
          <div className="flex-1 min-w-0 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
            <div className="space-y-4">
              {/* ============================================================ */}
              {/* SECTION 0: BUY / SELL METHOD & DISTANCE                      */}
              {/* ============================================================ */}
              <section className={`rounded-2xl ${theme.card} border p-4 shadow-xl space-y-3 transition-colors duration-300`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center ${theme.stepBadge}`}>
                      0
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      Trade Method {tradeMode === 'instant' && '& Distance'}
                    </h2>
                  </div>
                  {scannedStationCount > 0 && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border tabular-nums ${theme.pillActive}`}>
                      {formatInt(scannedStationCount)} {scannedStationCount === 1 ? 'station' : 'stations'}
                    </span>
                  )}
                </div>

                {/* Buy Method (Above Sell Method) */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Origin Buy Method
                  </div>
                  <div className="grid grid-cols-2 p-1 rounded-lg bg-[#090d16] border border-slate-700/80 gap-1">
                    <button
                      type="button"
                      onClick={() => setBuyMethod('instant')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition cursor-pointer ${
                        buyMethod === 'instant'
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">Instant Buy</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuyMethod('order')}
                      title="Place Buy Orders at Origin to buy cheap & haul"
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition cursor-pointer ${
                        buyMethod === 'order'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">Buy Order</span>
                    </button>
                  </div>
                </div>

                {/* Sell Method (Trade Mode) */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Destination Sell Method
                  </div>
                  <div className="grid grid-cols-2 p-1 rounded-lg bg-[#090d16] border border-slate-700/80 gap-1">
                    <button
                      type="button"
                      onClick={() => setTradeMode('instant')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition cursor-pointer ${
                        tradeMode === 'instant'
                          ? 'bg-rose-950/80 text-rose-200 border border-rose-800/70'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="truncate">Instant Sell</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeMode('patient')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition cursor-pointer ${
                        tradeMode === 'patient'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Sell Order</span>
                    </button>
                  </div>
                </div>

                {tradeMode === 'instant' && (
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-400 mr-1">Distance:</span>
                      {(
                        [
                          { label: 'All', val: 'all' },
                          { label: '≤ 5j', val: 'le5' },
                          { label: '≤ 10j', val: 'le10' },
                          { label: '≤ 15j', val: 'le15' },
                        ] as { label: string; val: JumpFilter }[]
                      ).map((jf) => (
                        <button
                          key={jf.val}
                          type="button"
                          onClick={() => setJumpFilter(jf.val)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition cursor-pointer ${
                            jumpFilter === jf.val ? theme.pillActive : theme.pillInactive
                          }`}
                        >
                          {jf.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

        {/* ============================================================ */}
        {/* SECTION 1: ORIGIN & DESTINATION                              */}
        {/* ============================================================ */}
        <section className={`rounded-2xl ${theme.card} border p-4 sm:p-5 shadow-xl space-y-4 transition-colors duration-300`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center ${theme.stepBadge}`}>
                1
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Route: Origin & Destination Stations
              </h2>
            </div>
            <span className="text-xs text-slate-500 hidden sm:inline">
              Click swap (⇄) to check your return trip
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <div>
              <StationSelector
                label={
                  buyMethod === 'order'
                    ? 'Origin Station (Place Buy Order)'
                    : 'Origin Station (Buy From)'
                }
                selected={originStation}
                topStations={dataset?.topStations ?? []}
                fwStations={fwStations}
                universe={universe}
                allowAllHubs={true}
                align="left"
                onSelect={setOriginStation}
              />
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleSwapStations}
                disabled={isBothAll}
                title="Swap Origin and Destination (Check Return Trip)"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 transition cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <ArrowLeftRight className="w-4 h-4 rotate-90" />
              </button>
            </div>

            <div>
              <StationSelector
                label={
                  tradeMode === 'instant'
                    ? 'Destination Station (Instant Sell To)'
                    : 'Destination Station (Place Sell Order)'
                }
                selected={destStation}
                topStations={dataset?.topStations ?? []}
                fwStations={fwStations}
                universe={universe}
                allowAllHubs={true}
                align="left"
                onSelect={setDestStation}
              />
            </div>
          </div>

          {isFetchingRegion && (
            <div className="flex items-center gap-2.5 text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3.5 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>
                Fetching live ESI market orders (cached 5m):{' '}
                {[originProgress, destProgress].filter(Boolean).join(' • ')}
              </span>
            </div>
          )}

          {isBothAll ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 bg-[#090d16]/70 border border-cyan-500/25 rounded-lg px-3.5 py-2.5">
              <span className="font-semibold text-cyan-300">
                {tradeMode === 'instant'
                  ? `All-to-All Empire Scan${empireData ? ` (${formatInt(Object.keys(empireData.stations).length + (dataset ? Object.keys(dataset.orders).length : 98))} stations)` : ''}:`
                  : `All-to-All Hubs & FW Scan (${dataset ? Object.keys(dataset.orders).length : 98} stations):`}
              </span>
              <span>
                Finding best Station A → Station B trades across{' '}
                {tradeMode === 'instant'
                  ? 'all High/Low-Sec NPC stations.'
                  : `${dataset ? Object.keys(dataset.orders).length : 98} Volume & FW hubs (switch to Instant Sell to scan all High/Low-Sec).`}
              </span>
              {empireLoading && (
                <span className="text-cyan-400 inline-flex items-center gap-1 ml-auto">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading empire stations...
                </span>
              )}
            </div>
          ) : isDestAll ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 bg-[#090d16]/70 border border-cyan-500/25 rounded-lg px-3.5 py-2.5">
              <span className="font-semibold text-cyan-300">
                {tradeMode === 'instant'
                  ? `All High/Low-Sec Scan${empireData ? ` (${formatInt(Object.keys(empireData.stations).length + Math.max(0, (dataset ? Object.keys(dataset.orders).length : 107) - 1))} stations)` : ''}:`
                  : `Top Hubs & FW Scan (${dataset ? Object.keys(dataset.orders).length : 107} stations):`}
              </span>
              <span>
                Comparing <strong className="text-white">{originStation?.stationName}</strong>{' '}
                {tradeMode === 'instant'
                  ? 'against all High/Low-Sec NPC stations.'
                  : `against ${dataset ? Object.keys(dataset.orders).length : 107} Volume & FW hubs (switch to Instant Sell to scan all High/Low-Sec).`}
              </span>
              {empireLoading && (
                <span className="text-cyan-400 inline-flex items-center gap-1 ml-auto">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading empire stations...
                </span>
              )}
            </div>
          ) : isOriginAll ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 bg-[#090d16]/70 border border-cyan-500/25 rounded-lg px-3.5 py-2.5">
              <span className="font-semibold text-cyan-300">
                {tradeMode === 'instant'
                  ? `All High/Low-Sec Scan${empireData ? ` (${formatInt(Object.keys(empireData.stations).length + Math.max(0, (dataset ? Object.keys(dataset.orders).length : 107) - 1))} stations)` : ''}:`
                  : `Top Hubs & FW Scan (${dataset ? Object.keys(dataset.orders).length : 107} stations):`}
              </span>
              <span>
                {tradeMode === 'instant'
                  ? 'Scanning all High/Low-Sec NPC stations for cheapest sellers to '
                  : `Scanning ${dataset ? Object.keys(dataset.orders).length : 107} Volume & FW hubs for sellers to `}
                <strong className="text-white">{destStation?.stationName}</strong>
                {tradeMode === 'patient' && ' (switch to Instant Sell to scan all High/Low-Sec)'}.
              </span>
              {empireLoading && (
                <span className="text-cyan-400 inline-flex items-center gap-1 ml-auto">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading empire stations...
                </span>
              )}
            </div>
          ) : originStation && destStation && originStation.stationId === destStation.stationId ? (
            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Origin and Destination stations must be different.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4 text-slate-300 bg-[#090d16]/70 border border-slate-800 rounded-lg px-3.5 py-2.5">
                <div className="flex items-center gap-1.5">
                  <RouteIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-medium text-white">
                    {originStation?.systemName} → {destStation?.systemName}
                  </span>
                </div>
                {routeInfo && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Safe:</span>
                      <span className="font-semibold text-emerald-300">
                        {routeInfo.secureJumps}j
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Shortest:</span>
                      <span className="font-semibold text-amber-300">
                        {routeInfo.shortestJumps}j
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-slate-300 bg-[#090d16]/70 border border-slate-800 rounded-lg px-3.5 py-2.5">
                <span className="text-slate-400 font-medium">
                  {destStation?.systemName} Market:
                </span>
                <span className="text-cyan-300 tabular-nums">
                  {formatInt(destSummary.activeItemTypes)} items
                </span>
                <span className="text-emerald-300 tabular-nums">
                  {formatISK(destSummary.totalBuyIskValue, true)} Buy ISK
                </span>
                {destActivity && (
                  <>
                    <span className="inline-flex items-center gap-1 text-slate-300 tabular-nums">
                      <Activity className="w-3.5 h-3.5 text-sky-400" />
                      {formatInt(destActivity.jumps)} j/hr
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 tabular-nums ${
                        destActivity.shipKills >= 10
                          ? 'text-rose-400 font-semibold'
                          : 'text-slate-400'
                      }`}
                    >
                      <Skull className="w-3.5 h-3.5" />
                      {formatInt(destActivity.shipKills)} kills/hr
                    </span>
                  </>
                )}
                {originActivity && originStation && (
                  <span className="hidden xl:inline text-slate-500 ml-auto">
                    Origin: {formatInt(originSummary.activeItemTypes)} items
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* SECTION 2: SHIP CAPACITY & FILTERS                           */}
        {/* ============================================================ */}
        <section className={`rounded-2xl ${theme.card} border p-4 sm:p-5 shadow-xl space-y-4 transition-colors duration-300`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center ${theme.stepBadge}`}>
                2
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Hauling Ship & Market Filters
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Budget */}
            <div>
              <label className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                <Wallet className="w-3.5 h-3.5 text-cyan-400" /> Max Budget (ISK)
              </label>
              <input
                type="number"
                min={0}
                step={1000000}
                value={maxBudget}
                onChange={(e) => setMaxBudget(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
              <div className="flex gap-1 mt-1.5">
                {[
                  { label: '1M', val: 1_000_000 },
                  { label: '5M', val: 5_000_000 },
                  { label: '15M', val: 15_000_000 },
                  { label: '60M', val: 60_000_000 },
                  { label: '100M', val: 100_000_000 },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setMaxBudget(p.val)}
                    className={`flex-1 text-[11px] py-0.5 rounded border cursor-pointer transition ${
                      maxBudget === p.val
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cargo */}
            <div>
              <label className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                <Package className="w-3.5 h-3.5 text-cyan-400" /> Ship Cargo (m³)
              </label>
              <input
                type="number"
                min={0}
                step={50}
                value={maxCargo}
                onChange={(e) => setMaxCargo(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
              <div className="flex gap-1 mt-1.5">
                {[
                  { label: '200', val: 200, title: 'Frigate / Shuttle' },
                  { label: '400', val: 400, title: 'Frigate (Expanded)' },
                  { label: '650', val: 650, title: 'Destroyer / Sunesis' },
                  { label: '1k', val: 1_000, title: 'Cruiser / Fast Hauler' },
                  { label: '5k', val: 5_000, title: 'T1 Industrial' },
                ].map((p) => (
                  <button
                    key={p.label}
                    title={p.title}
                    onClick={() => setMaxCargo(p.val)}
                    className={`flex-1 text-[11px] py-0.5 rounded border cursor-pointer transition ${
                      maxCargo === p.val
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sales Tax */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Sales Tax (%)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={salesTaxPct}
                onChange={(e) => setSalesTaxPct(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">Alpha base = 7.5% (Acc V = 3.6%)</p>
            </div>

            {/* Broker Fee */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Broker Fee (%)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                step={0.1}
                disabled={tradeMode === 'instant'}
                value={brokerFeePct}
                onChange={(e) => setBrokerFeePct(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-40"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {tradeMode === 'instant' ? '0% on Instant Sell' : 'Applied to Sell Order'}
              </p>
            </div>

            {/* Min ROI & Min Profit */}
            <div>
              <label className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                <Filter className="w-3.5 h-3.5 text-cyan-400" /> Min ROI (%)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={minRoiPct}
                onChange={(e) => setMinRoiPct(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Min Profit: {formatISK(minProfit, true)}
              </p>
            </div>

            {/* Search */}
            <div>
              <label className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                <Search className="w-3.5 h-3.5 text-cyan-400" /> Filter Item
              </label>
              <input
                type="text"
                placeholder="e.g. PLEX, Muninn..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <div className="mt-1">
                <input
                  type="number"
                  min={0}
                  step={100000}
                  value={minProfit}
                  onChange={(e) => setMinProfit(Math.max(0, Number(e.target.value)))}
                  title="Minimum total profit (ISK)"
                  className="w-full bg-[#090d16] border border-slate-800 rounded px-2 py-0.5 text-[11px] text-slate-300 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Liquidity & Anti-Bait Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400 mr-1">Min Liquidity (14d Avg/d):</span>
              {(
                [
                  {
                    label: 'All',
                    val: 'all',
                    tip: 'Show all items regardless of 7-day volume',
                  },
                  {
                    label: 'Moderate+ (≥1/day)',
                    val: 'moderate',
                    tip: '7-Day Avg ≥ 1 unit/day in destination region',
                  },
                  {
                    label: 'Good+ (≥5/day)',
                    val: 'good',
                    tip: '7-Day Avg ≥ 5 units/day & ≥ 0.5x hauling Qty',
                  },
                  {
                    label: 'High (≥20/day)',
                    val: 'high',
                    tip: '7-Day Avg ≥ 20 units/day & ≥ 1.5x hauling Qty',
                  },
                ] as { label: string; val: LiquidityTier; tip: string }[]
              ).map((tier) => (
                <button
                  key={tier.val}
                  title={tier.tip}
                  onClick={() => setLiquidityTier(tier.val)}
                  className={`px-3 py-1 rounded-md text-xs font-medium border transition cursor-pointer ${
                    liquidityTier === tier.val
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSkipBaitOrders((v) => !v)}
              title="Automatically ignores 1–2 unit outlier orders that are >25% off the next market level"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition cursor-pointer ${
                skipBaitOrders
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Anti-Bait (Skip 1-2u Outliers): {skipBaitOrders ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </section>
            </div>

            {/* Right Column: Section 3 (Trip Plans & Item Table) */}
            <div className="min-w-0">
              {/* ============================================================ */}
              {/* SECTION 3: ITEM LIST & INLINE ORDER BOOK DROPDOWN            */}
              {/* ============================================================ */}
        <section className={`rounded-2xl ${theme.card} border overflow-hidden shadow-xl transition-colors duration-300`}>
          {/* Section 3 Header + Quick KPIs */}
          <div className={`px-4 sm:px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${theme.sectionHead}`}>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center ${theme.stepBadge}`}>
                3
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Item Opportunities
              </h2>
              <span className="text-xs text-slate-500 hidden md:inline">
                — Click any row to expand Sellers, Buyers & Daily Volume
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs tabular-nums">
              <div>
                <span className="text-slate-400">Found: </span>
                <span className="font-bold text-white">
                  {loading || isFetchingRegion ? '...' : formatInt(opportunities.length)}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Top Profit: </span>
                <span className="font-bold text-emerald-400">
                  {loading || isFetchingRegion ? '...' : `${formatISK(topProfit, true)} ISK`}
                </span>
              </div>
              <div className="hidden sm:block">
                <span className="text-slate-400">Best ROI: </span>
                <span className="font-bold text-cyan-400">
                  {loading || isFetchingRegion ? '...' : `${bestRoi.toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>

          <TripPlansPanel
            theme={theme}
            tripPlans={tripPlans}
            maxStops={maxStops}
            disabled={loading || isFetchingRegion || opportunities.length === 0}
            copiedPlanId={copiedPlanId}
            copiedStationKey={copiedStationKey}
            copiedId={copiedId}
            onGenerate={handleGenerateTripPlans}
            onHide={() => setShowTripPlans(false)}
            onSetMaxStops={setMaxStops}
            onCopyPlan={handleCopyPlan}
            onCopyStation={handleCopyStation}
            onCopyName={handleCopyName}
            onSelectItem={setTripPopupItem}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b ${theme.tableHead} text-[10px] uppercase tracking-wider text-slate-400`}>
                  <th className="py-2.5 px-2.5 font-semibold">Item</th>
                  {isOriginAll && (
                    <th className="py-2.5 px-2 font-semibold">Origin Hub</th>
                  )}
                  {isDestAll && (
                    <th className="py-2.5 px-2 font-semibold">Dest Hub</th>
                  )}
                  <th
                    onClick={() => handleSort('tradeScore')}
                    title="Volume-weighted Trade Score (0-100): Dest Demand + Profit + ROI + ISK/m³"
                    className="py-2.5 px-1.5 font-semibold text-center cursor-pointer hover:text-white select-none"
                  >
                    <span className="inline-flex items-center gap-1 text-cyan-300">
                      Score <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                  <th
                    onClick={() => handleSort('recommendedQty')}
                    className="py-2.5 px-2 font-semibold text-right cursor-pointer hover:text-white select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Qty / Vol <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                  <th className="py-2.5 px-2 font-semibold text-right">
                    Origin Buy
                  </th>
                  <th className="py-2.5 px-2 font-semibold text-right">
                    Dest Sell
                  </th>
                  <th
                    onClick={() => handleSort('totalCost')}
                    className="py-2.5 px-2 font-semibold text-right cursor-pointer hover:text-white select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      Total Cost <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                  <th className="py-2.5 px-2.5 font-semibold text-right select-none">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSort('totalProfit')}
                        className="inline-flex items-center gap-0.5 hover:text-white cursor-pointer"
                      >
                        Profit <ArrowUpDown className="w-3 h-3" />
                      </button>
                      <span className="text-slate-600">/</span>
                      <button
                        type="button"
                        onClick={() => handleSort('roiPct')}
                        className="inline-flex items-center gap-0.5 hover:text-white cursor-pointer"
                      >
                        ROI <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading || isFetchingRegion ? (
                  <tr>
                    <td
                      colSpan={7 + (isOriginAll ? 1 : 0) + (isDestAll ? 1 : 0)}
                      className="py-16 text-center text-slate-400"
                    >
                      Loading station market data...
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7 + (isOriginAll ? 1 : 0) + (isDestAll ? 1 : 0)}
                      className="py-16 text-center text-slate-400"
                    >
                      No profitable trades match your current filters. Try lowering Min ROI or Min Profit.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const rowKey = getRowKey(row);
                    const isExpanded = expandedId === rowKey;
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          onClick={() => handleToggleRow(row)}
                          className={`transition cursor-pointer group ${
                            isExpanded
                              ? 'bg-slate-800/60'
                              : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 group-hover:text-cyan-400 transition shrink-0">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-cyan-400" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </span>
                              <ItemImage
                                typeId={row.typeId}
                                name={row.name}
                                size={32}
                                className="w-8 h-8"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    title={row.name}
                                    className="font-medium text-white truncate max-w-[115px] sm:max-w-[155px] group-hover:text-cyan-300 transition"
                                  >
                                    {row.name}
                                  </span>
                                  <span
                                    title={
                                      row.avg7d !== null
                                        ? `14-Day Avg: ${row.avg7d}/day${
                                            row.activeDays14d != null ? ` (${row.activeDays14d}/14d active)` : ''
                                          }${
                                            row.trendPct != null
                                              ? ` (${row.trendPct >= 0 ? `+${row.trendPct}%` : `${row.trendPct}%`} vs 30d)`
                                              : ''
                                          } | Dest Buy Vol: ${formatInt(row.destBuyVol)}`
                                        : `Dest Buy Vol: ${formatInt(row.destBuyVol)}`
                                    }
                                    className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                      row.liquidityLabel === 'High'
                                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                                        : row.liquidityLabel === 'Good'
                                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                                        : row.liquidityLabel === 'Moderate'
                                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                                        : 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                                    }`}
                                  >
                                    {row.liquidityLabel === 'Moderate' ? 'Mod' : row.liquidityLabel}
                                  </span>
                                  <button
                                    onClick={(e) => handleCopyName(e, row.typeId, row.name)}
                                    title="Copy item name"
                                    className="p-1 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                  >
                                    {copiedId === row.typeId ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {formatVolume(row.unitVolume)} / unit
                                </div>
                              </div>
                            </div>
                          </td>

                          {isOriginAll && (
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                <span
                                  title={row.originStationName}
                                  className="inline-block max-w-[135px] truncate text-xs font-medium text-amber-200 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded"
                                >
                                  {row.originStationName}
                                </span>
                                {row.originStationName && (
                                  <button
                                    onClick={(e) =>
                                      handleCopyStation(
                                        e,
                                        `${row.typeId}:o`,
                                        row.originStationName!
                                      )
                                    }
                                    title="Copy station name"
                                    className="p-1 rounded text-slate-500 hover:text-amber-300 hover:bg-slate-800 transition cursor-pointer shrink-0"
                                  >
                                    {copiedStationKey === `${row.typeId}:o` ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {row.originJumps !== undefined && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {row.originJumps} jumps
                                </div>
                              )}
                            </td>
                          )}

                          {isDestAll && (
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                <span
                                  title={row.destStationName}
                                  className="inline-block max-w-[135px] truncate text-xs font-medium text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded"
                                >
                                  {row.destStationName}
                                </span>
                                {row.destStationName && (
                                  <button
                                    onClick={(e) =>
                                      handleCopyStation(
                                        e,
                                        `${row.typeId}:d`,
                                        row.destStationName!
                                      )
                                    }
                                    title="Copy station name"
                                    className="p-1 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800 transition cursor-pointer shrink-0"
                                  >
                                    {copiedStationKey === `${row.typeId}:d` ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                )}
                              </div>
                              {row.destJumps !== undefined && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {row.destJumps} jumps
                                </div>
                              )}
                            </td>
                          )}

                          <td className="py-3 px-3 text-center tabular-nums">
                            <div
                              title={
                                row.scoreBreakdown
                                  ? [
                                      `Liquidity: ${row.scoreBreakdown.liq}/45`,
                                      `Profit: ${row.scoreBreakdown.profit}/33`,
                                      `ROI: ${row.scoreBreakdown.roi}/8`,
                                      `Jump/Speed: ${row.scoreBreakdown.jump}/14`,
                                      row.scoreBreakdown.trend !== 0
                                        ? `Trend: ${row.scoreBreakdown.trend > 0 ? `+${row.scoreBreakdown.trend}` : row.scoreBreakdown.trend} (±20)`
                                        : null,
                                      row.scoreBreakdown.note ? `Cap/Adj: ${row.scoreBreakdown.note}` : null,
                                    ]
                                      .filter(Boolean)
                                      .join('\n')
                                  : `Score ${row.tradeScore}/100`
                              }
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border cursor-help ${
                                row.tradeScore >= 75
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                  : row.tradeScore >= 55
                                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                                  : row.tradeScore >= 35
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                  : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                              }`}
                            >
                              <span>{row.tradeScore}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {row.avg7d !== null
                                ? `14d: ${row.avg7d}/d`
                                : `Buy: ${formatInt(row.destBuyVol)}`}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums">
                            <div className="font-medium text-slate-200">
                              {formatInt(row.recommendedQty)}x
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatVolume(row.totalVolume)}
                            </div>
                            {row.cargoFillPct !== null && (
                              <div className="mt-1 flex items-center justify-end gap-1.5">
                                <div className="w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      row.cargoFillPct >= 80
                                        ? 'bg-emerald-400'
                                        : row.cargoFillPct >= 30
                                        ? 'bg-cyan-400'
                                        : 'bg-slate-500'
                                    }`}
                                    style={{ width: `${Math.max(4, row.cargoFillPct)}%` }}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] font-semibold ${
                                    row.cargoFillPct >= 80
                                      ? 'text-emerald-400'
                                      : row.cargoFillPct >= 30
                                      ? 'text-cyan-300'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {row.cargoFillPct.toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                            {formatISK(row.buyPrice)}
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                            {formatISK(row.sellPrice)}
                          </td>

                          <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                            <div>{formatISK(row.totalCost, true)}</div>
                            {row.budgetUsedPct !== null && (
                              <div className="mt-1 flex items-center justify-end gap-1.5">
                                <div className="w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      row.budgetUsedPct >= 80
                                        ? 'bg-amber-400'
                                        : row.budgetUsedPct >= 30
                                        ? 'bg-sky-400'
                                        : 'bg-slate-500'
                                    }`}
                                    style={{ width: `${Math.max(4, row.budgetUsedPct)}%` }}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] font-semibold ${
                                    row.budgetUsedPct >= 80
                                      ? 'text-amber-300'
                                      : row.budgetUsedPct >= 30
                                      ? 'text-sky-300'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {row.budgetUsedPct.toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right tabular-nums">
                            <div className="font-semibold text-white">
                              +{formatISK(row.totalProfit, true)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              +{formatISK(row.profitPerUnit, true)}/ea
                            </div>
                            <div className="mt-1">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-sm font-bold border ${
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
                          </td>
                        </tr>

                        {/* Inline Dropdown Detail Row */}
                        {isExpanded && (
                          <tr
                            id={`expanded-${rowKey}`}
                            className={`border-b ${theme.expandedRow}`}
                          >
                            <td
                              colSpan={7 + (isOriginAll ? 1 : 0) + (isDestAll ? 1 : 0)}
                              className="p-4 sm:p-5"
                            >
                              <div className="space-y-4">
                                {/* Top Summary Strip */}
                                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                                  <div className="flex items-center gap-3">
                                    <ItemImage
                                      typeId={row.typeId}
                                      name={row.name}
                                      size={64}
                                      className="w-10 h-10 rounded-lg border-slate-700"
                                    />
                                    <div>
                                      <div className="text-sm font-bold text-white flex items-center gap-2">
                                        <span>{row.name}</span>
                                        <span
                                          className={`text-[11px] px-2 py-0.5 rounded border font-semibold ${
                                            row.tradeScore >= 75
                                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                              : row.tradeScore >= 55
                                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                                              : row.tradeScore >= 35
                                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                              : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                                          }`}
                                        >
                                          Score {row.tradeScore}/100 ({row.scoreLabel})
                                        </span>
                                      </div>
                                      <div className="text-xs text-slate-400">
                                        Type ID: {row.typeId} • Net Revenue:{' '}
                                        <span className="text-cyan-300 font-medium">
                                          {formatISK(row.totalRevenueAfterTax, true)} ISK
                                        </span>{' '}
                                        (after taxes/fees)
                                      </div>
                                    </div>
                                  </div>

                                  <a
                                    href={`https://evetycoon.com/market/${row.typeId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition"
                                  >
                                    <span>View on EVE Tycoon</span>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>

                                {/* Compact 2-Column Order Book */}
                                <OrderBookGrid
                                  opp={row}
                                  buyMethod={buyMethod}
                                  tradeMode={tradeMode}
                                  originSystemFallback={originStation?.systemName}
                                  destSystemFallback={destStation?.systemName}
                                  originStats={originHistoryStats}
                                  destStats={historyStats}
                                />

                                {/* Daily Trading Volume: Origin & Destination (ESI 30d History) */}
                                <VolumeComparison
                                  originLabel={`Origin Volume — ${row.originRegionName ?? originStation?.regionName ?? 'Origin'}`}
                                  destLabel={`Dest Volume — ${row.destRegionName ?? destStation?.regionName ?? 'Destination'}`}
                                  originStats={originHistoryStats}
                                  destStats={historyStats}
                                  loading={historyLoading}
                                  error={historyError}
                                  qty={row.recommendedQty}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {opportunities.length > pageSize && (
            <div className="p-4 border-t border-slate-800 flex justify-center">
              <button
                onClick={() => setPageSize((p) => p + 50)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 cursor-pointer transition"
              >
                Show More ({opportunities.length - pageSize} remaining)
              </button>
              </div>
            )}
          </section>
            </div>
          </div>
          )}

          {/* Right Side Ad Margin */}
          <aside
            id="ad-slot-right"
            className="hidden 2xl:flex w-[140px] min-h-[600px] shrink-0 sticky top-20 rounded-xl border border-dashed border-slate-800/80 bg-black/20 items-center justify-center text-[11px] text-slate-600 text-center p-2 select-none"
          >
            <span>Ad Space<br />140×600</span>
          </aside>
        </div>
      </main>

      {/* Compact Trip Item Detail Popup */}
      {tripPopupItem && (
        <TripItemModal
          item={tripPopupItem}
          buyMethod={buyMethod}
          tradeMode={tradeMode}
          originStation={originStation}
          destStation={destStation}
          originStats={tripOriginHistoryStats}
          destStats={tripHistoryStats}
          historyLoading={tripHistoryLoading}
          historyError={tripHistoryError}
          onClose={() => setTripPopupItem(null)}
        />
      )}
    </div>
  );
}

export default App;
