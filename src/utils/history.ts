export interface EsiHistoryEntry {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

export interface DailyVolumeStats {
  avg7d: number;
  avg30d: number;
  activeDays7d: number;
  iskVol7d: number;
  trendPct: number | null;
  daysSinceLastTrade: number | null;
  last14Days: { date: string; volume: number; average: number }[];
  lastTradeDate: string | null;
  lastAvgPrice: number | null;
  avgSell7d: number | null;
  avgBuy7d: number | null;
  low7d: number | null;
  high7d: number | null;
}

const historyCache = new Map<string, DailyVolumeStats>();

export async function fetchDestDailyVolume(
  regionId: number,
  typeId: number
): Promise<DailyVolumeStats> {
  const cacheKey = `${regionId}:${typeId}`;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(
    `https://esi.evetech.net/latest/markets/${regionId}/history/?type_id=${typeId}`
  );
  if (!res.ok) {
    throw new Error(`ESI history HTTP ${res.status}`);
  }

  const entries: EsiHistoryEntry[] = await res.json();
  const byDate = new Map<string, EsiHistoryEntry>();
  for (const e of entries) {
    byDate.set(e.date, e);
  }

  const now = new Date();
  let sum7 = 0;
  let sum30 = 0;
  let activeDays7d = 0;
  let iskSum7 = 0;
  let sellWeightedSum7 = 0;
  let buyWeightedSum7 = 0;
  let sellWeightedSum30 = 0;
  let buyWeightedSum30 = 0;
  let low7d: number | null = null;
  let high7d: number | null = null;
  let low30d: number | null = null;
  let high30d: number | null = null;
  const last14Days: { date: string; volume: number; average: number }[] = [];

  for (let i = 30; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const dateStr = d.toISOString().slice(0, 10);
    const entry = byDate.get(dateStr);
    const vol = entry?.volume ?? 0;

    sum30 += vol;
    if (entry && vol > 0) {
      sellWeightedSum30 += entry.highest * vol;
      buyWeightedSum30 += entry.lowest * vol;
      low30d = low30d === null ? entry.lowest : Math.min(low30d, entry.lowest);
      high30d = high30d === null ? entry.highest : Math.max(high30d, entry.highest);
    }
    if (i <= 14) {
      sum7 += vol;
      if (entry && vol > 0) {
        activeDays7d++;
        iskSum7 += entry.average * vol;
        sellWeightedSum7 += entry.highest * vol;
        buyWeightedSum7 += entry.lowest * vol;
        low7d = low7d === null ? entry.lowest : Math.min(low7d, entry.lowest);
        high7d = high7d === null ? entry.highest : Math.max(high7d, entry.highest);
      }
      last14Days.push({
        date: dateStr,
        volume: vol,
        average: entry?.average ?? 0,
      });
    }
  }

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const avg7d = sum7 / 14;
  const avg30d = sum30 / 30;
  const trendPct = avg30d > 0 ? ((avg7d - avg30d) / avg30d) * 100 : null;

  let daysSinceLastTrade: number | null = null;
  if (lastEntry?.date) {
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const lastMs = Date.parse(`${lastEntry.date}T00:00:00Z`);
    if (Number.isFinite(lastMs)) {
      daysSinceLastTrade = Math.max(0, Math.round((todayUtc - lastMs) / 86_400_000));
    }
  }

  const avgSell7d =
    sum7 > 0
      ? sellWeightedSum7 / sum7
      : sum30 > 0
      ? sellWeightedSum30 / sum30
      : lastEntry?.highest ?? null;
  const avgBuy7d =
    sum7 > 0
      ? buyWeightedSum7 / sum7
      : sum30 > 0
      ? buyWeightedSum30 / sum30
      : lastEntry?.lowest ?? null;

  const stats: DailyVolumeStats = {
    avg7d,
    avg30d,
    activeDays7d,
    iskVol7d: iskSum7 / 14,
    trendPct,
    daysSinceLastTrade,
    last14Days,
    lastTradeDate: lastEntry?.date ?? null,
    lastAvgPrice: lastEntry?.average ?? null,
    avgSell7d,
    avgBuy7d,
    low7d: low7d ?? low30d ?? lastEntry?.lowest ?? null,
    high7d: high7d ?? high30d ?? lastEntry?.highest ?? null,
  };

  historyCache.set(cacheKey, stats);
  return stats;
}
