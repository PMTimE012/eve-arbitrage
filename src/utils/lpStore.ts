import type { FwLpOffer, HubInfo, MarketDataset, OrderLevel } from '../types';

export type LpSellMethod = 'instant' | 'order';

export interface LpRequiredItemBreakdown {
  typeId: number;
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
}

export interface LpOfferEvaluation {
  offerId: number;
  typeId: number;
  name: string;
  unitVolume: number;
  quantity: number;
  lpCost: number;
  iskCost: number;
  akCost: number;
  requiredItemsCost: number;
  missingReqPrice: boolean;
  requiredItemsDetail: LpRequiredItemBreakdown[];
  totalCostPerRedeem: number;
  sellHub: HubInfo;
  rawSellUnitPrice: number;
  grossSellUnitPrice: number;
  priceCappedByHist: boolean;
  grossRevenuePerRedeem: number;
  feesPerRedeem: number;
  netRevenuePerRedeem: number;
  netProfitPerRedeem: number;
  iskPerLp: number;
  roiPct: number;
  avgDailyVol7d: number | null;
  trendPct7d: number | null;
  activeDays14d: number | null;
  hubBuyVol: number;
  hubSellVol: number;
  destBuys: OrderLevel[];
  destSells: OrderLevel[];
  maxRedemptionsFromLp: number;
  totalProfitForLp: number;
  totalIskRequiredForLp: number;
  totalVolumeForLp: number;
  lowLiquidity: boolean;
}

export interface EvaluateLpParams {
  offers: FwLpOffer[];
  dataset: MarketDataset;
  sellHubKey: string; // 'best' or hub.key ('jita', 'amarr', etc.)
  sellMethod: LpSellMethod;
  salesTaxPct: number;
  brokerFeePct: number;
  availableLp: number;
  minIskPerLp: number;
  minDailyVol: number;
  hideMissingReq: boolean;
  hideUnprofitable: boolean;
  searchQuery: string;
}

function evaluateOfferAtHub(
  offer: FwLpOffer,
  hub: HubInfo,
  dataset: MarketDataset,
  sellMethod: LpSellMethod,
  salesTaxPct: number,
  brokerFeePct: number,
  availableLp: number
): LpOfferEvaluation | null {
  const itemMeta = dataset.items[String(offer.typeId)];
  if (!itemMeta) return null;

  const hubOrders = dataset.orders[String(hub.stationId)];
  if (!hubOrders) return null;

  const itemBook = hubOrders[String(offer.typeId)];
  if (!itemBook) return null;

  const rawSellUnitPrice =
    sellMethod === 'instant'
      ? itemBook.b[0]?.[0] ?? 0
      : itemBook.s[0]?.[0] ?? 0;

  if (rawSellUnitPrice <= 0) return null;

  const histSell7d =
    dataset.historySellPrice7d?.[String(hub.regionId)]?.[String(offer.typeId)] ?? null;
  const priceCappedByHist =
    sellMethod === 'order' && histSell7d !== null && histSell7d > 0 && rawSellUnitPrice > histSell7d;
  const grossSellUnitPrice = priceCappedByHist ? histSell7d! : rawSellUnitPrice;

  const sellFeeRate =
    sellMethod === 'instant'
      ? salesTaxPct / 100
      : (salesTaxPct + brokerFeePct) / 100;

  let requiredItemsCost = 0;
  let missingReqPrice = false;
  const requiredItemsDetail: LpRequiredItemBreakdown[] = [];

  for (const req of offer.requiredItems) {
    const reqMeta = dataset.items[String(req.typeId)];
    const reqName = reqMeta?.n ?? `Type #${req.typeId}`;
    const reqBook = hubOrders[String(req.typeId)];
    const unitPrice = reqBook?.s[0]?.[0] ?? null;

    if (unitPrice === null || unitPrice <= 0) {
      missingReqPrice = true;
      requiredItemsDetail.push({
        typeId: req.typeId,
        name: reqName,
        quantity: req.quantity,
        unitPrice: null,
        totalPrice: null,
      });
    } else {
      const totalPrice = unitPrice * req.quantity;
      requiredItemsCost += totalPrice;
      requiredItemsDetail.push({
        typeId: req.typeId,
        name: reqName,
        quantity: req.quantity,
        unitPrice,
        totalPrice,
      });
    }
  }

  const totalCostPerRedeem = offer.iskCost + requiredItemsCost;
  const grossRevenuePerRedeem = grossSellUnitPrice * offer.quantity;
  const feesPerRedeem = grossRevenuePerRedeem * sellFeeRate;
  const netRevenuePerRedeem = grossRevenuePerRedeem - feesPerRedeem;
  const netProfitPerRedeem = netRevenuePerRedeem - totalCostPerRedeem;
  const iskPerLp = offer.lpCost > 0 ? netProfitPerRedeem / offer.lpCost : 0;
  const roiPct = totalCostPerRedeem > 0 ? (netProfitPerRedeem / totalCostPerRedeem) * 100 : 0;

  const avgDailyVol7d =
    dataset.history7d?.[String(hub.regionId)]?.[String(offer.typeId)] ?? null;
  const trendPct7d =
    dataset.historyTrend7d?.[String(hub.regionId)]?.[String(offer.typeId)] ?? null;
  const activeDays14d =
    dataset.historyActive14d?.[String(hub.regionId)]?.[String(offer.typeId)] ?? null;
  const hubBuyVol = itemBook.bv ?? 0;
  const hubSellVol = itemBook.sv ?? 0;

  const maxRedemptionsFromLp =
    availableLp > 0 && offer.lpCost > 0 ? Math.floor(availableLp / offer.lpCost) : 0;
  const totalProfitForLp = maxRedemptionsFromLp * netProfitPerRedeem;
  const totalIskRequiredForLp = maxRedemptionsFromLp * totalCostPerRedeem;
  const totalVolumeForLp = maxRedemptionsFromLp * offer.quantity * itemMeta.v;

  const lowLiquidity =
    (avgDailyVol7d !== null && avgDailyVol7d < offer.quantity) ||
    (sellMethod === 'instant' && hubBuyVol < offer.quantity);

  return {
    offerId: offer.offerId,
    typeId: offer.typeId,
    name: itemMeta.n,
    unitVolume: itemMeta.v,
    quantity: offer.quantity,
    lpCost: offer.lpCost,
    iskCost: offer.iskCost,
    akCost: offer.akCost ?? 0,
    requiredItemsCost,
    missingReqPrice,
    requiredItemsDetail,
    totalCostPerRedeem,
    sellHub: hub,
    rawSellUnitPrice,
    grossSellUnitPrice,
    priceCappedByHist,
    grossRevenuePerRedeem,
    feesPerRedeem,
    netRevenuePerRedeem,
    netProfitPerRedeem,
    iskPerLp,
    roiPct,
    avgDailyVol7d,
    trendPct7d,
    activeDays14d,
    hubBuyVol,
    hubSellVol,
    destBuys: itemBook.b,
    destSells: itemBook.s,
    maxRedemptionsFromLp,
    totalProfitForLp,
    totalIskRequiredForLp,
    totalVolumeForLp,
    lowLiquidity,
  };
}

export function evaluateLpOffers(params: EvaluateLpParams): LpOfferEvaluation[] {
  const {
    offers,
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
  } = params;

  const candidateHubs =
    sellHubKey === 'best'
      ? dataset.hubs
      : dataset.hubs.filter((h) => h.key === sellHubKey);

  const q = searchQuery.trim().toLowerCase();
  const results: LpOfferEvaluation[] = [];

  for (const offer of offers) {
    const itemMeta = dataset.items[String(offer.typeId)];
    if (!itemMeta) continue;
    if (q && !itemMeta.n.toLowerCase().includes(q)) continue;

    let bestEval: LpOfferEvaluation | null = null;
    for (const hub of candidateHubs) {
      const ev = evaluateOfferAtHub(
        offer,
        hub,
        dataset,
        sellMethod,
        salesTaxPct,
        brokerFeePct,
        availableLp
      );
      if (!ev) continue;
      if (!bestEval) {
        bestEval = ev;
      } else {
        // Prefer complete req prices first, then higher ISK/LP
        if (bestEval.missingReqPrice && !ev.missingReqPrice) {
          bestEval = ev;
        } else if (bestEval.missingReqPrice === ev.missingReqPrice && ev.iskPerLp > bestEval.iskPerLp) {
          bestEval = ev;
        }
      }
    }

    if (!bestEval) continue;
    if (hideMissingReq && bestEval.missingReqPrice) continue;
    if (hideUnprofitable && bestEval.iskPerLp <= 0) continue;
    if (minIskPerLp > 0 && bestEval.iskPerLp < minIskPerLp) continue;
    if (minDailyVol > 0 && (bestEval.avgDailyVol7d ?? 0) < minDailyVol) continue;

    results.push(bestEval);
  }

  return results;
}
