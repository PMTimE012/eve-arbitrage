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
  last14Days: { date: string; volume: number; average: number }[];
  lastTradeDate: string | null;
  lastAvgPrice: number | null;
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
  const last14Days: { date: string; volume: number; average: number }[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const dateStr = d.toISOString().slice(0, 10);
    const entry = byDate.get(dateStr);
    const vol = entry?.volume ?? 0;

    sum30 += vol;
    if (i < 7) sum7 += vol;
    if (i < 14) {
      last14Days.push({
        date: dateStr,
        volume: vol,
        average: entry?.average ?? 0,
      });
    }
  }

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const stats: DailyVolumeStats = {
    avg7d: sum7 / 7,
    avg30d: sum30 / 30,
    last14Days,
    lastTradeDate: lastEntry?.date ?? null,
    lastAvgPrice: lastEntry?.average ?? null,
  };

  historyCache.set(cacheKey, stats);
  return stats;
}
