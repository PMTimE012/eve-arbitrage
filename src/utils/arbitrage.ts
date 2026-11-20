import type {
  ArbitrageOpportunity,
  ArbitrageParams,
  EmpireInstantDataset,
  JumpFilter,
  MarketDataset,
} from '../types';
import type { RoutePreference } from './routing';

function passesJumpFilter(jumps: number | undefined, jumpFilter: JumpFilter): boolean {
  if (jumpFilter === 'all' || jumps === undefined) return true;
  if (jumpFilter === 'le5') return jumps <= 5;
  if (jumpFilter === 'le10') return jumps <= 10;
  if (jumpFilter === 'le15') return jumps <= 15;
  return true;
}

type LiquidityRank = 'High' | 'Good' | 'Moderate' | 'Low';
const LIQ_ORDER: Record<LiquidityRank, number> = { Low: 0, Moderate: 1, Good: 2, High: 3 };

function classifyBookLiquidity(
  avg7d: number | null,
  bookVol: number,
  orderCount: number,
  qty: number,
  checkStationDepth: boolean
): LiquidityRank {
  if (avg7d !== null) {
    if (checkStationDepth) {
      if (avg7d >= Math.max(20, qty * 1.5) && bookVol >= Math.max(5, qty) && orderCount >= 2) {
        return 'High';
      }
      if (avg7d >= Math.max(5, qty * 0.5) && bookVol >= 2) {
        return 'Good';
      }
      return avg7d >= 1 ? 'Moderate' : 'Low';
    }
    if (avg7d >= Math.max(20, qty * 1.5)) return 'High';
    if (avg7d >= Math.max(5, qty * 0.5)) return 'Good';
    return avg7d >= 1 ? 'Moderate' : 'Low';
  }
  if (bookVol >= Math.max(50, qty * 2) && orderCount >= 3) return 'High';
  if (bookVol >= Math.max(15, qty) && orderCount >= 2) return 'Good';
  if (bookVol >= 5 && orderCount >= 2) return 'Moderate';
  return 'Low';
}

export function calculateArbitrage(
  dataset: MarketDataset,
  params: ArbitrageParams,
  destMeta?: {
    stationId?: number;
    stationName: string;
    systemId?: number;
    systemName: string;
    regionId: number;
    regionName: string;
    jumps?: number;
  },
  originMeta?: {
    stationId?: number;
    stationName: string;
    systemId?: number;
    systemName: string;
    regionId?: number;
    regionName?: string;
    jumps?: number;
  },
  precomputed?: {
    originKeyCount?: number;
    destKeyCount?: number;
  }
): ArbitrageOpportunity[] {
  const {
    originBook: originOrders,
    destBook: destOrders,
    buyMethod = 'instant',
    tradeMode,
    maxBudget,
    maxCargo,
    salesTaxPct,
    brokerFeePct,
    minRoiPct,
    minProfit,
    liquidityTier,
    jumpFilter,
    skipBaitOrders,
    searchQuery,
    routeJumps,
    originRegionId,
    destRegionId,
  } = params;

  if (!originOrders || !destOrders || originOrders === destOrders) return [];

  const query = searchQuery.trim().toLowerCase();
  const taxMultiplier =
    tradeMode === 'patient'
      ? 1 - (salesTaxPct + brokerFeePct) / 100
      : 1 - salesTaxPct / 100;
  const buyMultiplier = buyMethod === 'order' ? 1 + brokerFeePct / 100 : 1;

  const results: ArbitrageOpportunity[] = [];

  // Always iterate over the smaller order book without allocating Object.keys on the huge book
  let iterateKeys: string[];
  if (precomputed?.originKeyCount !== undefined) {
    const destKeys = Object.keys(destOrders);
    iterateKeys =
      destKeys.length <= precomputed.originKeyCount
        ? destKeys
        : Object.keys(originOrders);
  } else if (precomputed?.destKeyCount !== undefined) {
    const originKeys = Object.keys(originOrders);
    iterateKeys =
      originKeys.length <= precomputed.destKeyCount
        ? originKeys
        : Object.keys(destOrders);
  } else {
    const originKeys = Object.keys(originOrders);
    const destKeys = Object.keys(destOrders);
    iterateKeys = originKeys.length <= destKeys.length ? originKeys : destKeys;
  }

  for (const typeIdStr of iterateKeys) {
    const originBook = originOrders[typeIdStr];
    const destBook = destOrders[typeIdStr];
    if (!originBook || !destBook) continue;
    if (buyMethod === 'order') {
      if (!originBook.b.length) continue;
    } else {
      if (!originBook.s.length) continue;
    }
    // In instant sell mode, destination must have buy orders. In patient sell order mode, destination must have sell orders.
    if (tradeMode === 'instant' && !destBook.b.length) continue;
    if (tradeMode === 'patient' && !destBook.s.length) continue;

    const meta = dataset.items[typeIdStr];
    if (!meta) continue;

    if (query && !meta.n.toLowerCase().includes(query)) continue;

    const unitVol = meta.v > 0 ? meta.v : 0.01;

    // Anti-bait: skip 1-2 unit outlier orders that are >25% off the 2nd order level
    let originSells = originBook.s;
    if (
      skipBaitOrders &&
      originSells.length > 1 &&
      originSells[0][1] <= 2 &&
      originSells[0][0] < originSells[1][0] * 0.75
    ) {
      originSells = originSells.slice(1);
    }

    let originBuys = originBook.b;
    if (
      skipBaitOrders &&
      originBuys.length > 1 &&
      originBuys[0][1] <= 2 &&
      originBuys[0][0] > originBuys[1][0] * 1.25
    ) {
      originBuys = originBuys.slice(1);
    }

    let destBuys = destBook.b;
    if (
      skipBaitOrders &&
      destBuys.length > 1 &&
      destBuys[0][1] <= 2 &&
      destBuys[0][0] > destBuys[1][0] * 1.25
    ) {
      destBuys = destBuys.slice(1);
    }

    const bestDestTarget =
      tradeMode === 'patient' ? destBook.s[0][0] : destBuys[0][0];

    if (buyMethod === 'order') {
      if (!originBuys.length) continue;
      if (tradeMode === 'instant' && !destBuys.length) continue;
      // Filter out unrealistic lowball/troll buy orders at origin (e.g. 0.01 ISK or <10% of dest target / <5% of origin sell)
      const bestOriginBuy = originBuys[0][0];
      const isLowballOriginBuy =
        bestOriginBuy < bestDestTarget * 0.1 ||
        (originSells.length > 0 && bestOriginBuy < originSells[0][0] * 0.05);
      if (skipBaitOrders && isLowballOriginBuy) continue;
    } else {
      if (!originSells.length) continue;
      if (tradeMode === 'instant' && !destBuys.length) continue;
    }

    const bestOriginBuyCost =
      buyMethod === 'order' ? originBuys[0][0] * buyMultiplier : originSells[0][0];

    const firstUnitNetRev = bestDestTarget * taxMultiplier;
    if (firstUnitNetRev <= bestOriginBuyCost) continue;

    const firstUnitRoi = ((firstUnitNetRev - bestOriginBuyCost) / bestOriginBuyCost) * 100;
    if (firstUnitRoi < minRoiPct) continue;

    // 7-Day Avg/d real completed trading volume in destination (and origin for buyer mode)
    const effectiveDestRegionId = destMeta?.regionId ?? destRegionId;
    const regionHist =
      effectiveDestRegionId !== undefined
        ? dataset.history7d?.[String(effectiveDestRegionId)]
        : undefined;
    const avg7d: number | null = regionHist ? (regionHist[typeIdStr] ?? 0) : null;

    const effectiveOriginRegionId = originMeta?.regionId ?? originRegionId;
    const originRegionHist =
      effectiveOriginRegionId !== undefined
        ? dataset.history7d?.[String(effectiveOriginRegionId)]
        : undefined;
    const originAvg7d: number | null = originRegionHist
      ? (originRegionHist[typeIdStr] ?? 0)
      : null;

    // Walk order book levels to find realistic fill quantity within budget, cargo & profitability
    let qty = 0;
    let totalCost = 0;
    let totalGrossRev = 0;
    let totalVol = 0;

    if (buyMethod === 'instant' && tradeMode === 'instant') {
      // Walk both origin sell levels and destination buy levels
      let sIdx = 0;
      let bIdx = 0;
      let sRem = originSells[0][1];
      let bRem = destBuys[0][1];

      while (sIdx < originSells.length && bIdx < destBuys.length) {
        const sPrice = originSells[sIdx][0];
        const bPrice = destBuys[bIdx][0];
        const unitNet = bPrice * taxMultiplier;
        if (unitNet <= sPrice) break;

        const unitRoi = ((unitNet - sPrice) / sPrice) * 100;
        if (unitRoi < minRoiPct) break;

        const maxByBudget =
          maxBudget > 0 ? Math.floor((maxBudget - totalCost) / sPrice) : Infinity;
        const maxByCargo =
          maxCargo > 0 ? Math.floor((maxCargo - totalVol) / unitVol) : Infinity;

        const take = Math.min(sRem, bRem, maxByBudget, maxByCargo);
        if (take <= 0) break;

        qty += take;
        totalCost += take * sPrice;
        totalGrossRev += take * bPrice;
        totalVol += take * unitVol;

        sRem -= take;
        bRem -= take;
        if (sRem === 0) {
          sIdx++;
          if (sIdx < originSells.length) sRem = originSells[sIdx][1];
        }
        if (bRem === 0) {
          bIdx++;
          if (bIdx < destBuys.length) bRem = destBuys[bIdx][1];
        }
      }
    } else if (buyMethod === 'instant' && tradeMode === 'patient') {
      // Instant Buy -> Sell Order: buy from origin sell levels, sell at dest lowest sell price (capped by 1d regional demand)
      const destSellPrice = destBook.s[0][0];
      const unitNet = destSellPrice * taxMultiplier;
      const patientDemandCap = avg7d !== null ? Math.max(1, Math.floor(avg7d)) : Infinity;

      for (const [sPrice, sAvail] of originSells) {
        if (unitNet <= sPrice) break;
        const unitRoi = ((unitNet - sPrice) / sPrice) * 100;
        if (unitRoi < minRoiPct) break;

        const maxByDemand = patientDemandCap - qty;
        if (maxByDemand <= 0) break;

        const maxByBudget =
          maxBudget > 0 ? Math.floor((maxBudget - totalCost) / sPrice) : Infinity;
        const maxByCargo =
          maxCargo > 0 ? Math.floor((maxCargo - totalVol) / unitVol) : Infinity;

        const take = Math.min(sAvail, maxByDemand, maxByBudget, maxByCargo);
        if (take <= 0) break;

        qty += take;
        totalCost += take * sPrice;
        totalGrossRev += take * destSellPrice;
        totalVol += take * unitVol;
      }
    } else if (buyMethod === 'order' && tradeMode === 'instant') {
      // Buy Order -> Instant Sell: place buy order at origin & instant-sell to dest buy orders
      const unitBuyCost = originBuys[0][0] * buyMultiplier;
      const originDemandCap = originAvg7d !== null ? Math.max(1, Math.floor(originAvg7d)) : Infinity;

      for (const [bPrice, bAvail] of destBuys) {
        const unitNet = bPrice * taxMultiplier;
        if (unitNet <= unitBuyCost) break;
        const unitRoi = ((unitNet - unitBuyCost) / unitBuyCost) * 100;
        if (unitRoi < minRoiPct) break;

        const maxByOrigin = originDemandCap - qty;
        if (maxByOrigin <= 0) break;

        const maxByBudget =
          maxBudget > 0 ? Math.floor((maxBudget - totalCost) / unitBuyCost) : Infinity;
        const maxByCargo =
          maxCargo > 0 ? Math.floor((maxCargo - totalVol) / unitVol) : Infinity;

        const take = Math.min(bAvail, maxByOrigin, maxByBudget, maxByCargo);
        if (take <= 0) break;

        qty += take;
        totalCost += take * unitBuyCost;
        totalGrossRev += take * bPrice;
        totalVol += take * unitVol;
      }
    } else {
      // Buy Order -> Sell Order: place buy order at origin & place sell order at dest
      const unitBuyCost = originBuys[0][0] * buyMultiplier;
      const destSellPrice = destBook.s[0][0];
      const unitNet = destSellPrice * taxMultiplier;
      if (unitNet > unitBuyCost) {
        const unitRoi = ((unitNet - unitBuyCost) / unitBuyCost) * 100;
        if (unitRoi >= minRoiPct) {
          const originDemandCap = originAvg7d !== null ? Math.max(1, Math.floor(originAvg7d)) : Infinity;
          const destDemandCap = avg7d !== null ? Math.max(1, Math.floor(avg7d)) : Infinity;
          const maxByBudget =
            maxBudget > 0 ? Math.floor(maxBudget / unitBuyCost) : Infinity;
          const maxByCargo =
            maxCargo > 0 ? Math.floor(maxCargo / unitVol) : Infinity;
          const take = Math.min(originDemandCap, destDemandCap, maxByBudget, maxByCargo);
          if (take > 0 && Number.isFinite(take)) {
            qty = take;
            totalCost = take * unitBuyCost;
            totalGrossRev = take * destSellPrice;
            totalVol = take * unitVol;
          }
        }
      }
    }

    if (qty <= 0 || totalCost <= 0) continue;

    const totalRevenueAfterTax = totalGrossRev * taxMultiplier;
    const totalProfit = totalRevenueAfterTax - totalCost;
    if (totalProfit < minProfit) continue;

    const avgBuy = totalCost / qty;
    const avgSell = totalGrossRev / qty;
    const profitPerUnit = totalProfit / qty;
    const roiPct = (totalProfit / totalCost) * 100;
    const profitPerM3 = totalVol > 0 ? totalProfit / totalVol : 0;

    // Primary Liquidity Classification (in buyer mode, bottleneck of BOTH origin supply & dest demand)
    const buyersCount = destBook.b.length;
    const destLiq = classifyBookLiquidity(
      avg7d,
      destBook.bv,
      buyersCount,
      qty,
      tradeMode === 'instant'
    );
    let liquidityLabel: LiquidityRank = destLiq;
    if (buyMethod === 'order') {
      const originLiq = classifyBookLiquidity(
        originAvg7d,
        originBook.bv,
        originBook.b.length,
        qty,
        true
      );
      liquidityLabel = LIQ_ORDER[originLiq] < LIQ_ORDER[destLiq] ? originLiq : destLiq;
    }

    if (liquidityTier === 'moderate') {
      if (liquidityLabel === 'Low') continue;
    } else if (liquidityTier === 'good') {
      if (liquidityLabel === 'Low' || liquidityLabel === 'Moderate') continue;
    } else if (liquidityTier === 'high') {
      if (liquidityLabel !== 'High') continue;
    }

    // Pro-Trader Score (0-100):
    // 45% Real 7d Trade Velocity + Buy Order Depth
    // 33% Budget-Aware Net Profit + 8% Capital-Weighted ROI
    // 14% Profit/Jump (ISK/hr proxy) & Route Speed
    const destBuyIsk = destBook.b.reduce((acc, [p, q]) => acc + p * q, 0);
    const coverageRatio = destBook.bv / Math.max(1, qty);

    const effectiveVelAvg7d =
      buyMethod === 'order' && originAvg7d !== null
        ? avg7d !== null
          ? Math.min(avg7d, originAvg7d)
          : originAvg7d
        : avg7d;

    let realVelPts = 0;
    if (effectiveVelAvg7d !== null) {
      const dailyIsk = effectiveVelAvg7d * avgSell;
      const unitVelPts = Math.min(10, Math.max(0, Math.log10(effectiveVelAvg7d + 1) * 4.2));
      const iskVelPts = Math.min(11, Math.max(0, (Math.log10(dailyIsk + 1) - 5.5) * 3.6));
      const turnoverPts = Math.min(9, (effectiveVelAvg7d / Math.max(1, qty)) * 4.5);
      realVelPts = unitVelPts + iskVelPts + turnoverPts; // max 30
    } else {
      const unitLiqPts =
        destBook.bv > 0
          ? Math.min(10, Math.max(0, (Math.log10(destBook.bv + 1) - 0.7) * 5))
          : 0;
      const iskLiqPts =
        destBuyIsk > 0
          ? Math.min(11, Math.max(0, (Math.log10(destBuyIsk + 1) - 6.5) * 3.6))
          : 0;
      const coveragePts = destBook.bv > 0 ? Math.min(9, coverageRatio * 1.8) : 0;
      realVelPts = unitLiqPts + iskLiqPts + coveragePts;
    }

    const buyDepthPts =
      destBook.bv > 0
        ? Math.min(8, Math.max(0, Math.log10(destBook.bv + 1) * 2.5)) +
          Math.min(7, coverageRatio * 2)
        : 0;

    const liqTotalPts = Math.min(45, realVelPts + buyDepthPts);

    const profitTarget = maxBudget > 0 ? Math.max(2_000_000, maxBudget * 0.25) : 50_000_000;
    const profitPts = Math.min(33, Math.sqrt(Math.max(0, totalProfit) / profitTarget) * 33);

    const rawRoiPts = Math.min(8, Math.max(0, (roiPct - 5) * 0.2));
    const budgetWeight =
      maxBudget > 0 ? Math.min(1, Math.sqrt(totalCost / maxBudget / 0.35)) : 1;
    const roiPts = rawRoiPts * budgetWeight;

    const effectiveJumps = destMeta?.jumps ?? originMeta?.jumps ?? routeJumps;
    if (jumpFilter !== 'all' && effectiveJumps !== undefined) {
      if (jumpFilter === 'le5' && effectiveJumps > 5) continue;
      if (jumpFilter === 'le10' && effectiveJumps > 10) continue;
      if (jumpFilter === 'le15' && effectiveJumps > 15) continue;
    }

    let jumpPts = 7;
    if (effectiveJumps !== undefined) {
      const profitPerJump = totalProfit / Math.max(1, effectiveJumps);
      const iskPerJumpPts = Math.min(
        9,
        Math.max(0, (Math.log10(profitPerJump + 1) - 4.7) * 4.5)
      );
      const speedPts = Math.max(0, Math.min(5, 5 - Math.max(0, effectiveJumps - 5) * 0.13));
      jumpPts = iskPerJumpPts + speedPts;
    }

    let rawScore = Math.round(liqTotalPts + profitPts + roiPts + jumpPts);

    // Origin seller depth penalty (after Anti-Bait filtering, skipped when placing buy orders)
    if (buyMethod !== 'order') {
      const originSellerLevels = originSells.length;
      if (originSellerLevels <= 1) {
        rawScore = Math.min(Math.round(rawScore * 0.8), 55);
      } else if (originSellerLevels === 2) {
        rawScore = Math.round(rawScore * 0.9);
      } else if (originSellerLevels === 3) {
        rawScore = Math.round(rawScore * 0.96);
      }
    }

    // Hard caps based on 7-Day Avg/d real market velocity & buyer depth
    if (effectiveVelAvg7d !== null && effectiveVelAvg7d === 0) {
      rawScore = Math.min(rawScore, 20);
    } else if (effectiveVelAvg7d !== null && effectiveVelAvg7d < 1) {
      rawScore = Math.min(rawScore, 35);
    } else if (destBook.bv === 0) {
      rawScore = Math.min(rawScore, 25);
    } else if (destBook.bv < 5) {
      rawScore = Math.min(rawScore, 40);
    } else if (buyersCount <= 1) {
      rawScore = Math.min(rawScore, 50);
    } else if (buyMethod === 'order' && originBook.bv < 2 && originBook.sv === 0) {
      rawScore = Math.min(rawScore, 40);
    }

    // Spread sanity guard in Patient mode: if dest sell price is >10x best buy price,
    // it's likely a meme/manipulated sell wall with no real demand at that price
    if (tradeMode === 'patient' && destBuys.length > 0) {
      const bestDestBuy = destBuys[0][0];
      if (avgSell > bestDestBuy * 10) {
        rawScore = Math.min(rawScore, 25);
      } else if (avgSell > bestDestBuy * 5) {
        rawScore = Math.min(rawScore, 45);
      }
    }

    // Spread sanity guard in Buy Order mode (when Anti-Bait is off): penalize extreme lowball origin buy orders
    if (buyMethod === 'order') {
      const bestOriginBuy = originBuys[0][0];
      const isLowball =
        bestOriginBuy < bestDestTarget * 0.1 ||
        (originSells.length > 0 && bestOriginBuy < originSells[0][0] * 0.05);
      if (isLowball) {
        rawScore = Math.min(rawScore, 25);
      } else if (bestOriginBuy < bestDestTarget * 0.25) {
        rawScore = Math.min(rawScore, 45);
      }
    }

    const tradeScore = Math.max(0, Math.min(100, rawScore));
    const scoreLabel: 'High' | 'Good' | 'Moderate' | 'Risky' =
      tradeScore >= 75
        ? 'High'
        : tradeScore >= 55
        ? 'Good'
        : tradeScore >= 35
        ? 'Moderate'
        : 'Risky';

    const cargoFillPct =
      maxCargo > 0 ? Math.min(100, (totalVol / maxCargo) * 100) : null;
    const budgetUsedPct =
      maxBudget > 0 ? Math.min(100, (totalCost / maxBudget) * 100) : null;

    results.push({
      typeId: Number(typeIdStr),
      name: meta.n,
      unitVolume: unitVol,
      buyPrice: avgBuy,
      sellPrice: avgSell,
      profitPerUnit,
      roiPct,
      profitPerM3,
      recommendedQty: qty,
      totalCost,
      budgetUsedPct,
      totalRevenueAfterTax,
      totalVolume: totalVol,
      cargoFillPct,
      totalProfit,
      tradeScore,
      scoreLabel,
      liquidityLabel,
      avg7d,
      originSellVol: originBook.sv,
      originBuyVol: originBook.bv,
      destBuyVol: destBook.bv,
      destSellVol: destBook.sv,
      originSells,
      originBuys,
      destBuys,
      destSells: destBook.s,
      originStationId: originMeta?.stationId,
      originStationName: originMeta?.stationName,
      originSystemId: originMeta?.systemId,
      originSystemName: originMeta?.systemName,
      originRegionId: effectiveOriginRegionId,
      originRegionName: originMeta?.regionName,
      originJumps: originMeta?.jumps,
      destStationId: destMeta?.stationId,
      destStationName: destMeta?.stationName,
      destSystemId: destMeta?.systemId,
      destSystemName: destMeta?.systemName,
      destRegionId: destMeta?.regionId,
      destRegionName: destMeta?.regionName,
      destJumps: destMeta?.jumps,
    });
  }

  return results;
}

function getPreloadedStations(dataset: MarketDataset) {
  const map = new Map<number, {
    stationId: number;
    stationName: string;
    systemId: number;
    systemName: string;
    regionId: number;
    regionName: string;
  }>();

  for (const s of [...dataset.topStations, ...(dataset.fwStations ?? [])]) {
    if (!map.has(s.stationId) && dataset.orders[String(s.stationId)]) {
      map.set(s.stationId, s);
    }
  }
  return Array.from(map.values());
}

function recordOpportunity(
  bestByItem: Map<number, ArbitrageOpportunity>,
  tripPoolByItem: Map<number, ArbitrageOpportunity[]> | null,
  opp: ArbitrageOpportunity
) {
  const existing = bestByItem.get(opp.typeId);
  if (!existing || opp.tradeScore > existing.tradeScore) {
    bestByItem.set(opp.typeId, opp);
  }
  if (tripPoolByItem) {
    let arr = tripPoolByItem.get(opp.typeId);
    if (!arr) {
      tripPoolByItem.set(opp.typeId, [opp]);
    } else if (arr.length < 3) {
      arr.push(opp);
    } else {
      // Replace the lowest-scoring station if this one is better
      let minIdx = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].tradeScore < arr[minIdx].tradeScore) minIdx = i;
      }
      if (opp.tradeScore > arr[minIdx].tradeScore) {
        arr[minIdx] = opp;
      }
    }
  }
}

export function calculateAllHubsArbitrage(
  dataset: MarketDataset,
  originSystemId: number,
  originStationId: number,
  params: Omit<ArbitrageParams, 'destBook'>,
  empireData?: EmpireInstantDataset | null,
  jumpMap?: Map<number, number> | null,
  routePref: RoutePreference = 'highsec',
  tripCandidatesOut?: ArbitrageOpportunity[]
): ArbitrageOpportunity[] {
  const bestByItem = new Map<number, ArbitrageOpportunity>();
  const tripPoolByItem = tripCandidatesOut ? new Map<number, ArbitrageOpportunity[]>() : null;
  const hubJumps = dataset.jumpsFromHubs?.[String(originStationId)];
  const originKeyCount = params.originBook ? Object.keys(params.originBook).length : 0;

  for (const st of getPreloadedStations(dataset)) {
    if (st.stationId === originStationId) continue;
    const stBook = dataset.orders[String(st.stationId)];
    if (!stBook) continue;

    const route = dataset.routes[`${originSystemId}->${st.systemId}`];
    const jumps =
      jumpMap?.get(st.systemId) ??
      (routePref === 'shortest' ? route?.shortestJumps : route?.secureJumps) ??
      hubJumps?.[String(st.systemId)];

    if (!passesJumpFilter(jumps, params.jumpFilter)) continue;

    const list = calculateArbitrage(
      dataset,
      { ...params, destBook: stBook },
      {
        stationId: st.stationId,
        stationName: st.stationName,
        systemId: st.systemId,
        systemName: st.systemName,
        regionId: st.regionId,
        regionName: st.regionName,
        jumps,
      },
      undefined,
      { originKeyCount }
    );

    for (const opp of list) {
      recordOpportunity(bestByItem, tripPoolByItem, opp);
    }
  }

  // In Instant Sell mode, also scan ALL High/Low-Sec Empire stations!
  if (params.tradeMode === 'instant' && empireData) {
    for (const [stIdStr, stBook] of Object.entries(empireData.orders)) {
      const st = empireData.stations[stIdStr];
      if (!st || st.stationId === originStationId) continue;
      const jumps = jumpMap?.get(st.systemId) ?? hubJumps?.[String(st.systemId)];
      if (params.jumpFilter !== 'all' && jumps === undefined) continue;
      if (!passesJumpFilter(jumps, params.jumpFilter)) continue;

      const list = calculateArbitrage(
        dataset,
        { ...params, destBook: stBook },
        {
          stationId: st.stationId,
          stationName: st.stationName,
          systemId: st.systemId,
          systemName: st.systemName,
          regionId: st.regionId,
          regionName: st.regionName,
          jumps,
        },
        undefined,
        { originKeyCount }
      );

      for (const opp of list) {
        recordOpportunity(bestByItem, tripPoolByItem, opp);
      }
    }
  }

  if (tripPoolByItem && tripCandidatesOut) {
    for (const arr of tripPoolByItem.values()) {
      tripCandidatesOut.push(...arr);
    }
  }

  return Array.from(bestByItem.values());
}

export function calculateAllOriginHubsArbitrage(
  dataset: MarketDataset,
  destSystemId: number,
  destStationId: number,
  params: Omit<ArbitrageParams, 'originBook'>,
  empireData?: EmpireInstantDataset | null,
  jumpMap?: Map<number, number> | null,
  routePref: RoutePreference = 'highsec',
  tripCandidatesOut?: ArbitrageOpportunity[]
): ArbitrageOpportunity[] {
  const bestByItem = new Map<number, ArbitrageOpportunity>();
  const tripPoolByItem = tripCandidatesOut ? new Map<number, ArbitrageOpportunity[]>() : null;
  const hubJumps = dataset.jumpsFromHubs?.[String(destStationId)];
  const destKeyCount = params.destBook ? Object.keys(params.destBook).length : 0;

  for (const st of getPreloadedStations(dataset)) {
    if (st.stationId === destStationId) continue;
    const stBook = dataset.orders[String(st.stationId)];
    if (!stBook) continue;

    const route = dataset.routes[`${st.systemId}->${destSystemId}`];
    const jumps =
      jumpMap?.get(st.systemId) ??
      (routePref === 'shortest' ? route?.shortestJumps : route?.secureJumps) ??
      hubJumps?.[String(st.systemId)];

    if (!passesJumpFilter(jumps, params.jumpFilter)) continue;

    const list = calculateArbitrage(
      dataset,
      { ...params, originBook: stBook },
      undefined,
      {
        stationId: st.stationId,
        stationName: st.stationName,
        systemId: st.systemId,
        systemName: st.systemName,
        regionId: st.regionId,
        regionName: st.regionName,
        jumps,
      },
      { destKeyCount }
    );

    for (const opp of list) {
      recordOpportunity(bestByItem, tripPoolByItem, opp);
    }
  }

  // In Instant Sell mode, also scan ALL High/Low-Sec Empire stations!
  if (params.tradeMode === 'instant' && empireData) {
    for (const [stIdStr, stBook] of Object.entries(empireData.orders)) {
      const st = empireData.stations[stIdStr];
      if (!st || st.stationId === destStationId) continue;
      const jumps = jumpMap?.get(st.systemId) ?? hubJumps?.[String(st.systemId)];
      if (params.jumpFilter !== 'all' && jumps === undefined) continue;
      if (!passesJumpFilter(jumps, params.jumpFilter)) continue;

      const list = calculateArbitrage(
        dataset,
        { ...params, originBook: stBook },
        undefined,
        {
          stationId: st.stationId,
          stationName: st.stationName,
          systemId: st.systemId,
          systemName: st.systemName,
          regionId: st.regionId,
          regionName: st.regionName,
          jumps,
        },
        { destKeyCount }
      );

      for (const opp of list) {
        recordOpportunity(bestByItem, tripPoolByItem, opp);
      }
    }
  }

  if (tripPoolByItem && tripCandidatesOut) {
    for (const arr of tripPoolByItem.values()) {
      tripCandidatesOut.push(...arr);
    }
  }

  return Array.from(bestByItem.values());
}

export function formatISK(value: number, compact = false): string {
  if (!Number.isFinite(value)) return '0 ISK';
  if (compact) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatVolume(m3: number): string {
  if (m3 >= 1000) {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(m3)} m³`;
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(m3)} m³`;
}
