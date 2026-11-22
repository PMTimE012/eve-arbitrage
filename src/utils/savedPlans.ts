import type {
  ArbitrageOpportunity,
  BuyMethod,
  EmpireInstantDataset,
  HubBook,
  MarketDataset,
  StationOption,
  TradeMode,
  UniverseStationsData,
} from '../types';
import { calculateArbitrage } from './arbitrage';
import { getRouteSystemPath, getSystemJumpMap, type RoutePreference } from './routing';
import type { TripPlan } from './tripPlanner';

export interface SavedPlanItem {
  typeId: number;
  name: string;
  qty: number;
  unitVolume: number;
  originStationId: number;
  originStationName: string;
  originRegionId?: number;
  destStationId: number;
  destStationName: string;
  destRegionId?: number;
  savedBuyPrice: number;
  savedSellPrice: number;
  savedCost: number;
  savedProfit: number;
  savedRoiPct: number;
  savedScore: number;
}

export interface SavedPlanStop {
  stationId: number;
  stationName: string;
  systemId: number;
  security: number | null;
  jumpsFromPrev: number;
  items: SavedPlanItem[];
}

export interface SavedApproachLeg {
  currentStationId: number;
  currentStationName: string;
  currentSystemId: number;
  currentSecurity: number | null;
  buyStationId: number;
  buyStationName: string;
  buySystemId: number;
  buySecurity: number | null;
  sellStationId: number;
  sellStationName: string;
  sellSystemId: number;
  sellSecurity: number | null;
  jumpsCurToBuy: number;
  jumpsBuyToSell: number;
  jumpsSellToOri: number;
  directJumpsCurToOri: number;
  detourJumps: number;
  totalJumps: number;
  totalCost: number;
  totalProfit: number;
  totalVolume: number;
  iskPerJump: number;
  items: SavedPlanItem[];
}

export interface SavedTripPlan {
  uid: string;
  savedAt: string;
  sourcePlanId: string;
  title: string;
  subtitle: string;
  buyMethod: BuyMethod;
  tradeMode: TradeMode;
  salesTaxPct: number;
  brokerFeePct: number;
  maxBudget?: number;
  maxCargo?: number;
  routePref?: RoutePreference;
  finalDestName?: string;
  jumpsToFinalDest: number;
  totalJumps: number;
  totalCost: number;
  totalProfit: number;
  totalVolume: number;
  iskPerJump: number;
  avgScore: number;
  stops: SavedPlanStop[];
  approach?: SavedApproachLeg;
}

export type LiveItemStatus =
  | 'active'
  | 'changed'
  | 'unprofitable'
  | 'missing_origin'
  | 'missing_dest'
  | 'missing_both';

export interface LiveItemEvaluation {
  item: SavedPlanItem;
  status: LiveItemStatus;
  liveBuyPrice: number | null;
  liveSellPrice: number | null;
  liveAvailableQty: number;
  liveProfit: number;
  profitDiff: number;
  origEntry?: HubBook;
  destEntry?: HubBook;
}

const STORAGE_KEY = 'eve_arbitrage_my_plans_v1';

export function loadSavedPlans(): SavedTripPlan[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTripPlan[]) : [];
  } catch {
    return [];
  }
}

export function persistSavedPlans(plans: SavedTripPlan[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // Ignore quota errors cleanly
  }
}

export function createSavedPlanFromTripPlan(
  plan: TripPlan,
  meta: {
    buyMethod: BuyMethod;
    tradeMode: TradeMode;
    salesTaxPct: number;
    brokerFeePct: number;
    maxBudget?: number;
    maxCargo?: number;
    routePref?: RoutePreference;
    originStation?: StationOption | null;
    destStation?: StationOption | null;
  }
): SavedTripPlan {
  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
    sourcePlanId: plan.id,
    title: plan.title,
    subtitle: plan.subtitle,
    buyMethod: meta.buyMethod,
    tradeMode: meta.tradeMode,
    salesTaxPct: meta.salesTaxPct,
    brokerFeePct: meta.brokerFeePct,
    maxBudget: meta.maxBudget,
    maxCargo: meta.maxCargo,
    routePref: meta.routePref,
    finalDestName: plan.finalDestName,
    jumpsToFinalDest: plan.jumpsToFinalDest,
    totalJumps: plan.totalJumps,
    totalCost: plan.totalCost,
    totalProfit: plan.totalProfit,
    totalVolume: plan.totalVolume,
    iskPerJump: plan.iskPerJump,
    avgScore: plan.avgScore,
    stops: plan.stops.map((stop) => ({
      stationId: stop.stationId,
      stationName: stop.stationName,
      systemId: stop.systemId,
      security: stop.security,
      jumpsFromPrev: stop.jumpsFromPrev,
      items: stop.items.map((it) => ({
        typeId: it.typeId,
        name: it.name,
        qty: it.qty,
        unitVolume: it.unitVolume,
        originStationId: it.opp.originStationId ?? it.stationId ?? meta.originStation?.stationId ?? 0,
        originStationName: it.opp.originStationName ?? it.stationName ?? meta.originStation?.stationName ?? 'Unknown',
        originRegionId: it.opp.originRegionId ?? meta.originStation?.regionId,
        destStationId: it.opp.destStationId ?? meta.destStation?.stationId ?? 0,
        destStationName: it.opp.destStationName ?? plan.finalDestName ?? meta.destStation?.stationName ?? 'Unknown',
        destRegionId: it.opp.destRegionId ?? meta.destStation?.regionId,
        savedBuyPrice: it.buyPrice,
        savedSellPrice: it.sellPrice,
        savedCost: it.totalCost,
        savedProfit: it.totalProfit,
        savedRoiPct: it.roiPct,
        savedScore: it.tradeScore,
      })),
    })),
  };
}

function getStationItemEntry(
  stationId: number,
  typeId: number,
  dataset: MarketDataset | null,
  empireData: EmpireInstantDataset | null,
  liveBooks: Record<number, Record<string, HubBook>>
): HubBook | undefined {
  if (!stationId) return undefined;
  const tid = String(typeId);
  const live = liveBooks[stationId]?.[tid];
  if (live !== undefined) return live;
  const fromDataset = dataset?.orders[String(stationId)]?.[tid];
  if (fromDataset !== undefined) return fromDataset;
  return empireData?.orders[String(stationId)]?.[tid];
}

export function evaluateSavedPlanItem(
  item: SavedPlanItem,
  plan: SavedTripPlan,
  dataset: MarketDataset | null,
  empireData: EmpireInstantDataset | null,
  liveBooks: Record<number, Record<string, HubBook>>
): LiveItemEvaluation {
  const origEntry = getStationItemEntry(
    item.originStationId,
    item.typeId,
    dataset,
    empireData,
    liveBooks
  );
  const destEntry = getStationItemEntry(
    item.destStationId,
    item.typeId,
    dataset,
    empireData,
    liveBooks
  );

  const liveBuyPrice =
    plan.buyMethod === 'instant'
      ? origEntry?.s[0]?.[0] ?? null
      : origEntry?.b[0]?.[0] ?? null;

  const liveSellPrice =
    plan.tradeMode === 'instant'
      ? destEntry?.b[0]?.[0] ?? null
      : destEntry?.s[0]?.[0] ?? null;

  const hasOrig = liveBuyPrice !== null && liveBuyPrice > 0;
  const hasDest = liveSellPrice !== null && liveSellPrice > 0;

  if (!hasOrig && !hasDest) {
    return {
      item,
      status: 'missing_both',
      liveBuyPrice: null,
      liveSellPrice: null,
      liveAvailableQty: 0,
      liveProfit: 0,
      profitDiff: -item.savedProfit,
      origEntry,
      destEntry,
    };
  }
  if (!hasOrig) {
    return {
      item,
      status: 'missing_origin',
      liveBuyPrice: null,
      liveSellPrice,
      liveAvailableQty: 0,
      liveProfit: 0,
      profitDiff: -item.savedProfit,
      origEntry,
      destEntry,
    };
  }
  if (!hasDest) {
    return {
      item,
      status: 'missing_dest',
      liveBuyPrice,
      liveSellPrice: null,
      liveAvailableQty: 0,
      liveProfit: 0,
      profitDiff: -item.savedProfit,
      origEntry,
      destEntry,
    };
  }

  const sumLevels = (levels?: [number, number][]): number =>
    levels ? levels.reduce((acc, lv) => acc + (lv[1] ?? 0), 0) : 0;
  const origVol =
    plan.buyMethod === 'instant'
      ? origEntry?.sv || sumLevels(origEntry?.s)
      : item.qty;
  const destVol =
    plan.tradeMode === 'instant'
      ? destEntry?.bv || sumLevels(destEntry?.b)
      : item.qty;
  const liveAvailableQty = Math.min(origVol, destVol);
  const evalQty = Math.min(item.qty, Math.max(0, liveAvailableQty));

  const buyFeeMult = plan.buyMethod === 'order' ? 1 + plan.brokerFeePct / 100 : 1;
  const sellNetMult =
    1 - (plan.salesTaxPct + (plan.tradeMode === 'patient' ? plan.brokerFeePct : 0)) / 100;

  const liveProfit =
    evalQty * (liveSellPrice! * sellNetMult - liveBuyPrice! * buyFeeMult);
  const profitDiff = liveProfit - item.savedProfit;

  let status: LiveItemStatus = 'active';
  if (liveProfit <= 0) {
    status = 'unprofitable';
  } else if (evalQty < item.qty || liveProfit < item.savedProfit * 0.75) {
    status = 'changed';
  }

  return {
    item,
    status,
    liveBuyPrice,
    liveSellPrice,
    liveAvailableQty,
    liveProfit,
    profitDiff,
    origEntry,
    destEntry,
  };
}

interface MarketStationNode {
  stationId: number;
  stationName: string;
  systemId: number;
  security: number;
  regionId: number;
  isTopHub: boolean;
  book: Record<string, HubBook>;
}

function collectMarketStationNodes(
  dataset: MarketDataset,
  empireData: EmpireInstantDataset | null,
  liveBooks?: Record<number, Record<string, HubBook>>
): MarketStationNode[] {
  const map = new Map<number, MarketStationNode>();

  if (empireData) {
    for (const [sidStr, book] of Object.entries(empireData.orders)) {
      const meta = empireData.stations[sidStr];
      if (!meta || !book) continue;
      map.set(meta.stationId, {
        stationId: meta.stationId,
        stationName: meta.stationName,
        systemId: meta.systemId,
        security: meta.security,
        regionId: meta.regionId,
        isTopHub: false,
        book: liveBooks?.[meta.stationId] ?? book,
      });
    }
  }

  const topIds = new Set(dataset.topStations.map((s) => s.stationId));
  const allDatasetStations = [...dataset.topStations, ...(dataset.fwStations ?? [])];
  for (const st of allDatasetStations) {
    const book = liveBooks?.[st.stationId] ?? dataset.orders[String(st.stationId)];
    if (!book) continue;
    map.set(st.stationId, {
      stationId: st.stationId,
      stationName: st.stationName,
      systemId: st.systemId,
      security: st.security,
      regionId: st.regionId,
      isTopHub: topIds.has(st.stationId),
      book,
    });
  }

  return Array.from(map.values());
}

function packApproachItems(
  opps: ArbitrageOpportunity[],
  buySt: MarketStationNode,
  sellSt: MarketStationNode,
  maxBudget: number,
  maxCargo: number
): { items: SavedPlanItem[]; totalCost: number; totalProfit: number; totalVolume: number } {
  let remBudget = maxBudget > 0 ? maxBudget : Number.POSITIVE_INFINITY;
  let remCargo = maxCargo > 0 ? maxCargo : Number.POSITIVE_INFINITY;
  const items: SavedPlanItem[] = [];
  let totalCost = 0;
  let totalProfit = 0;
  let totalVolume = 0;

  const sorted = [...opps].sort((a, b) => b.totalProfit - a.totalProfit);
  for (const opp of sorted) {
    if (items.length >= 10) break;
    if (opp.recommendedQty <= 0 || opp.totalProfit <= 0) continue;

    const unitCost = opp.buyPrice;
    const unitVol = Math.max(0.0001, opp.unitVolume);
    const maxByBudget =
      Number.isFinite(remBudget) && unitCost > 0
        ? Math.floor(remBudget / unitCost)
        : opp.recommendedQty;
    const maxByCargo = Number.isFinite(remCargo)
      ? Math.floor(remCargo / unitVol)
      : opp.recommendedQty;
    const takeQty = Math.min(opp.recommendedQty, maxByBudget, maxByCargo);
    if (takeQty <= 0) continue;

    const scale = takeQty / opp.recommendedQty;
    const itemCost = opp.totalCost * scale;
    const itemProfit = opp.totalProfit * scale;
    const itemVol = takeQty * opp.unitVolume;
    if (itemProfit < 10_000) continue;

    if (Number.isFinite(remBudget)) remBudget -= itemCost;
    if (Number.isFinite(remCargo)) remCargo -= itemVol;
    totalCost += itemCost;
    totalProfit += itemProfit;
    totalVolume += itemVol;

    items.push({
      typeId: opp.typeId,
      name: opp.name,
      qty: takeQty,
      unitVolume: opp.unitVolume,
      originStationId: buySt.stationId,
      originStationName: buySt.stationName,
      originRegionId: buySt.regionId,
      destStationId: sellSt.stationId,
      destStationName: sellSt.stationName,
      destRegionId: sellSt.regionId,
      savedBuyPrice: opp.buyPrice,
      savedSellPrice: opp.sellPrice,
      savedCost: itemCost,
      savedProfit: itemProfit,
      savedRoiPct: opp.roiPct,
      savedScore: opp.tradeScore,
    });
  }

  return { items, totalCost, totalProfit, totalVolume };
}

export function buildEnRouteApproachLeg(
  plan: SavedTripPlan,
  currentStation: StationOption,
  dataset: MarketDataset | null,
  empireData: EmpireInstantDataset | null,
  universe: UniverseStationsData | null,
  routePref: RoutePreference,
  maxBudget: number,
  maxCargo: number,
  liveBooks?: Record<number, Record<string, HubBook>>
): { approach: SavedApproachLeg | null; reason?: string } {
  const oriStop = plan.stops[0];
  if (!oriStop) {
    return { approach: null, reason: 'Plan has no starting stop.' };
  }
  if (!dataset || !universe) {
    return { approach: null, reason: 'Market or universe data is still loading.' };
  }
  if (currentStation.stationId === oriStop.stationId) {
    return { approach: null, reason: 'Current location is already the starting station (Ori).' };
  }

  const oriSysId = oriStop.systemId;
  const directPath =
    currentStation.systemId === oriSysId
      ? [oriSysId]
      : getRouteSystemPath(currentStation.systemId, oriSysId, universe, routePref);
  if (directPath.length === 0) {
    return { approach: null, reason: 'No route found from Current location to Ori.' };
  }
  const directJumps = Math.max(0, directPath.length - 1);

  const curJumpMap = getSystemJumpMap(currentStation.systemId, universe, routePref);
  const marketNodes = collectMarketStationNodes(dataset, empireData, liveBooks);
  const MAX_DETOUR = 3;

  // Score and select corridor market stations near Current -> Ori
  const corridor: { node: MarketStationNode; jCur: number; jOri: number; detour: number }[] = [];
  for (const node of marketNodes) {
    const jCur =
      node.systemId === currentStation.systemId ? 0 : curJumpMap?.get(node.systemId);
    if (jCur === undefined) continue;
    const jOri =
      node.systemId === oriSysId
        ? 0
        : getSystemJumpMap(node.systemId, universe, routePref)?.get(oriSysId);
    if (jOri === undefined) continue;
    const detour = jCur + jOri - directJumps;
    if (detour <= MAX_DETOUR) {
      corridor.push({ node, jCur, jOri, detour });
    }
  }

  corridor.sort((a, b) => {
    const aIsAnchor =
      a.node.stationId === currentStation.stationId || a.node.stationId === oriStop.stationId
        ? 0
        : 1;
    const bIsAnchor =
      b.node.stationId === currentStation.stationId || b.node.stationId === oriStop.stationId
        ? 0
        : 1;
    if (aIsAnchor !== bIsAnchor) return aIsAnchor - bIsAnchor;
    if (a.detour !== b.detour) return a.detour - b.detour;
    if (a.node.isTopHub !== b.node.isTopHub) return a.node.isTopHub ? -1 : 1;
    return a.jCur - b.jCur;
  });

  // Always keep anchors and on-corridor Top Hubs, plus nearest non-hub corridor stations
  const topCorridor = [
    ...corridor.filter(
      (c) =>
        c.node.stationId === currentStation.stationId ||
        c.node.stationId === oriStop.stationId ||
        c.node.isTopHub
    ),
    ...corridor.filter(
      (c) =>
        c.node.stationId !== currentStation.stationId &&
        c.node.stationId !== oriStop.stationId &&
        !c.node.isTopHub
    ),
  ].slice(0, 20);
  if (topCorridor.length < 2) {
    return {
      approach: null,
      reason: 'No market stations with order data found along Current → Ori.',
    };
  }

  const effectiveBudget = maxBudget > 0 ? maxBudget : 500_000_000;
  const effectiveCargo = maxCargo > 0 ? maxCargo : 10_000;

  let bestApproach: SavedApproachLeg | null = null;
  let bestScore = -1;

  for (const buyCand of topCorridor) {
    const buyMap = getSystemJumpMap(buyCand.node.systemId, universe, routePref);
    for (const sellCand of topCorridor) {
      if (buyCand.node.stationId === sellCand.node.stationId) continue;
      // Ensure sell is not behind buy relative to Current, and never overshoots past Ori
      if (sellCand.jCur < buyCand.jCur) continue;
      if (sellCand.jOri > buyCand.jOri) continue;

      const jBuyToSell =
        buyCand.node.systemId === sellCand.node.systemId
          ? 0
          : buyMap?.get(sellCand.node.systemId);
      if (jBuyToSell === undefined) continue;

      const totalJumps = buyCand.jCur + jBuyToSell + sellCand.jOri;
      const detourJumps = totalJumps - directJumps;
      if (detourJumps > MAX_DETOUR) continue;

      const opps = calculateArbitrage(dataset, {
        originBook: buyCand.node.book,
        destBook: sellCand.node.book,
        buyMethod: 'instant',
        tradeMode: 'instant',
        maxBudget: effectiveBudget,
        maxCargo: effectiveCargo,
        salesTaxPct: plan.salesTaxPct,
        brokerFeePct: plan.brokerFeePct,
        minRoiPct: 1,
        minProfit: 10_000,
        liquidityTier: 'all',
        jumpFilter: 'all',
        skipBaitOrders: true,
        searchQuery: '',
        routeJumps: Math.max(1, jBuyToSell),
        originRegionId: buyCand.node.regionId,
        destRegionId: sellCand.node.regionId,
      });

      if (opps.length === 0) continue;

      const packed = packApproachItems(
        opps,
        buyCand.node,
        sellCand.node,
        maxBudget,
        maxCargo
      );
      if (packed.items.length === 0 || packed.totalProfit <= 0) continue;

      const iskPerJump = packed.totalProfit / Math.max(1, totalJumps);
      // Slight preference for ending directly at Ori and lower detour
      const oriBonus = sellCand.node.stationId === oriStop.stationId ? 1.05 : 1.0;
      const score = iskPerJump * oriBonus;

      if (score > bestScore) {
        bestScore = score;
        bestApproach = {
          currentStationId: currentStation.stationId,
          currentStationName: currentStation.stationName,
          currentSystemId: currentStation.systemId,
          currentSecurity: currentStation.security,
          buyStationId: buyCand.node.stationId,
          buyStationName: buyCand.node.stationName,
          buySystemId: buyCand.node.systemId,
          buySecurity: buyCand.node.security,
          sellStationId: sellCand.node.stationId,
          sellStationName: sellCand.node.stationName,
          sellSystemId: sellCand.node.systemId,
          sellSecurity: sellCand.node.security,
          jumpsCurToBuy: buyCand.jCur,
          jumpsBuyToSell: jBuyToSell,
          jumpsSellToOri: sellCand.jOri,
          directJumpsCurToOri: directJumps,
          detourJumps,
          totalJumps,
          totalCost: packed.totalCost,
          totalProfit: packed.totalProfit,
          totalVolume: packed.totalVolume,
          iskPerJump,
          items: packed.items,
        };
      }
    }
  }

  if (!bestApproach) {
    return {
      approach: null,
      reason: 'No profitable en-route instant trades found within 3 jumps detour.',
    };
  }

  return { approach: bestApproach };
}
