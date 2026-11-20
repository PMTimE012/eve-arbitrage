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
  id: 'fastest' | 'maxProfit' | 'safest';
  title: string;
  subtitle: string;
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
  maxSharePerItem = 0.4,
  minItemScore = 26,
  maxDistinctItems = Infinity
): Map<number, TripItemPick[]> {
  const pool = candidates
    .filter((c) => chosenStationIds.has(c.stationId) && c.opp.tradeScore >= minItemScore)
    .sort((a, b) => priorityFn(b) - priorityFn(a));

  let remBudget = maxBudget > 0 ? maxBudget : Infinity;
  let remCargo = maxCargo > 0 ? maxCargo : Infinity;
  const perItemBudgetCap = maxBudget > 0 ? maxBudget * maxSharePerItem : Infinity;
  const perItemCargoCap = maxCargo > 0 ? maxCargo * maxSharePerItem : Infinity;

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
    // Prevent micro-splitting: each new item pick must yield > 200K ISK profit
    if (!existing && addProfit <= 200_000) return;

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

  // Pass 1: Diversified packing (cap each single item at 40% of budget/cargo)
  for (const c of pool) {
    if (pickedByType.has(c.opp.typeId)) continue;
    tryPick(c, perItemBudgetCap, perItemCargoCap);
  }

  // Pass 2: Top up remaining space/budget only if fewer than 3 items or leftover capacity exists
  if (remBudget > 500_000 && remCargo > 1) {
    for (const c of pool) {
      tryPick(c, Infinity, Infinity);
    }
  }

  return pickedByStation;
}

export function generateThreeTripPlans(params: {
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
  } = params;

  const maxDistinctItems = tradeMode === 'patient' || buyMethod === 'order' ? 4 : Infinity;

  if (!opportunities.length || !originStation || !destStation) return [];

  const isOriginAll = originStation.stationId === -1;
  const isDestAll = destStation.stationId === -1;
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
    if (maxSafeQty <= 0 || maxSafeQty * c.opp.profitPerUnit <= 200_000) continue;

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
    maxSharePerItem = 0.4
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
      maxDistinctItems
    );

    const activeStations = selectedStations.filter(
      (s) => (pickedMap.get(s.stationId)?.length ?? 0) > 0
    );
    if (activeStations.length === 0) return null;

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
      const items = pickedMap.get(st.stationId) ?? [];
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

  // Corridor stop selector: picks the best #1 seed station for the plan's goal,
  // then only adds stops that lie along the route back to anchor (minimal detour!)
  const selectCorridorStops = (rankedStations: typeof allValidStations) => {
    if (rankedStations.length === 0) return [];
    if (effectiveMaxStops === 1) return [rankedStations[0]];

    const chosen = [rankedStations[0]];
    const baseJumps = getExactOptimalOrder(
      chosen,
      anchorSystemId,
      destStation.systemId,
      mode,
      universe,
      routePref
    ).totalJumps;

    const maxAllowedTotal = baseJumps + 6; // Max +6 detour jumps for extra stops

    for (let step = 1; step < effectiveMaxStops; step++) {
      let bestNext: (typeof rankedStations)[0] | null = null;
      let bestScore = -Infinity;

      for (let i = 1; i < Math.min(rankedStations.length, 40); i++) {
        const cand = rankedStations[i];
        if (chosen.some((c) => c.stationId === cand.stationId)) continue;

        const trial = getExactOptimalOrder(
          [...chosen, cand],
          anchorSystemId,
          destStation.systemId,
          mode,
          universe,
          routePref
        );
        if (trial.totalJumps > maxAllowedTotal) continue;

        // Prefer stations closer to the corridor (smaller detour + higher rank)
        const rankBonus = (40 - i) * 2;
        const detourPenalty = (trial.totalJumps - baseJumps) * 15;
        const score = rankBonus - detourPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestNext = cand;
        }
      }

      if (!bestNext) break;
      chosen.push(bestNext);
    }

    return chosen;
  };

  // All 3 plans optimize for Max Total Profit across 3 distinct routes/corridors
  const maxProfitRanked = [...allValidStations].sort(
    (a, b) => b.totalProfit - a.totalProfit
  );

  const profitPriority = (c: CandidateItem) => c.opp.totalProfit;
  const usedStopStationIds = new Set<number>();
  const usedSeedStationIds = new Set<number>();

  const pickDistinctRanked = () => {
    // Prefer stations not visited in previous plans' routes
    const disjoint = maxProfitRanked.filter((s) => !usedStopStationIds.has(s.stationId));
    if (disjoint.length > 0) return disjoint;
    // Fallback: at least avoid repeating a previous plan's primary seed station
    return maxProfitRanked.filter((s) => !usedSeedStationIds.has(s.stationId));
  };

  const planConfigs: { id: TripPlan['id']; title: string; subtitle: string }[] = [
    {
      id: 'maxProfit',
      title: 'Plan 1: Max Total Profit (Route A)',
      subtitle: 'Top profit corridor filling cargo & budget',
    },
    {
      id: 'fastest',
      title: 'Plan 2: Max Total Profit (Route B)',
      subtitle: '2nd distinct high-profit corridor',
    },
    {
      id: 'safest',
      title: 'Plan 3: Max Total Profit (Route C)',
      subtitle: '3rd distinct high-profit corridor',
    },
  ];

  const plans: TripPlan[] = [];
  for (const cfg of planConfigs) {
    const pool = plans.length === 0 ? maxProfitRanked : pickDistinctRanked();
    if (pool.length === 0) break;

    const selected = selectCorridorStops(pool);
    const plan = buildPlanFromStations(
      cfg.id,
      cfg.title,
      cfg.subtitle,
      selected,
      profitPriority,
      0.4
    );
    if (!plan || plan.stops.length === 0) continue;

    plans.push(plan);
    usedSeedStationIds.add(pool[0].stationId);
    for (const stop of plan.stops) {
      usedStopStationIds.add(stop.stationId);
    }
  }

  return plans;
}
