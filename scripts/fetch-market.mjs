import fs from 'node:fs/promises';
import path from 'node:path';
import seekBzip from 'seek-bzip';

const HUBS = [
  {
    key: 'jita',
    name: 'Jita 4-4',
    fullName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    regionName: 'The Forge',
    regionId: 10000002,
    systemId: 30000142,
    stationId: 60003760,
  },
  {
    key: 'amarr',
    name: 'Amarr VIII',
    fullName: 'Amarr VIII (Oris) - Emperor Family Academy',
    regionName: 'Domain',
    regionId: 10000043,
    systemId: 30002187,
    stationId: 60008494,
  },
  {
    key: 'dodixie',
    name: 'Dodixie IX-20',
    fullName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    regionName: 'Sinq Laison',
    regionId: 10000032,
    systemId: 30002659,
    stationId: 60011866,
  },
  {
    key: 'rens',
    name: 'Rens VI-8',
    fullName: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    regionName: 'Heimatar',
    regionId: 10000030,
    systemId: 30002510,
    stationId: 60004588,
  },
  {
    key: 'hek',
    name: 'Hek VIII-12',
    fullName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    regionName: 'Metropolis',
    regionId: 10000042,
    systemId: 30002053,
    stationId: 60005686,
  },
];

const EXTRA_RANK_REGION_IDS = [
  10000033, // The Citadel
  10000016, // Lonetrek
  10000067, // Genesis
];

const MILITIA_REGEX =
  /State Protectorate|Federal Defense Union|24th Imperial Crusade|Tribal Liberation Force/;

const USER_AGENT = 'EVE-Hub-Arbitrage/1.0 (https://github.com/)';

async function fetchWithRetry(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      });
      if (res.status === 420 || res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function loadSdeData() {
  console.log('Downloading Fuzzwork SDE (invTypes, invVolumes, staStations, mapSolarSystems, mapRegions, mapSolarSystemJumps)...');
  const [typesRes, volRes, stationsRes, systemsRes, regionsRes, jumpsRes] = await Promise.all([
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/invTypes.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/invVolumes.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/staStations.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapSolarSystems.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapRegions.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapSolarSystemJumps.csv'),
  ]);

  const [typesCsv, volCsv, stationsCsv, systemsCsv, regionsCsv, jumpsCsv] = await Promise.all([
    typesRes.text(),
    volRes.text(),
    stationsRes.text(),
    systemsRes.text(),
    regionsRes.text(),
    jumpsRes.text(),
  ]);

  const packagedVolumes = new Map();
  for (const line of volCsv.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [idStr, volStr] = trimmed.split(',');
    const id = Number(idStr);
    const vol = Number(volStr);
    if (id && vol > 0) packagedVolumes.set(id, vol);
  }

  const items = {};
  const typeLines = typesCsv.split(/\r?\n/);
  const tHeaders = parseCsvLine(typeLines[0]);
  const idxId = tHeaders.indexOf('typeID');
  const idxName = tHeaders.indexOf('typeName');
  const idxVol = tHeaders.indexOf('volume');
  const idxPub = tHeaders.indexOf('published');
  const idxMkt = tHeaders.indexOf('marketGroupID');

  for (let i = 1; i < typeLines.length; i++) {
    const line = typeLines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (cols[idxPub] !== '1') continue;
    const mkt = cols[idxMkt];
    if (!mkt || mkt === 'None' || mkt === '\\N') continue;

    const id = Number(cols[idxId]);
    const name = cols[idxName];
    const rawVol = Number(cols[idxVol]) || 0;
    const volume = packagedVolumes.get(id) ?? rawVol;
    if (id && name) {
      items[id] = { n: name, v: volume };
    }
  }

  const regions = {};
  const rLines = regionsCsv.split(/\r?\n/);
  const rHeaders = parseCsvLine(rLines[0]);
  const rIdxId = rHeaders.indexOf('regionID');
  const rIdxName = rHeaders.indexOf('regionName');
  for (let i = 1; i < rLines.length; i++) {
    if (!rLines[i]) continue;
    const cols = parseCsvLine(rLines[i]);
    const id = Number(cols[rIdxId]);
    const name = cols[rIdxName];
    if (id && name) regions[id] = name;
  }

  const systems = {};
  const sysLines = systemsCsv.split(/\r?\n/);
  const sysHeaders = parseCsvLine(sysLines[0]);
  const sysIdxId = sysHeaders.indexOf('solarSystemID');
  const sysIdxName = sysHeaders.indexOf('solarSystemName');
  const sysIdxReg = sysHeaders.indexOf('regionID');
  const sysIdxSec = sysHeaders.indexOf('security');
  for (let i = 1; i < sysLines.length; i++) {
    if (!sysLines[i]) continue;
    const cols = parseCsvLine(sysLines[i]);
    const id = Number(cols[sysIdxId]);
    const name = cols[sysIdxName];
    const regId = Number(cols[sysIdxReg]);
    const sec = Number(Number(cols[sysIdxSec]).toFixed(2));
    if (id && name && regId) {
      systems[id] = [name, regId, sec];
    }
  }

  const rawStations = [];
  const stLines = stationsCsv.split(/\r?\n/);
  const stHeaders = parseCsvLine(stLines[0]);
  const stIdxId = stHeaders.indexOf('stationID');
  const stIdxName = stHeaders.indexOf('stationName');
  const stIdxSys = stHeaders.indexOf('solarSystemID');
  for (let i = 1; i < stLines.length; i++) {
    if (!stLines[i]) continue;
    const cols = parseCsvLine(stLines[i]);
    const id = Number(cols[stIdxId]);
    const name = cols[stIdxName];
    const sysId = Number(cols[stIdxSys]);
    if (id && name && sysId && systems[sysId]) {
      rawStations.push([id, name, sysId]);
    }
  }

  // Resolve exact in-game Roman-numeral station names via ESI /universe/names/
  const officialStationNames = new Map();
  const stationIds = rawStations.map((s) => s[0]);
  for (let i = 0; i < stationIds.length; i += 1000) {
    const chunk = stationIds.slice(i, i + 1000);
    try {
      const res = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok) {
        const list = await res.json();
        for (const item of list) {
          if (item.id && item.name) officialStationNames.set(item.id, item.name);
        }
      }
    } catch {
      // Fallback to CSV name
    }
  }

  const stations = [];
  const stationLookup = new Map();
  for (const [id, csvName, sysId] of rawStations) {
    const name = officialStationNames.get(id) ?? csvName;
    stations.push([id, name, sysId]);
    stationLookup.set(id, { stationId: id, stationName: name, systemId: sysId });
  }

  // Build Stargate Adjacency Graph for instant local BFS jump calculation
  const graph = new Map();
  const edges = [];
  const seenEdges = new Set();
  const jLines = jumpsCsv.split(/\r?\n/);
  const jHeaders = parseCsvLine(jLines[0]);
  const jIdxFrom = jHeaders.indexOf('fromSolarSystemID');
  const jIdxTo = jHeaders.indexOf('toSolarSystemID');
  for (let i = 1; i < jLines.length; i++) {
    if (!jLines[i]) continue;
    const cols = parseCsvLine(jLines[i]);
    const f = Number(cols[jIdxFrom]);
    const t = Number(cols[jIdxTo]);
    if (!f || !t) continue;
    if (!graph.has(f)) graph.set(f, []);
    graph.get(f).push(t);
    const key = f < t ? `${f}:${t}` : `${t}:${f}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push(f, t);
    }
  }

  console.log(
    `Loaded ${Object.keys(items).length} items, ${stations.length} NPC stations, ${Object.keys(systems).length} systems.`
  );
  return { items, regions, systems, stations, stationLookup, graph, edges };
}

function computeBfsJumps(startSystemId, systems, graph) {
  // Two-pass BFS: first High-Sec only (>= 0.45), then shortest overall for Low/Null systems
  const dist = new Map();
  dist.set(startSystemId, 0);
  const queue = [startSystemId];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur);
    const neighbors = graph.get(cur);
    if (!neighbors) continue;
    for (const nxt of neighbors) {
      if (dist.has(nxt)) continue;
      const sys = systems[nxt];
      if (!sys || sys[2] < 0.45) continue; // High-Sec only first
      dist.set(nxt, d + 1);
      queue.push(nxt);
    }
  }

  // Second pass: expand into Low/Null from reached High-Sec border systems
  const q2 = [...queue];
  let h2 = 0;
  while (h2 < q2.length) {
    const cur = q2[h2++];
    const d = dist.get(cur);
    const neighbors = graph.get(cur);
    if (!neighbors) continue;
    for (const nxt of neighbors) {
      if (dist.has(nxt)) continue;
      dist.set(nxt, d + 1);
      q2.push(nxt);
    }
  }

  return dist;
}

async function fetchFwAndActivity(sde) {
  const [fwRes, jumpsRes, killsRes] = await Promise.all([
    fetchWithRetry('https://esi.evetech.net/latest/fw/systems/'),
    fetchWithRetry('https://esi.evetech.net/latest/universe/system_jumps/'),
    fetchWithRetry('https://esi.evetech.net/latest/universe/system_kills/'),
  ]);

  const [fwList, jumpsList, killsList] = await Promise.all([
    fwRes.json(),
    jumpsRes.json(),
    killsRes.json(),
  ]);

  const fwMap = new Map();
  for (const s of fwList) {
    fwMap.set(s.solar_system_id, s.contested);
  }

  const activity = new Map();
  for (const j of jumpsList) {
    activity.set(j.system_id, { jumps: j.ship_jumps, shipKills: 0 });
  }
  for (const k of killsList) {
    const cur = activity.get(k.system_id) ?? { jumps: 0, shipKills: 0 };
    cur.shipKills = k.ship_kills;
    activity.set(k.system_id, cur);
  }

  const bestBySystem = new Map();
  for (const [stationId, stationName, systemId] of sde.stations) {
    const isMilitia = MILITIA_REGEX.test(stationName);
    const contested = fwMap.get(systemId);
    if (!isMilitia && !contested) continue;

    const sys = sde.systems[systemId];
    if (!sys) continue;
    const [systemName, regionId, security] = sys;
    const act = activity.get(systemId) ?? { jumps: 0, shipKills: 0 };
    const score = act.jumps + act.shipKills * 5 + (isMilitia ? 50 : 0);

    const existing = bestBySystem.get(systemId);
    if (!existing || score > existing._score) {
      bestBySystem.set(systemId, {
        stationId,
        stationName,
        systemId,
        systemName,
        regionId,
        regionName: sde.regions[regionId] || '',
        security,
        hubKey: null,
        jumps: act.jumps,
        shipKills: act.shipKills,
        contested,
        _score: score,
      });
    }
  }

  const fwStations = Array.from(bestBySystem.values())
    .sort((a, b) => b._score - a._score)
    .slice(0, 10)
    .map(({ _score: _, ...rest }) => rest);

  console.log('Top 10 FW/Reship:', fwStations.map((s) => `${s.systemName} (${s.jumps}j/${s.shipKills}k)`).join(', '));
  return fwStations;
}

async function fetchRegionOrders(regionId, label) {
  const baseUrl = `https://esi.evetech.net/latest/markets/${regionId}/orders/?order_type=all&page=`;
  const firstRes = await fetchWithRetry(`${baseUrl}1`);
  const totalPages = Number(firstRes.headers.get('x-pages') || '1');
  const firstOrders = await firstRes.json();

  console.log(`[${label}] Region ${regionId}: ${totalPages} pages`);

  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  const restPages = await runPool(pageNumbers, 10, async (page) => {
    const res = await fetchWithRetry(`${baseUrl}${page}`);
    return res.json();
  });

  return [firstOrders, ...restPages];
}

function buildStationBooksFromPages(pages, targetStationIds) {
  const perStation = new Map();
  for (const id of targetStationIds) {
    perStation.set(id, new Map());
  }

  for (const orders of pages) {
    for (const o of orders) {
      const stationMap = perStation.get(o.location_id);
      if (!stationMap) continue;
      let entry = stationMap.get(o.type_id);
      if (!entry) {
        entry = { s: [], b: [] };
        stationMap.set(o.type_id, entry);
      }
      if (o.is_buy_order) {
        entry.b.push([o.price, o.volume_remain]);
      } else {
        entry.s.push([o.price, o.volume_remain]);
      }
    }
  }

  const result = {};
  for (const [stationId, typeMap] of perStation.entries()) {
    const compact = {};
    for (const [typeId, book] of typeMap.entries()) {
      book.s.sort((a, b) => a[0] - b[0]);
      book.b.sort((a, b) => b[0] - a[0]);
      compact[typeId] = {
        s: book.s.slice(0, 5),
        b: book.b.slice(0, 5),
        sv: book.s.reduce((acc, x) => acc + x[1], 0),
        bv: book.b.reduce((acc, x) => acc + x[1], 0),
      };
    }
    result[String(stationId)] = compact;
  }
  return result;
}

function accumulateStationStats(pages, stationLookup, statsMap) {
  for (const orders of pages) {
    for (const o of orders) {
      if (!stationLookup.has(o.location_id)) continue;
      let st = statsMap.get(o.location_id);
      if (!st) {
        st = { orderCount: 0, buyIskValue: 0 };
        statsMap.set(o.location_id, st);
      }
      st.orderCount += 1;
      if (o.is_buy_order) {
        st.buyIskValue += o.price * o.volume_remain;
      }
    }
  }
}

async function fetchRoutes(hubs, allTargetStations) {
  // Fetch routes between the 5 major hubs and all 20 target stations
  const pairs = [];
  const seen = new Set();
  for (const from of hubs) {
    for (const to of allTargetStations) {
      if (from.systemId === to.systemId) continue;
      const k1 = `${from.systemId}->${to.systemId}`;
      if (!seen.has(k1)) {
        seen.add(k1);
        pairs.push({ fromSys: from.systemId, toSys: to.systemId });
      }
      const k2 = `${to.systemId}->${from.systemId}`;
      if (!seen.has(k2)) {
        seen.add(k2);
        pairs.push({ fromSys: to.systemId, toSys: from.systemId });
      }
    }
  }

  const routes = {};
  await runPool(pairs, 10, async ({ fromSys, toSys }) => {
    try {
      const [secureRes, shortestRes] = await Promise.all([
        fetchWithRetry(`https://esi.evetech.net/latest/route/${fromSys}/${toSys}/?flag=secure`),
        fetchWithRetry(`https://esi.evetech.net/latest/route/${fromSys}/${toSys}/?flag=shortest`),
      ]);
      const secureRoute = await secureRes.json();
      const shortestRoute = await shortestRes.json();
      routes[`${fromSys}->${toSys}`] = {
        secureJumps: Math.max(0, secureRoute.length - 1),
        shortestJumps: Math.max(0, shortestRoute.length - 1),
      };
    } catch {
      // Skip disconnected systems (e.g. Zarzakh / Exordium) that return 404 on ESI /route
    }
  });

  return routes;
}

async function fetch7DayHistory(targetRegionIds) {
  console.log('Downloading 7-day market history from EVE Ref...');
  const regionSet = new Set(targetRegionIds.map(Number));
  const totals = new Map(); // `${regionId}:${typeId}` -> sumVolume
  const now = new Date();
  let daysLoaded = 0;

  // Check last 10 UTC days to collect the latest 7 published daily files
  const candidateDates = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    candidateDates.push(d.toISOString().slice(0, 10));
  }

  for (const dateStr of candidateDates) {
    if (daysLoaded >= 7) break;
    const year = dateStr.slice(0, 4);
    const url = `https://data.everef.net/market-history/${year}/market-history-${dateStr}.csv.bz2`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const csv = Buffer.from(seekBzip.decode(buf)).toString('utf8');
      const lines = csv.split(/\r?\n/);
      const headers = lines[0].split(',');
      const idxVol = headers.indexOf('volume');
      const idxReg = headers.indexOf('region_id');
      const idxType = headers.indexOf('type_id');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split(',');
        const regId = Number(cols[idxReg]);
        if (!regionSet.has(regId)) continue;
        const typeId = Number(cols[idxType]);
        const vol = Number(cols[idxVol]) || 0;
        if (!typeId || vol <= 0) continue;

        const key = `${regId}:${typeId}`;
        totals.set(key, (totals.get(key) ?? 0) + vol);
      }
      daysLoaded++;
    } catch {
      // Skip missing day
    }
  }

  const history7d = {};
  if (daysLoaded > 0) {
    for (const [key, sumVol] of totals.entries()) {
      const [regId, typeId] = key.split(':');
      const avg = sumVol / daysLoaded;
      const rounded = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10;
      if (rounded <= 0) continue;
      if (!history7d[regId]) history7d[regId] = {};
      history7d[regId][typeId] = rounded;
    }
  }

  console.log(`Loaded ${daysLoaded}-day market history for ${Object.keys(history7d).length} regions.`);
  return history7d;
}

async function main() {
  const start = Date.now();
  const sde = await loadSdeData();
  const fwStations = await fetchFwAndActivity(sde);

  // Collect ALL High/Low-Sec Empire Regions (security > 0.05) + HUBS + FW
  const regionPagesCache = new Map();
  const stationStatsMap = new Map();

  const empireRegions = new Set();
  for (const [, , sysId] of sde.stations) {
    const sys = sde.systems[sysId];
    if (sys && sys[2] > 0.05) {
      empireRegions.add(sys[1]);
    }
  }

  const regionsToFetch = new Set([
    ...HUBS.map((h) => h.regionId),
    ...EXTRA_RANK_REGION_IDS,
    ...fwStations.map((f) => f.regionId),
    ...empireRegions,
  ]);

  console.log(`Fetching market orders for ${regionsToFetch.size} High/Low-Sec regions...`);
  for (const regionId of regionsToFetch) {
    const pages = await fetchRegionOrders(regionId, sde.regions[regionId] || String(regionId));
    regionPagesCache.set(regionId, pages);
    accumulateStationStats(pages, sde.stationLookup, stationStatsMap);
  }

  // Rank Top 10 High-Volume NPC Stations
  const topStations = Array.from(stationStatsMap.entries())
    .map(([stationId, st]) => {
      const meta = sde.stationLookup.get(stationId);
      const sys = sde.systems[meta.systemId];
      const hubMatch = HUBS.find((h) => h.stationId === stationId);
      return {
        stationId,
        stationName: meta.stationName,
        systemId: meta.systemId,
        systemName: sys[0],
        regionId: sys[1],
        regionName: sde.regions[sys[1]] || '',
        security: sys[2],
        orderCount: st.orderCount,
        buyIskValue: Math.round(st.buyIskValue),
        hubKey: hubMatch?.key ?? null,
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10);

  // Deduplicate all 20 target stations (Top 10 High-Volume + Top 10 FW)
  const targetStationsMap = new Map();
  for (const s of [...topStations, ...fwStations]) {
    if (!targetStationsMap.has(s.stationId)) {
      targetStationsMap.set(s.stationId, s);
    }
  }
  const allTargetStations = Array.from(targetStationsMap.values());

  // Build compact order books keyed by String(stationId)
  const ordersByStation = {};
  const stationsByRegion = new Map();
  for (const st of allTargetStations) {
    if (!stationsByRegion.has(st.regionId)) stationsByRegion.set(st.regionId, []);
    stationsByRegion.get(st.regionId).push(st.stationId);
  }

  for (const [regionId, stationIds] of stationsByRegion.entries()) {
    const pages = regionPagesCache.get(regionId);
    if (!pages) continue;
    Object.assign(ordersByStation, buildStationBooksFromPages(pages, stationIds));
  }

  const [routes, history7d] = await Promise.all([
    fetchRoutes(HUBS, allTargetStations),
    fetch7DayHistory(Array.from(regionsToFetch)),
  ]);

  // Build Empire-Wide High/Low-Sec Instant-Sell Candidate Index
  // Reference benchmarks across the 5 Major Hubs so we only keep items that can beat at least one Hub!
  const maxHubBuyByType = new Map();
  const minHubSellByType = new Map();
  for (const hub of HUBS) {
    const book = ordersByStation[String(hub.stationId)];
    if (!book) continue;
    for (const [typeIdStr, entry] of Object.entries(book)) {
      const typeId = Number(typeIdStr);
      if (entry.b.length > 0) {
        const cur = maxHubBuyByType.get(typeId) ?? 0;
        if (entry.b[0][0] > cur) maxHubBuyByType.set(typeId, entry.b[0][0]);
      }
      if (entry.s.length > 0) {
        const cur = minHubSellByType.get(typeId) ?? Infinity;
        if (entry.s[0][0] < cur) minHubSellByType.set(typeId, entry.s[0][0]);
      }
    }
  }

  const empireOrders = {};
  const empireStationsMeta = {};
  const preloadedIds = new Set(allTargetStations.map((s) => s.stationId));

  for (const [, pages] of regionPagesCache.entries()) {
    const perStation = new Map();
    for (const orders of pages) {
      for (const o of orders) {
        if (preloadedIds.has(o.location_id)) continue;
        const stMeta = sde.stationLookup.get(o.location_id);
        if (!stMeta) continue;
        const sys = sde.systems[stMeta.systemId];
        if (!sys || sys[2] <= 0.05) continue; // High/Low-Sec only

        let stMap = perStation.get(o.location_id);
        if (!stMap) {
          stMap = new Map();
          perStation.set(o.location_id, stMap);
        }
        let entry = stMap.get(o.type_id);
        if (!entry) {
          entry = { s: [], b: [] };
          stMap.set(o.type_id, entry);
        }
        if (o.is_buy_order) {
          entry.b.push([o.price, o.volume_remain]);
        } else {
          entry.s.push([o.price, o.volume_remain]);
        }
      }
    }

    for (const [stationId, typeMap] of perStation.entries()) {
      const compact = {};
      let keptCount = 0;
      for (const [typeId, book] of typeMap.entries()) {
        book.s.sort((a, b) => a[0] - b[0]);
        book.b.sort((a, b) => b[0] - a[0]);

        const bestSell = book.s[0]?.[0];
        const bestBuy = book.b[0]?.[0];
        const maxHubBuy = maxHubBuyByType.get(typeId) ?? 0;
        const minHubSell = minHubSellByType.get(typeId) ?? Infinity;

        const canSellToHub = bestSell !== undefined && maxHubBuy > bestSell;
        const canBuyFromHub = bestBuy !== undefined && bestBuy > minHubSell;
        if (!canSellToHub && !canBuyFromHub) continue;

        compact[typeId] = {
          s: book.s.slice(0, 3),
          b: book.b.slice(0, 3),
          sv: book.s.reduce((acc, x) => acc + x[1], 0),
          bv: book.b.reduce((acc, x) => acc + x[1], 0),
        };
        keptCount++;
      }

      if (keptCount > 0) {
        const stMeta = sde.stationLookup.get(stationId);
        const sys = sde.systems[stMeta.systemId];
        empireOrders[String(stationId)] = compact;
        empireStationsMeta[String(stationId)] = {
          stationId,
          stationName: stMeta.stationName,
          systemId: stMeta.systemId,
          systemName: sys[0],
          regionId: sys[1],
          regionName: sde.regions[sys[1]] || '',
          security: sys[2],
        };
      }
    }
  }

  // Compute BFS Safe Jumps from each of the 5 Major Hubs to all systems with deals
  const jumpsFromHubs = {};
  for (const hub of HUBS) {
    const bfs = computeBfsJumps(hub.systemId, sde.systems, sde.graph);
    const sysJumps = {};
    for (const st of Object.values(empireStationsMeta)) {
      const j = bfs.get(st.systemId);
      if (j !== undefined) sysJumps[st.systemId] = j;
    }
    for (const st of allTargetStations) {
      const j = bfs.get(st.systemId);
      if (j !== undefined) sysJumps[st.systemId] = j;
    }
    jumpsFromHubs[String(hub.stationId)] = sysJumps;
  }

  const outDir = path.resolve(process.cwd(), 'public', 'data');
  await fs.mkdir(outDir, { recursive: true });

  const marketPath = path.join(outDir, 'market-hubs.json');
  await fs.writeFile(
    marketPath,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      hubs: HUBS,
      topStations,
      fwStations,
      routes,
      jumpsFromHubs,
      history7d,
      items: sde.items,
      orders: ordersByStation,
    })
  );

  const empirePath = path.join(outDir, 'empire-instant.json');
  await fs.writeFile(
    empirePath,
    JSON.stringify({
      stations: empireStationsMeta,
      orders: empireOrders,
    })
  );

  const universePath = path.join(outDir, 'universe-stations.json');
  await fs.writeFile(
    universePath,
    JSON.stringify({
      regions: sde.regions,
      systems: sde.systems,
      stations: sde.stations,
      edges: sde.edges,
    })
  );

  const mSize = ((await fs.stat(marketPath)).size / (1024 * 1024)).toFixed(2);
  const eSize = ((await fs.stat(empirePath)).size / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsed}s! Preloaded ${allTargetStations.length} hubs (${mSize} MB) + ${Object.keys(empireStationsMeta).length} High/Low-Sec empire stations (${eSize} MB).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
