export interface HubInfo {
  key: string;
  name: string;
  fullName: string;
  regionName: string;
  regionId: number;
  systemId: number;
  stationId: number;
}

export interface TopStationInfo {
  stationId: number;
  stationName: string;
  systemId: number;
  systemName: string;
  regionId: number;
  regionName: string;
  security: number;
  orderCount: number;
  buyIskValue: number;
  hubKey: string | null;
}

export interface StationOption {
  stationId: number;
  stationName: string;
  systemId: number;
  systemName: string;
  regionId: number;
  regionName: string;
  security: number;
  hubKey: string | null;
  orderCount?: number;
  buyIskValue?: number;
}

export interface FwStationInfo extends StationOption {
  jumps: number;
  shipKills: number;
  contested?: string;
}

export interface UniverseStationsData {
  regions: Record<string, string>;
  /** [systemName, regionId, security, xScaled?, zScaled?] */
  systems: Record<string, [string, number, number, number?, number?]>;
  /** [stationId, stationName, systemId] */
  stations: [number, string, number][];
  /** Flat undirected stargate pairs [fromSystemId, toSystemId, ...] */
  edges?: number[];
}

export interface RouteInfo {
  secureJumps: number;
  shortestJumps: number;
}

export interface ItemMeta {
  n: string; // name
  v: number; // volume in m3 (packaged if applicable)
}

/** [price, volume_remain] */
export type OrderLevel = [number, number];

export interface HubBook {
  s: OrderLevel[]; // top 5 sell orders (lowest price first)
  b: OrderLevel[]; // top 5 buy orders (highest price first)
  sv: number; // total sell volume at station
  bv: number; // total buy volume at station
}

export interface EmpireStationMeta {
  stationId: number;
  stationName: string;
  systemId: number;
  systemName: string;
  regionId: number;
  regionName: string;
  security: number;
}

export interface EmpireInstantDataset {
  stations: Record<string, EmpireStationMeta>;
  orders: Record<string, Record<string, HubBook>>;
}

export interface MarketDataset {
  updatedAt: string;
  hubs: HubInfo[];
  topStations: TopStationInfo[];
  fwStations?: FwStationInfo[];
  routes: Record<string, RouteInfo>;
  jumpsFromHubs?: Record<string, Record<string, number>>;
  history7d?: Record<string, Record<string, number>>;
  historySellPrice7d?: Record<string, Record<string, number>>;
  historyTrend7d?: Record<string, Record<string, number>>;
  historyActive14d?: Record<string, Record<string, number>>;
  items: Record<string, ItemMeta>;
  orders: Record<string, Record<string, HubBook>>;
}

export interface SystemActivity {
  jumps: number;
  shipKills: number;
  npcKills: number;
  podKills: number;
}

export interface StationVolumeSummary {
  activeItemTypes: number;
  totalSellUnits: number;
  totalBuyUnits: number;
  totalBuyIskValue: number;
}

export type TradeMode = 'instant' | 'patient';
export type BuyMethod = 'instant' | 'order';
export type LiquidityTier = 'all' | 'moderate' | 'good' | 'high';
export type JumpFilter = 'all' | 'le5' | 'le10' | 'le15';

export interface ArbitrageParams {
  originBook: Record<string, HubBook> | null;
  destBook: Record<string, HubBook> | null;
  buyMethod?: BuyMethod;
  tradeMode: TradeMode;
  maxBudget: number;
  maxCargo: number;
  salesTaxPct: number;
  brokerFeePct: number;
  minRoiPct: number;
  minProfit: number;
  liquidityTier: LiquidityTier;
  jumpFilter: JumpFilter;
  skipBaitOrders: boolean;
  searchQuery: string;
  routeJumps?: number;
  originRegionId?: number;
  destRegionId?: number;
}

export interface ArbitrageOpportunity {
  typeId: number;
  name: string;
  unitVolume: number;
  buyPrice: number;
  sellPrice: number;
  profitPerUnit: number;
  roiPct: number;
  profitPerM3: number;
  recommendedQty: number;
  totalCost: number;
  budgetUsedPct: number | null;
  totalRevenueAfterTax: number;
  totalVolume: number;
  cargoFillPct: number | null;
  totalProfit: number;
  tradeScore: number;
  scoreBreakdown?: {
    liq: number;
    profit: number;
    roi: number;
    jump: number;
    trend: number;
    note?: string;
  };
  scoreLabel: 'High' | 'Good' | 'Moderate' | 'Risky';
  liquidityLabel: 'High' | 'Good' | 'Moderate' | 'Low';
  avg7d: number | null;
  trendPct?: number | null;
  activeDays14d?: number | null;
  originSellVol: number;
  originBuyVol: number;
  destBuyVol: number;
  destSellVol: number;
  originSells: OrderLevel[];
  originBuys: OrderLevel[];
  destBuys: OrderLevel[];
  destSells: OrderLevel[];
  originStationId?: number;
  originStationName?: string;
  originSystemId?: number;
  originSystemName?: string;
  originRegionId?: number;
  originRegionName?: string;
  originJumps?: number;
  destStationId?: number;
  destStationName?: string;
  destSystemId?: number;
  destSystemName?: string;
  destRegionId?: number;
  destRegionName?: string;
  destJumps?: number;
}

export interface TrendingMarketItem {
  regionId: number;
  regionName: string;
  typeId: number;
  name: string;
  med7d: number;
  avg30d: number;
  trendPct: number;
  activeDays7: number;
  iskVol7d: number;
  buyPressurePct?: number;
  spark14: number[];
}

export interface TrendingDataset {
  updatedAt: string;
  regions: { id: number; name: string }[];
  items: TrendingMarketItem[];
}

export interface FwLpRequiredItem {
  typeId: number;
  quantity: number;
}

export interface FwLpOffer {
  offerId: number;
  typeId: number;
  quantity: number;
  lpCost: number;
  iskCost: number;
  akCost?: number;
  requiredItems: FwLpRequiredItem[];
}

export interface FwLpCorporation {
  corporationId: number;
  name: string;
  factionName: string;
  shortName: string;
  offers: FwLpOffer[];
}

export interface FwLpDataset {
  updatedAt: string;
  corporations: FwLpCorporation[];
}
