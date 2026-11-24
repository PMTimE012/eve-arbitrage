import type {
  ArbitrageOpportunity,
  BuyMethod,
  StationOption,
  SystemActivity,
  TradeMode,
  UniverseStationsData,
} from '../types';
import {
  getRouteSystemPath,
  getSystemJumpMap,
  summarizePathKills,
  type RoutePreference,
} from './routing';
import { formatISK } from './arbitrage';

function applyPlanLabels(plans: TripPlan[]): void {
  plans.forEach((plan, idx) => {
    plan.id = `plan-${idx + 1}`;
    const cargoPct = plan.cargoFillPct !== null ? `${plan.cargoFillPct.toFixed(0)}%` : '—';
    const budgetPct = plan.budgetUsedPct !== null ? `${plan.budgetUsedPct.toFixed(0)}%` : '—';
    plan.title = `${formatISK(plan.iskPerJump, true)}/j - ${cargoPct}/${budgetPct}`;
    plan.subtitle = `${plan.stops.length} stop${plan.stops.length > 1 ? 's' : ''} • ${plan.totalJumps} jumps`;
  });
}

export interface TripItemPick {
  typeId: number;
  name: string;
  qty: number;
  unitVolume: number;
  totalVolume: number;
  buyPrice: number;
  sellPrice: number;
  totalCost: number;
  totalProfit: number;
  roiPct: number;
  tradeScore: number;
  stationId: number;
  stationName: string;
  systemId: number;
  opp: ArbitrageOpportunity;
}

export interface TripStop {
  stationId: number;
  stationName: string;
  systemId: number;
  security: number | null;
  jumpsFromPrev: number;
  items: TripItemPick[];
  stopCost: number;
  stopProfit: number;
  stopVolume: number;
}

export interface TripPlan {
  id: string;
  title: string;
  subtitle: string;
  mode?: 'allToDest' | 'originToAll' | 'single';
  originStationName?: string;
  stops: TripStop[];
  finalDestName?: string;
  jumpsToFinalDest: number;
  totalJumps: number;
  totalCost: number;
  totalProfit: number;
  totalVolume: number;
  cargoFillPct: number | null;
  budgetUsedPct: number | null;
  iskPerJump: number;
  avgScore: number;
  routeShipKills1h: number;
  hottestSystem: { name: string; kills: number } | null;
}

interface CandidateItem {
  opp: ArbitrageOpportunity;
  stationId: number;
  stationName: string;
  systemId: number;
}

function getExactOptimalOrder(
  stops: { stationId: number; stationName: string; systemId: number }[],
  anchorSystemId: number,
  singleDestSystemId: number,
  mode: 'allToDest' | 'originToAll' | 'single',
  universe: UniverseStationsData | null,
  routePref: RoutePreference
): { ordered: typeof stops; legJumps: number[]; endJumps: number; totalJumps: number } {
  if (stops.length === 0) {
    return { ordered: [], legJumps: [], endJumps: 0, totalJumps: 0 };
  }
  if (mode === 'single') {
    const map = getSystemJumpMap(anchorSystemId, universe, routePref);
    const j = map?.get(singleDestSystemId) ?? 0;
    return { ordered: stops, legJumps: [0], endJumps: j, totalJumps: j };
  }

  const jumpBetween = (fromSys: number, toSys: number): number => {
    if (fromSys === toSys) return 0;
    const m = getSystemJumpMap(fromSys, universe, routePref);
    return m?.get(toSys) ?? 20;
  };

  // Generate all permutations (stops.length <= 5 => max 120 permutations)
  const perms: (typeof stops)[] = [];
  const permute = (arr: typeof stops, l: number) => {
    if (l === arr.length - 1) {
      perms.push([...arr]);
      return;
    }
    for (let i = l; i < arr.length; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      permute(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  };
  permute([...stops], 0);

  let bestOrder = stops;
  let bestLegs: number[] = [];
  let bestEnd = 0;
  let bestTotal = Infinity;

  for (const p of perms) {
    let total = 0;
    const legs: number[] = [];
    if (mode === 'originToAll') {
      // Anchor (Origin) -> Stop 0 -> Stop 1 -> ...
      let curSys = anchorSystemId;
      for (const s of p) {
        const j = jumpBetween(curSys, s.systemId);
        legs.push(j);
        total += j;
        curSys = s.systemId;
      }
      if (total < bestTotal) {
        bestTotal = total;
        bestOrder = p;
        bestLegs = legs;
        bestEnd = 0;
      }
    } else {
      // allToDest: Jita -> Stop 0 -> Stop 1 -> ... -> Anchor (Dest)
      const firstJ = jumpBetween(30000142, p[0].systemId);
      legs.push(firstJ);
      total += firstJ;
      for (let i = 1; i < p.length; i++) {
        const j = jumpBetween(p[i - 1].systemId, p[i].systemId);
        legs.push(j);
        total += j;
      }
      const endJ = jumpBetween(p[p.length - 1].systemId, anchorSystemId);
      total += endJ;
      if (total < bestTotal) {
        bestTotal = total;
        bestOrder = p;
        bestLegs = legs;
        bestEnd = endJ;
      }
    }
  }

  return {
    ordered: bestOrder,
    legJumps: bestLegs,
    endJumps: bestEnd,
    totalJumps: bestTotal,
  };
}

function getMaxSafeQty(opp: ArbitrageOpportunity, tradeMode: TradeMode): number {
  if (tradeMode === 'instant' || opp.avg7d === null) {
    return opp.recommendedQty;
  }
  // In patient mode, cap at 25% of 7-day daily avg (at least 1 if avg7d >= 1)
  const regionDailyCap = Math.max(opp.avg7d >= 1 ? 1 : 0, Math.floor(opp.avg7d * 0.25));
  return Math.min(opp.recommendedQty, regionDailyCap);
}

function packItemsForStops(
  chosenStationIds: Set<number>,
  candidates: CandidateItem[],
  tradeMode: TradeMode,
  maxBudget: number,
  maxCargo: number,
  priorityFn: (c: CandidateItem) => number,
  _maxSharePerItem = 1,
  minItemScore = 26,
  maxDistinctItems = Infinity,
  minItemProfit = 200_000,
  excludedTypeIds?: Set<number>
): Map<number, TripItemPick[]> {
  const knapsackEfficiency = (c: CandidateItem): number => {
    const { opp } = c;
    const unitVol = opp.unitVolume > 0 ? opp.unitVolume : 0.01;
    const safeQty = getMaxSafeQty(opp, tradeMode);
    if (safeQty <= 0) return 0;

    const maxByB = maxBudget > 0 ? Math.floor(maxBudget / opp.buyPrice) : safeQty;
    const maxByC = maxCargo > 0 ? Math.floor(maxCargo / unitVol) : safeQty;
    const feasibleQty = Math.min(safeQty, maxByB, maxByC);
    if (feasibleQty <= 0) return 0;

    const feasibleProfit = feasibleQty * opp.profitPerUnit;
    const budgetShare = maxBudget > 0 ? (feasibleQty * opp.buyPrice) / maxBudget : 0;
    const cargoShare = maxCargo > 0 ? (feasibleQty * unitVol) / maxCargo : 0;
    const resourceUse = Math.max(0.25, budgetShare + cargoShare);
    return feasibleProfit / resourceUse;
  };

  const pool = candidates
    .filter(
      (c) =>
        chosenStationIds.has(c.stationId) &&
        c.opp.tradeScore >= minItemScore &&
        !excludedTypeIds?.has(c.opp.typeId)
    )
    .sort((a, b) => knapsackEfficiency(b) - knapsackEfficiency(a) || priorityFn(b) - priorityFn(a));

  let remBudget = maxBudget > 0 ? maxBudget : Infinity;
  let remCargo = maxCargo > 0 ? maxCargo : Infinity;

  const pickedByStation = new Map<number, TripItemPick[]>();
  const pickedByType = new Map<number, { pick: TripItemPick; candidate: CandidateItem }>();

  const tryPick = (c: CandidateItem, budgetCap: number, cargoCap: number) => {
    const { opp } = c;
    const unitCost = opp.buyPrice;
    const unitVol = opp.unitVolume > 0 ? opp.unitVolume : 0.01;
    const existing = pickedByType.get(opp.typeId);
    const alreadyQty = existing ? existing.pick.qty : 0;
    if (!existing && pickedByType.size >= maxDistinctItems) return;
    const availMore = getMaxSafeQty(opp, tradeMode) - alreadyQty;
    if (availMore <= 0) return;

    const maxByRemBudget = remBudget === Infinity ? availMore : Math.floor(remBudget / unitCost);
    const maxByRemCargo = remCargo === Infinity ? availMore : Math.floor(remCargo / unitVol);
    const maxByItemBudget =
      budgetCap === Infinity
        ? availMore
        : Math.max(0, Math.floor((budgetCap - (existing?.pick.totalCost ?? 0)) / unitCost));
    const maxByItemCargo =
      cargoCap === Infinity
        ? availMore
        : Math.max(0, Math.floor((cargoCap - (existing?.pick.totalVolume ?? 0)) / unitVol));

    const takeQty = Math.min(
      availMore,
      maxByRemBudget,
      maxByRemCargo,
      maxByItemBudget,
      maxByItemCargo
    );
    if (takeQty <= 0) return;

    const addCost = takeQty * unitCost;
    const addProfit = takeQty * opp.profitPerUnit;
    const addVol = takeQty * unitVol;
    // Use the same minProfit threshold as the main opportunities table
    if (!existing && addProfit < minItemProfit) return;

    remBudget -= addCost;
    remCargo -= addVol;

    if (existing) {
      existing.pick.qty += takeQty;
      existing.pick.totalCost += addCost;
      existing.pick.totalProfit += addProfit;
      existing.pick.totalVolume += addVol;
    } else {
      const pick: TripItemPick = {
        typeId: opp.typeId,
        name: opp.name,
        qty: takeQty,
        unitVolume: unitVol,
        totalVolume: addVol,
        buyPrice: opp.buyPrice,
        sellPrice: opp.sellPrice,
        totalCost: addCost,
        totalProfit: addProfit,
        roiPct: opp.roiPct,
        tradeScore: opp.tradeScore,
        stationId: c.stationId,
        stationName: c.stationName,
        systemId: c.systemId,
        opp,
      };
      const list = pickedByStation.get(c.stationId) ?? [];
      list.push(pick);
      pickedByStation.set(c.stationId, list);
      pickedByType.set(opp.typeId, { pick, candidate: c });
    }
  };

  // Single-pass greedy packing: pick highest-priority items up to full budget/cargo
  for (const c of pool) {
    tryPick(c, Infinity, Infinity);
  }

  return pickedByStation;
}

export function generateTripPlans(params: {
  opportunities: ArbitrageOpportunity[];
  originStation: StationOption | null;
  destStation: StationOption | null;
  universe: UniverseStationsData | null;
  activityMap: Record<number, SystemActivity>;
  buyMethod?: BuyMethod;
  tradeMode: TradeMode;
  routePref: RoutePreference;
  maxBudget: number;
  maxCargo: number;
  maxStops: number;
  minProfit?: number;
}): TripPlan[] {
  const {
    opportunities,
    originStation,
    destStation,
    universe,
    activityMap,
    buyMethod = 'instant',
    tradeMode,
    routePref,
    maxBudget,
    maxCargo,
    maxStops,
    minProfit = 0,
  } = params;

  const maxDistinctItems = tradeMode === 'patient' || buyMethod === 'order' ? 4 : Infinity;
  const minItemProfit = minProfit;

  if (!opportunities.length || !originStation || !destStation) return [];

  const isOriginAll = originStation.stationId === -1;
  const isDestAll = destStation.stationId === -1;

  if (isOriginAll && isDestAll) {
    // Group All->All candidates by both Destination (All->Dest) and Origin (Origin->All)
    // so routes like Jita->Amarr->Dodixie compete fairly by ISK/jump against multi-buy->1 dest.
    interface StationGroup {
      station: StationOption;
      totalProfit: number;
      bestIskPerJump: number;
      opps: ArbitrageOpportunity[];
    }
    const destMap = new Map<number, StationGroup>();
    const originMap = new Map<number, StationGroup>();

    const addGroup = (
      map: Map<number, StationGroup>,
      stId: number | undefined,
      sysId: number | undefined,
      stName: string | undefined,
      sysName: string | undefined,
      regId: number | undefined,
      regName: string | undefined,
      fallbackLabel: string,
      opp: ArbitrageOpportunity
    ) => {
      if (!stId || !sysId) return;
      let grp = map.get(stId);
      if (!grp) {
        grp = {
          station: {
            stationId: stId,
            stationName: stName ?? fallbackLabel,
            systemId: sysId,
            systemName: sysName ?? '',
            regionId: regId ?? -1,
            regionName: regName ?? '',
            security: universe?.systems[String(sysId)]?.[2] ?? 0.5,
            hubKey: null,
          },
          totalProfit: 0,
          bestIskPerJump: 0,
          opps: [],
        };
        map.set(stId, grp);
      }
      grp.totalProfit += opp.totalProfit;
      const j = Math.max(1, opp.destJumps ?? opp.originJumps ?? 1);
      const ipj = opp.totalProfit / j;
      if (ipj > grp.bestIskPerJump) grp.bestIskPerJump = ipj;
      grp.opps.push(opp);
    };

    for (const opp of opportunities) {
      addGroup(
        destMap,
        opp.destStationId,
        opp.destSystemId,
        opp.destStationName,
        opp.destSystemName,
        opp.destRegionId,
        opp.destRegionName,
        'Destination',
        opp
      );
      addGroup(
        originMap,
        opp.originStationId,
        opp.originSystemId,
        opp.originStationName,
        opp.originSystemName,
        opp.originRegionId,
        opp.originRegionName,
        'Origin',
        opp
      );
    }

    const pickTopGroups = (map: Map<number, StationGroup>, limit = 6): StationGroup[] => {
      const all = Array.from(map.values());
      const byProfit = [...all].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 4);
      const byIpj = [...all].sort((a, b) => b.bestIskPerJump - a.bestIskPerJump).slice(0, 4);
      const merged = new Map<number, StationGroup>();
      for (const g of [...byProfit, ...byIpj]) {
        if (!merged.has(g.station.stationId)) merged.set(g.station.stationId, g);
        if (merged.size >= limit) break;
      }
      return Array.from(merged.values());
    };

    const topDests = pickTopGroups(destMap, 6);
    const topOrigins = pickTopGroups(originMap, 6);

    const allPlans: TripPlan[] = [];
    const seenRouteSig = new Set<string>();

    for (const grp of topDests) {
      const subPlans = generateTripPlans({
        ...params,
        opportunities: grp.opps,
        destStation: grp.station,
      });
      for (const p of subPlans) {
        const sig = `in:${p.stops.map((s) => s.stationId).join(',')}->${grp.station.stationId}`;
        if (seenRouteSig.has(sig)) continue;
        seenRouteSig.add(sig);
        allPlans.push(p);
      }
    }

    for (const grp of topOrigins) {
      const subPlans = generateTripPlans({
        ...params,
        opportunities: grp.opps,
        originStation: grp.station,
      });
      for (const p of subPlans) {
        const sig = `out:${grp.station.stationId}->${p.stops.map((s) => s.stationId).join(',')}`;
        if (seenRouteSig.has(sig)) continue;
        seenRouteSig.add(sig);
        allPlans.push(p);
      }
    }

    allPlans.sort((a, b) => b.iskPerJump - a.iskPerJump);
    const top5 = allPlans.slice(0, 5);
    applyPlanLabels(top5);
    return top5;
  }

  const mode: 'allToDest' | 'originToAll' | 'single' = isOriginAll
    ? 'allToDest'
    : isDestAll
    ? 'originToAll'
    : 'single';
  const anchorSystemId = isOriginAll ? destStation.systemId : originStation.systemId;

  // Build station lookup from universe for systemId resolution
  const stationSysMap = new Map<string, { stationId: number; systemId: number }>();
  if (universe) {
    for (const [stId, stName, sysId] of universe.stations) {
      stationSysMap.set(stName, { stationId: stId, systemId: sysId });
    }
  }

  const rankedOpps = [...opportunities]
    .sort((a, b) => b.tradeScore - a.tradeScore || b.totalProfit - a.totalProfit)
    .slice(0, 600);

  const candidates: CandidateItem[] = [];
  for (const opp of rankedOpps) {
    const stName =
      mode === 'allToDest'
        ? opp.originStationName ?? originStation.stationName
        : mode === 'originToAll'
        ? opp.destStationName ?? destStation.stationName
        : originStation.stationName;

    const resolved = stationSysMap.get(stName);
    const stationId =
      (mode === 'allToDest'
        ? opp.originStationId
        : mode === 'originToAll'
        ? opp.destStationId
        : originStation.stationId) ??
      resolved?.stationId ??
      Math.abs(stName.split('').reduce((a, b) => a * 31 + b.charCodeAt(0), 0));

    const systemId =
      (mode === 'allToDest'
        ? opp.originSystemId
        : mode === 'originToAll'
        ? opp.destSystemId
        : originStation.systemId) ??
      resolved?.systemId ??
      anchorSystemId;

    candidates.push({ opp, stationId, stationName: stName, systemId });
  }

  // Group candidate stations with per-goal metrics (profit, ROI, velocity, score)
  const stationMetaMap = new Map<
    number,
    {
      stationId: number;
      stationName: string;
      systemId: number;
      totalProfit: number;
      bestRoi: number;
      bestVelocity: number;
      bestScore: number;
    }
  >();
  for (const c of candidates) {
    if (c.opp.tradeScore <= 25) continue;
    const maxSafeQty = getMaxSafeQty(c.opp, tradeMode);
    if (maxSafeQty <= 0 || maxSafeQty * c.opp.profitPerUnit < minItemProfit) continue;

    const vel = (c.opp.avg7d ?? c.opp.destBuyVol) + 1;
    const turnover = vel / Math.max(1, maxSafeQty);
    const velMetric = turnover * 100 + Math.log10(vel) * 50 + c.opp.tradeScore;

    const cur = stationMetaMap.get(c.stationId);
    if (!cur) {
      stationMetaMap.set(c.stationId, {
        stationId: c.stationId,
        stationName: c.stationName,
        systemId: c.systemId,
        totalProfit: c.opp.totalProfit,
        bestRoi: c.opp.roiPct,
        bestVelocity: velMetric,
        bestScore: c.opp.tradeScore,
      });
    } else {
      cur.totalProfit += c.opp.totalProfit;
      cur.bestRoi = Math.max(cur.bestRoi, c.opp.roiPct);
      cur.bestVelocity = Math.max(cur.bestVelocity, velMetric);
      cur.bestScore = Math.max(cur.bestScore, c.opp.tradeScore);
    }
  }

  const allValidStations = Array.from(stationMetaMap.values());

  const buildPlanFromStations = (
    id: TripPlan['id'],
    title: string,
    subtitle: string,
    selectedStations: typeof allValidStations,
    priorityFn: (c: CandidateItem) => number,
    maxSharePerItem = 0.4,
    excludedTypeIds?: Set<number>
  ): TripPlan | null => {
    const stationIdSet = new Set(selectedStations.map((s) => s.stationId));
    const pickedMap = packItemsForStops(
      stationIdSet,
      candidates,
      tradeMode,
      maxBudget,
      maxCargo,
      priorityFn,
      maxSharePerItem,
      26,
      maxDistinctItems,
      minItemProfit,
      excludedTypeIds
    );

    let activeStations = selectedStations.filter(
      (s) => (pickedMap.get(s.stationId)?.length ?? 0) > 0
    );
    if (activeStations.length === 0) return null;

    let finalPickedMap = pickedMap;
    if (activeStations.length > 1) {
      const stopProfits = activeStations.map((st) => ({
        st,
        profit: (pickedMap.get(st.stationId) ?? []).reduce((a, x) => a + x.totalProfit, 0),
      }));
      const totalPackedProfit = stopProfits.reduce((a, x) => a + x.profit, 0);
      const minStopShare = totalPackedProfit * 0.05;
      const worthwhileStations = stopProfits
        .filter((x) => x.profit >= minStopShare)
        .map((x) => x.st);

      if (worthwhileStations.length > 0 && worthwhileStations.length < activeStations.length) {
        const repacked = packItemsForStops(
          new Set(worthwhileStations.map((s) => s.stationId)),
          candidates,
          tradeMode,
          maxBudget,
          maxCargo,
          priorityFn,
          maxSharePerItem,
          26,
          maxDistinctItems,
          minItemProfit,
          excludedTypeIds
        );
        const repackedActive = worthwhileStations.filter(
          (s) => (repacked.get(s.stationId)?.length ?? 0) > 0
        );
        if (repackedActive.length > 0) {
          activeStations = repackedActive;
          finalPickedMap = repacked;
        }
      }
    }

    const { ordered, legJumps, endJumps, totalJumps } = getExactOptimalOrder(
      activeStations,
      anchorSystemId,
      destStation.systemId,
      mode,
      universe,
      routePref
    );

    let totalCost = 0;
    let totalProfit = 0;
    let totalVolume = 0;
    let scoreSum = 0;
    let itemCount = 0;

    const stops: TripStop[] = ordered.map((st, idx) => {
      const items = finalPickedMap.get(st.stationId) ?? [];
      const stopCost = items.reduce((a, x) => a + x.totalCost, 0);
      const stopProfit = items.reduce((a, x) => a + x.totalProfit, 0);
      const stopVolume = items.reduce((a, x) => a + x.totalVolume, 0);
      totalCost += stopCost;
      totalProfit += stopProfit;
      totalVolume += stopVolume;
      for (const it of items) {
        scoreSum += it.tradeScore;
        itemCount++;
      }
      return {
        stationId: st.stationId,
        stationName: st.stationName,
        systemId: st.systemId,
        security: universe?.systems[String(st.systemId)]?.[2] ?? null,
        jumpsFromPrev: legJumps[idx] ?? 0,
        items,
        stopCost,
        stopProfit,
        stopVolume,
      };
    });

    // Compute full route system path & 1h ship kills along the entire route
    const fullPathSystems: number[] = [];
    if (mode === 'single') {
      fullPathSystems.push(
        ...getRouteSystemPath(originStation.systemId, destStation.systemId, universe, routePref)
      );
    } else if (mode === 'originToAll') {
      let prevSys = anchorSystemId;
      for (const st of ordered) {
        fullPathSystems.push(...getRouteSystemPath(prevSys, st.systemId, universe, routePref));
        prevSys = st.systemId;
      }
    } else {
      if (ordered.length > 0) {
        fullPathSystems.push(
          ...getRouteSystemPath(30000142, ordered[0].systemId, universe, routePref)
        );
      }
      for (let i = 1; i < ordered.length; i++) {
        fullPathSystems.push(
          ...getRouteSystemPath(ordered[i - 1].systemId, ordered[i].systemId, universe, routePref)
        );
      }
      if (ordered.length > 0) {
        fullPathSystems.push(
          ...getRouteSystemPath(ordered[ordered.length - 1].systemId, anchorSystemId, universe, routePref)
        );
      }
    }
    const { totalShipKills, hottestSystem } = summarizePathKills(
      fullPathSystems,
      activityMap,
      universe
    );

    return {
      id,
      title,
      subtitle,
      mode,
      originStationName: mode === 'originToAll' || mode === 'single' ? originStation.stationName : undefined,
      stops,
      finalDestName: mode === 'allToDest' || mode === 'single' ? destStation.stationName : undefined,
      jumpsToFinalDest: endJumps,
      totalJumps,
      totalCost,
      totalProfit,
      totalVolume,
      cargoFillPct: maxCargo > 0 ? Math.min(100, (totalVolume / maxCargo) * 100) : null,
      budgetUsedPct: maxBudget > 0 ? Math.min(100, (totalCost / maxBudget) * 100) : null,
      iskPerJump: totalJumps > 0 ? totalProfit / totalJumps : totalProfit,
      avgScore: itemCount > 0 ? Math.round(scoreSum / itemCount) : 0,
      routeShipKills1h: totalShipKills,
      hottestSystem,
    };
  };

  const effectiveMaxStops = mode === 'single' ? 1 : Math.max(1, Math.min(5, maxStops));

  // Rank stations by estimated ISK/Jump (profit divided by jumps to/from anchor)
  const anchorJumpMap = getSystemJumpMap(anchorSystemId, universe, routePref);
  const getAnchorJumps = (systemId: number) => Math.max(1, anchorJumpMap?.get(systemId) ?? 20);

  const iskPerJumpRanked = [...allValidStations].sort(
    (a, b) => b.totalProfit / getAnchorJumps(b.systemId) - a.totalProfit / getAnchorJumps(a.systemId)
  );

  const profitPriority = (c: CandidateItem) => c.opp.totalProfit;

  // Corridor stop selector: scans ALL stations (pre-filtered in O(1) by proximity & ISK/jump),
  // then only adds stops that are actually worth it by real packed ISK/Jump!
  const selectCorridorStops = (rankedStations: typeof allValidStations) => {
    if (rankedStations.length === 0) return [];
    const chosen = [rankedStations[0]];
    if (effectiveMaxStops === 1) return chosen;

    let curPlan = buildPlanFromStations(
      'trial',
      '',
      '',
      chosen,
      profitPriority,
      0.4
    );
    if (!curPlan) return chosen;

    for (let step = 1; step < effectiveMaxStops; step++) {
      // If both budget and cargo are already >= 98% full, no need to detour further
      const budgetFull = curPlan.budgetUsedPct !== null && curPlan.budgetUsedPct >= 98;
      const cargoFull = curPlan.cargoFillPct !== null && curPlan.cargoFillPct >= 98;
      if (budgetFull || cargoFull) break;

      const remaining = rankedStations.filter(
        (cand) => !chosen.some((c) => c.stationId === cand.stationId)
      );
      if (remaining.length === 0) break;

      // O(1) shortlist across ALL stations: top 15 by ISK/Jump + top 15 closest to current chosen systems
      const shortlistMap = new Map<number, (typeof rankedStations)[0]>();
      for (const s of remaining.slice(0, 15)) {
        shortlistMap.set(s.stationId, s);
      }

      const chosenJumpMaps = chosen.map((c) => getSystemJumpMap(c.systemId, universe, routePref));
      const byProximity = [...remaining]
        .map((s) => {
          let minDist = Infinity;
          for (const jm of chosenJumpMaps) {
            const d = jm?.get(s.systemId);
            if (d !== undefined && d < minDist) minDist = d;
          }
          return { s, minDist };
        })
        .sort((a, b) => a.minDist - b.minDist || b.s.totalProfit - a.s.totalProfit);

      for (const { s } of byProximity.slice(0, 15)) {
        shortlistMap.set(s.stationId, s);
      }

      let bestNext: (typeof rankedStations)[0] | null = null;
      let bestTrialPlan: TripPlan | null = null;
      let bestIskPerJump = -Infinity;

      for (const cand of shortlistMap.values()) {
        const trialPlan = buildPlanFromStations(
          'trial',
          '',
          '',
          [...chosen, cand],
          profitPriority,
          0.4
        );
        if (!trialPlan || trialPlan.totalProfit <= curPlan.totalProfit) continue;

        const detourJumps = Math.max(0, trialPlan.totalJumps - curPlan.totalJumps);
        // Worth-it check: 0 extra jumps is always worth it; otherwise new ISK/Jump must stay >= 85% of current
        const isWorthIt =
          detourJumps === 0 || trialPlan.iskPerJump >= curPlan.iskPerJump * 0.85;
        if (!isWorthIt) continue;

        if (trialPlan.iskPerJump > bestIskPerJump) {
          bestIskPerJump = trialPlan.iskPerJump;
          bestNext = cand;
          bestTrialPlan = trialPlan;
        }
      }

      if (!bestNext || !bestTrialPlan) break;
      chosen.push(bestNext);
      curPlan = bestTrialPlan;
    }

    return chosen;
  };
  const usedStopStationIds = new Set<number>();
  const usedSeedStationIds = new Set<number>();

  const pickDistinctRanked = () => {
    // Prefer stations not visited in previous plans' routes
    const disjoint = iskPerJumpRanked.filter((s) => !usedStopStationIds.has(s.stationId));
    if (disjoint.length > 0) return disjoint;
    // Fallback: at least avoid repeating a previous plan's primary seed station
    return iskPerJumpRanked.filter((s) => !usedSeedStationIds.has(s.stationId));
  };

  const plans: TripPlan[] = [];
  const excludedTypeIds = mode === 'single' ? new Set<number>() : undefined;

  for (let i = 0; i < 5; i++) {
    const pool =
      mode === 'single'
        ? allValidStations
        : plans.length === 0
        ? iskPerJumpRanked
        : pickDistinctRanked();
    if (pool.length === 0) break;

    const selected = mode === 'single' ? [pool[0]] : selectCorridorStops(pool);
    const plan = buildPlanFromStations(
      `plan-${i + 1}`,
      `Plan ${i + 1}`,
      'Sorted by highest ISK / Jump',
      selected,
      profitPriority,
      0.4,
      excludedTypeIds
    );
    if (!plan || plan.stops.length === 0) continue;

    plans.push(plan);
    if (excludedTypeIds) {
      for (const stop of plan.stops) {
        for (const it of stop.items) {
          excludedTypeIds.add(it.typeId);
        }
      }
    } else {
      usedSeedStationIds.add(pool[0].stationId);
      for (const stop of plan.stops) {
        usedStopStationIds.add(stop.stationId);
      }
    }
  }

  // Sort final plans by ISK/Jump (highest first) and label #1..#5
  plans.sort((a, b) => b.iskPerJump - a.iskPerJump);
  applyPlanLabels(plans);

  return plans;
}
