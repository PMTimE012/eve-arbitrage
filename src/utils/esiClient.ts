import type {
  FwStationInfo,
  HubBook,
  MarketDataset,
  RouteInfo,
  StationOption,
  StationVolumeSummary,
  SystemActivity,
  UniverseStationsData,
} from '../types';

interface EsiOrder {
  type_id: number;
  location_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  min_volume?: number;
}

const DB_NAME = 'eve-arbitrage-cache';
const STORE_NAME = 'kv';
const REGION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_TTL_MS = 15 * 60 * 1000; // 15 minutes

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<{ data: T; ts: number } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, data: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ data, ts: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore storage quota errors
  }
}

async function fetchJsonWithRetry<T>(url: string, retries = 3): Promise<{ data: T; headers: Headers }> {
  for (let i = 1; i <= retries; i++) {
    const res = await fetch(url);
    if (res.status === 420 || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, i * 1200));
      continue;
    }
    if (!res.ok) throw new Error(`ESI HTTP ${res.status}`);
    return { data: (await res.json()) as T, headers: res.headers };
  }
  throw new Error('ESI request failed after retries');
}

const inFlightRegionFetches = new Map<number, Promise<EsiOrder[]>>();

async function fetchRegionOrdersFromEsi(
  regionId: number,
  onProgress?: (done: number, total: number) => void,
  bypassCache = false
): Promise<EsiOrder[]> {
  if (!bypassCache) {
    const cached = await idbGet<EsiOrder[]>(`region:${regionId}`);
    if (cached && Date.now() - cached.ts < REGION_TTL_MS) {
      onProgress?.(1, 1);
      return cached.data;
    }
  }

  const existingFetch = inFlightRegionFetches.get(regionId);
  if (existingFetch) {
    return existingFetch;
  }

  const fetchPromise = (async () => {
    const base = `https://esi.evetech.net/latest/markets/${regionId}/orders/?order_type=all&page=`;
    const first = await fetchJsonWithRetry<EsiOrder[]>(`${base}1`);
    const totalPages = Number(first.headers.get('x-pages') || '1');
    let done = 1;
    onProgress?.(done, totalPages);

    const allOrders: EsiOrder[] = [...first.data];
    if (totalPages > 1) {
      const pages = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
      let cursor = 0;
      const concurrency = 6;
      const worker = async () => {
        while (cursor < pages.length) {
          const page = pages[cursor++];
          const res = await fetchJsonWithRetry<EsiOrder[]>(`${base}${page}`);
          allOrders.push(...res.data);
          done++;
          onProgress?.(done, totalPages);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
    }

    await idbSet(`region:${regionId}`, allOrders);
    return allOrders;
  })();

  inFlightRegionFetches.set(regionId, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRegionFetches.delete(regionId);
  }
}

export async function loadStationMarketBook(
  station: StationOption,
  dataset: MarketDataset,
  onProgress?: (done: number, total: number) => void,
  forceLive = false
): Promise<Record<string, HubBook>> {
  if (!forceLive) {
    const preloaded = dataset.orders[String(station.stationId)];
    if (preloaded) {
      return preloaded;
    }
  }

  const regionOrders = await fetchRegionOrdersFromEsi(station.regionId, onProgress, forceLive);
  const grouped = new Map<number, { s: [number, number][]; b: [number, number][] }>();

  for (const o of regionOrders) {
    if (o.location_id !== station.stationId) continue;
    // Skip minimum-volume buy orders (>1) to avoid EVE margin-trading / min_volume scams
    if (o.is_buy_order && (o.min_volume ?? 1) > 1) continue;
    let entry = grouped.get(o.type_id);
    if (!entry) {
      entry = { s: [], b: [] };
      grouped.set(o.type_id, entry);
    }
    if (o.is_buy_order) {
      entry.b.push([o.price, o.volume_remain]);
    } else {
      entry.s.push([o.price, o.volume_remain]);
    }
  }

  const book: Record<string, HubBook> = {};
  for (const [typeId, b] of grouped.entries()) {
    b.s.sort((a, c) => a[0] - c[0]);
    b.b.sort((a, c) => c[0] - a[0]);
    book[String(typeId)] = {
      s: b.s.slice(0, 5),
      b: b.b.slice(0, 5),
      sv: b.s.reduce((acc, x) => acc + x[1], 0),
      bv: b.b.reduce((acc, x) => acc + x[1], 0),
    };
  }
  return book;
}

/**
 * Fetch live ESI order books ONLY for specific (regionId, typeId, stationIds) pairs.
 * Uses ESI's `type_id` filter (~1 page per item) instead of downloading the entire region (~300+ pages).
 */
export async function fetchLiveBooksForPlanItems(
  queries: { regionId: number; typeId: number; stationIds: number[] }[]
): Promise<Record<number, Record<string, HubBook>>> {
  const dedup = new Map<string, { regionId: number; typeId: number; stationIds: Set<number> }>();
  for (const q of queries) {
    if (!q.regionId || q.regionId <= 0 || !q.typeId || q.typeId <= 0) continue;
    const key = `${q.regionId}:${q.typeId}`;
    let entry = dedup.get(key);
    if (!entry) {
      entry = { regionId: q.regionId, typeId: q.typeId, stationIds: new Set<number>() };
      dedup.set(key, entry);
    }
    for (const sid of q.stationIds) {
      if (sid > 0) entry.stationIds.add(sid);
    }
  }

  const tasks = Array.from(dedup.values()).filter((t) => t.stationIds.size > 0);
  const result: Record<number, Record<string, HubBook>> = {};
  if (tasks.length === 0) return result;

  let idx = 0;
  const concurrency = 6;
  const worker = async () => {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      try {
        const base = `https://esi.evetech.net/latest/markets/${task.regionId}/orders/?datasource=tranquility&order_type=all&type_id=${task.typeId}&page=`;
        const first = await fetchJsonWithRetry<EsiOrder[]>(`${base}1`);
        const totalPages = Math.max(1, Number(first.headers.get('x-pages') ?? '1'));
        const orders = [...first.data];
        if (totalPages > 1) {
          const restPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const restResults = await Promise.all(
            restPages.map((p) => fetchJsonWithRetry<EsiOrder[]>(`${base}${p}`))
          );
          for (const r of restResults) orders.push(...r.data);
        }

        const perStation = new Map<number, { s: [number, number][]; b: [number, number][] }>();
        for (const sid of task.stationIds) {
          perStation.set(sid, { s: [], b: [] });
        }

        for (const o of orders) {
          const bucket = perStation.get(o.location_id);
          if (!bucket) continue;
          if (o.is_buy_order && (o.min_volume ?? 1) > 1) continue;
          if (o.is_buy_order) {
            bucket.b.push([o.price, o.volume_remain]);
          } else {
            bucket.s.push([o.price, o.volume_remain]);
          }
        }

        const typeStr = String(task.typeId);
        for (const [sid, b] of perStation.entries()) {
          b.s.sort((a, c) => a[0] - c[0]);
          b.b.sort((a, c) => c[0] - a[0]);
          if (!result[sid]) result[sid] = {};
          result[sid][typeStr] = {
            s: b.s.slice(0, 5),
            b: b.b.slice(0, 5),
            sv: b.s.reduce((acc, x) => acc + x[1], 0),
            bv: b.b.reduce((acc, x) => acc + x[1], 0),
          };
        }
      } catch {
        // Skip failed item fetch cleanly so other items still update
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return result;
}

export function summarizeStationBook(book: Record<string, HubBook> | null): StationVolumeSummary {
  if (!book) {
    return { activeItemTypes: 0, totalSellUnits: 0, totalBuyUnits: 0, totalBuyIskValue: 0 };
  }
  let activeItemTypes = 0;
  let totalSellUnits = 0;
  let totalBuyUnits = 0;
  let totalBuyIskValue = 0;

  for (const entry of Object.values(book)) {
    activeItemTypes++;
    totalSellUnits += entry.sv;
    totalBuyUnits += entry.bv;
    // Approximate buy ISK value from top buy level * total buy volume or top levels
    for (const [price, qty] of entry.b) {
      totalBuyIskValue += price * qty;
    }
  }

  return { activeItemTypes, totalSellUnits, totalBuyUnits, totalBuyIskValue };
}

export async function fetchRouteBetweenSystems(
  fromSystemId: number,
  toSystemId: number
): Promise<RouteInfo> {
  if (fromSystemId === toSystemId) return { secureJumps: 0, shortestJumps: 0 };
  const key = `route:${fromSystemId}->${toSystemId}`;
  const cached = await idbGet<RouteInfo>(key);
  if (cached) return cached.data;

  const [sec, sh] = await Promise.all([
    fetchJsonWithRetry<number[]>(
      `https://esi.evetech.net/latest/route/${fromSystemId}/${toSystemId}/?flag=secure`
    ),
    fetchJsonWithRetry<number[]>(
      `https://esi.evetech.net/latest/route/${fromSystemId}/${toSystemId}/?flag=shortest`
    ),
  ]);

  const info: RouteInfo = {
    secureJumps: Math.max(0, sec.data.length - 1),
    shortestJumps: Math.max(0, sh.data.length - 1),
  };
  await idbSet(key, info);
  return info;
}

export async function fetchSystemActivityMap(): Promise<Record<number, SystemActivity>> {
  const cached = await idbGet<Record<number, SystemActivity>>('universe:activity');
  if (cached && Date.now() - cached.ts < ACTIVITY_TTL_MS) {
    return cached.data;
  }

  const [jumpsRes, killsRes] = await Promise.all([
    fetchJsonWithRetry<{ system_id: number; ship_jumps: number }[]>(
      'https://esi.evetech.net/latest/universe/system_jumps/'
    ),
    fetchJsonWithRetry<{
      system_id: number;
      ship_kills: number;
      npc_kills: number;
      pod_kills: number;
    }[]>('https://esi.evetech.net/latest/universe/system_kills/'),
  ]);

  const map: Record<number, SystemActivity> = {};
  for (const j of jumpsRes.data) {
    map[j.system_id] = {
      jumps: j.ship_jumps,
      shipKills: 0,
      npcKills: 0,
      podKills: 0,
    };
  }
  for (const k of killsRes.data) {
    if (!map[k.system_id]) {
      map[k.system_id] = { jumps: 0, shipKills: 0, npcKills: 0, podKills: 0 };
    }
    map[k.system_id].shipKills = k.ship_kills;
    map[k.system_id].npcKills = k.npc_kills;
    map[k.system_id].podKills = k.pod_kills;
  }

  await idbSet('universe:activity', map);
  return map;
}

const MILITIA_REGEX =
  /State Protectorate|Federal Defense Union|24th Imperial Crusade|Tribal Liberation Force/;

export async function fetchTopFwStations(
  universe: UniverseStationsData,
  activityMap: Record<number, SystemActivity>
): Promise<FwStationInfo[]> {
  let fwMap = new Map<number, string>();
  try {
    const cached = await idbGet<[number, string][]>('universe:fw_systems');
    if (cached && Date.now() - cached.ts < ACTIVITY_TTL_MS) {
      fwMap = new Map(cached.data);
    } else {
      const res = await fetchJsonWithRetry<
        { solar_system_id: number; contested: string }[]
      >('https://esi.evetech.net/latest/fw/systems/');
      const pairs: [number, string][] = res.data.map((s) => [
        s.solar_system_id,
        s.contested,
      ]);
      fwMap = new Map(pairs);
      await idbSet('universe:fw_systems', pairs);
    }
  } catch {
    // Fallback to Militia corp stations only if fw/systems fails
  }

  // Pick the best station per FW/Militia system so Top 10 covers 10 distinct systems
  const bestBySystem = new Map<number, FwStationInfo & { _score: number }>();

  for (const [stationId, stationName, systemId] of universe.stations) {
    const isMilitia = MILITIA_REGEX.test(stationName);
    const contested = fwMap.get(systemId);
    if (!isMilitia && !contested) continue;

    const sys = universe.systems[String(systemId)];
    if (!sys) continue;
    const [systemName, regionId, security] = sys;
    const regionName = universe.regions[String(regionId)] || '';
    const act = activityMap[systemId] ?? { jumps: 0, shipKills: 0, npcKills: 0, podKills: 0 };

    const activityScore = act.jumps + act.shipKills * 5 + (isMilitia ? 50 : 0);
    const existing = bestBySystem.get(systemId);
    if (!existing || activityScore > existing._score) {
      bestBySystem.set(systemId, {
        stationId,
        stationName,
        systemId,
        systemName,
        regionId,
        regionName,
        security,
        hubKey: null,
        jumps: act.jumps,
        shipKills: act.shipKills,
        contested,
        _score: activityScore,
      });
    }
  }

  return Array.from(bestBySystem.values())
    .sort((a, b) => b._score - a._score)
    .slice(0, 10)
    .map(({ _score: _, ...rest }) => rest);
}
