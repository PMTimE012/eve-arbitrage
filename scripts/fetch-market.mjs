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

const FW_MILITIAS = [
  { corporationId: 1000180, name: 'State Protectorate', factionName: 'Caldari State', shortName: 'Caldari' },
  { corporationId: 1000181, name: 'Federal Defense Union', factionName: 'Gallente Federation', shortName: 'Gallente' },
  { corporationId: 1000179, name: '24th Imperial Crusade', factionName: 'Amarr Empire', shortName: 'Amarr' },
  { corporationId: 1000182, name: 'Tribal Liberation Force', factionName: 'Minmatar Republic', shortName: 'Minmatar' },
  { corporationId: 1000437, name: 'Commando Guri', factionName: 'Guristas Pirates', shortName: 'Guristas' },
  { corporationId: 1000436, name: 'Malakim Zealots', factionName: 'Angel Cartel', shortName: 'Angel' },
];

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
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.noRetry = res.status >= 400 && res.status < 500;
        throw err;
      }
      return res;
    } catch (err) {
      if (err?.noRetry || attempt === retries) throw err;
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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
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
  console.log('Downloading Fuzzwork SDE (invTypes, invGroups, invVolumes, staStations, mapSolarSystems, mapRegions, mapSolarSystemJumps)...');
  const [typesRes, groupsRes, volRes, stationsRes, systemsRes, regionsRes, jumpsRes] = await Promise.all([
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/invTypes.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/invGroups.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/invVolumes.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/staStations.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapSolarSystems.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapRegions.csv'),
    fetchWithRetry('https://www.fuzzwork.co.uk/dump/latest/csv/mapSolarSystemJumps.csv'),
  ]);

  const [typesCsv, groupsCsv, volCsv, stationsCsv, systemsCsv, regionsCsv, jumpsCsv] = await Promise.all([
    typesRes.text(),
    groupsRes.text(),
    volRes.text(),
    stationsRes.text(),
    systemsRes.text(),
    regionsRes.text(),
    jumpsRes.text(),
  ]);

  // Identify Skillbook groups (categoryID === 16) so we can exclude them
  const skillGroupIds = new Set();
  const gLines = groupsCsv.split(/\r?\n/);
  const gHeaders = parseCsvLine(gLines[0]);
  const gIdxId = gHeaders.indexOf('groupID');
  const gIdxCat = gHeaders.indexOf('categoryID');
  for (let i = 1; i < gLines.length; i++) {
    if (!gLines[i]) continue;
    const cols = parseCsvLine(gLines[i]);
    if (Number(cols[gIdxCat]) === 16) {
      skillGroupIds.add(Number(cols[gIdxId]));
    }
  }

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
  const typeRows = parseCsv(typesCsv);
  const tHeaders = typeRows[0];
  const idxId = tHeaders.indexOf('typeID');
  const idxGroup = tHeaders.indexOf('groupID');
  const idxName = tHeaders.indexOf('typeName');
  const idxVol = tHeaders.indexOf('volume');
  const idxPub = tHeaders.indexOf('published');
  const idxMkt = tHeaders.indexOf('marketGroupID');

  for (let i = 1; i < typeRows.length; i++) {
    const cols = typeRows[i];
    if (!cols || cols.length <= idxMkt) continue;
    if (cols[idxPub] !== '1') continue;
    if (skillGroupIds.has(Number(cols[idxGroup]))) continue;
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
    .slice(0, 50)
    .map(({ _score: _, ...rest }) => rest);

  console.log('Top 50 FW/Reship:', fwStations.slice(0, 10).map((s) => `${s.systemName} (${s.jumps}j/${s.shipKills}k)`).join(', '), '...');
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

function computeShortestBfsJumps(startSystemId, graph) {
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
      dist.set(nxt, d + 1);
      queue.push(nxt);
    }
  }

  return dist;
}

function computeRoutesLocally(hubs, allTargetStations, sde) {
  const routes = {};
  for (const hub of hubs) {
    const secureMap = computeBfsJumps(hub.systemId, sde.systems, sde.graph);
    const shortestMap = computeShortestBfsJumps(hub.systemId, sde.graph);
    for (const to of allTargetStations) {
      if (hub.systemId === to.systemId) continue;
      const secureJumps = secureMap.get(to.systemId);
      const shortestJumps = shortestMap.get(to.systemId);
      if (secureJumps === undefined || shortestJumps === undefined) continue;
      const entry = { secureJumps, shortestJumps };
      routes[`${hub.systemId}->${to.systemId}`] = entry;
      routes[`${to.systemId}->${hub.systemId}`] = entry;
    }
  }
  return routes;
}

function computeMedian(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchMarketHistory(targetRegionIds, sde) {
  console.log('Downloading 30-day market history from EVE Ref...');
  const regionSet = new Set(targetRegionIds.map(Number));
  const now = new Date();

  // Check last 35 UTC days to collect up to 30 published daily files
  const candidateDates = [];
  for (let i = 1; i <= 35; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    candidateDates.push(d.toISOString().slice(0, 10));
  }

  // Download in parallel (concurrency 6) and keep only available dates in newest->oldest order
  const downloaded = await runPool(candidateDates, 6, async (dateStr) => {
    const year = dateStr.slice(0, 4);
    const url = `https://data.everef.net/market-history/${year}/market-history-${dateStr}.csv.bz2`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const csv = Buffer.from(seekBzip.decode(buf)).toString('utf8');
      return { dateStr, csv };
    } catch {
      return null;
    }
  });

  const validDays = downloaded.filter(Boolean).slice(0, 30); // newest -> oldest
  const daysLoaded = validDays.length;
  const days7 = Math.min(7, daysLoaded);
  const days14 = Math.min(14, daysLoaded);

  // Per `${regId}:${typeId}` accumulate 7d/30d stats + 14d sparkline
  const statsMap = new Map();

  for (let dayIdx = 0; dayIdx < daysLoaded; dayIdx++) {
    const { csv } = validDays[dayIdx];
    const lines = csv.split(/\r?\n/);
    const headers = lines[0].split(',');
    const idxVol = headers.indexOf('volume');
    const idxAvg = headers.indexOf('average');
    const idxHigh = headers.indexOf('highest');
    const idxLow = headers.indexOf('lowest');
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

      const avgPrice = Number(cols[idxAvg]) || 0;
      const high = Number(cols[idxHigh]) || avgPrice;
      const low = Number(cols[idxLow]) || avgPrice;
      const buyShare =
        high > low ? Math.max(0, Math.min(1, (avgPrice - low) / (high - low))) : 1;
      const buyerVol = vol * buyShare;

      const key = `${regId}:${typeId}`;
      let rec = statsMap.get(key);
      if (!rec) {
        rec = {
          regId,
          typeId,
          sum14: 0,
          sum30: 0,
          totalActive14: 0,
          sellHighWeighted14: 0,
          sellHighWeighted30: 0,
          buySum14: 0,
          buySum30: 0,
          active14: 0,
          buyIsk14: 0,
          buyVols14: new Array(days14).fill(0),
          buySpark14: new Array(days14).fill(0),
        };
        statsMap.set(key, rec);
      }

      rec.sum30 += vol;
      rec.sellHighWeighted30 += high * vol;
      rec.buySum30 += buyerVol;
      if (dayIdx < days14) {
        rec.sum14 += vol;
        rec.totalActive14++;
        rec.sellHighWeighted14 += high * vol;
        rec.buySum14 += buyerVol;
        if (buyerVol >= 0.5) rec.active14++;
        rec.buyIsk14 += avgPrice * buyerVol;
        rec.buyVols14[dayIdx] = Math.round(buyerVol * 10) / 10;
        // Store oldest -> newest
        rec.buySpark14[days14 - 1 - dayIdx] = Math.round(buyerVol);
      }
    }
  }

  const history7d = {};
  const historySellPrice7d = {};
  const historyTrend7d = {};
  const historyActive14d = {};
  const byRegionTrending = new Map();

  if (daysLoaded > 0) {
    for (const rec of statsMap.values()) {
      const avg14 = days14 > 0 ? rec.sum14 / days14 : 0;
      const avg30Total = rec.sum30 / daysLoaded;
      if (avg14 > 0) {
        const rounded = avg14 >= 10 ? Math.round(avg14) : Math.round(avg14 * 10) / 10;
        if (rounded > 0) {
          if (!history7d[rec.regId]) history7d[rec.regId] = {};
          history7d[rec.regId][rec.typeId] = rounded;
        }
      }
      if (rec.totalActive14 > 0) {
        if (!historyActive14d[rec.regId]) historyActive14d[rec.regId] = {};
        historyActive14d[rec.regId][rec.typeId] = rec.totalActive14;
      }
      if (avg30Total > 0) {
        const trend = Math.round(((avg14 - avg30Total) / avg30Total) * 100);
        if (!historyTrend7d[rec.regId]) historyTrend7d[rec.regId] = {};
        historyTrend7d[rec.regId][rec.typeId] = trend;
      }
      const avgSellPrice =
        rec.sum14 > 0 && rec.sellHighWeighted14 > 0
          ? Math.round((rec.sellHighWeighted14 / rec.sum14) * 100) / 100
          : rec.sum30 > 0 && rec.sellHighWeighted30 > 0
          ? Math.round((rec.sellHighWeighted30 / rec.sum30) * 100) / 100
          : 0;
      if (avgSellPrice > 0) {
        if (!historySellPrice7d[rec.regId]) historySellPrice7d[rec.regId] = {};
        historySellPrice7d[rec.regId][rec.typeId] = avgSellPrice;
      }

      // Build trending candidates using Buyer-Driven Volume (Median 14d vs Avg 30d)
      const itemMeta = sde.items[rec.typeId];
      if (!itemMeta) continue;
      const buyPressurePct = rec.sum14 > 0 ? (rec.buySum14 / rec.sum14) * 100 : 0;
      if (buyPressurePct < 50) continue; // Only items mostly bought from Sell Orders
      const med14 = computeMedian(rec.buyVols14);
      if (med14 < 10) continue;
      const avg30 = rec.buySum30 / daysLoaded;
      if (avg30 <= 0 || med14 <= avg30) continue;
      if (rec.active14 < 6) continue;
      const iskVol14d = days14 > 0 ? rec.buyIsk14 / days14 : 0;
      if (iskVol14d < 500_000) continue;

      const trendPct = ((med14 - avg30) / avg30) * 100;
      const entry = {
        regionId: rec.regId,
        regionName: sde.regions[rec.regId] || String(rec.regId),
        typeId: rec.typeId,
        name: itemMeta.n,
        med7d: Math.round(med14 * 10) / 10,
        avg30d: Math.round(avg30 * 10) / 10,
        trendPct: Math.round(trendPct * 10) / 10,
        activeDays7: rec.active14,
        iskVol7d: Math.round(iskVol14d),
        buyPressurePct: Math.round(buyPressurePct),
        spark14: rec.buySpark14,
      };

      if (!byRegionTrending.has(rec.regId)) byRegionTrending.set(rec.regId, []);
      byRegionTrending.get(rec.regId).push(entry);
    }
  }

  const trendingItems = [];
  for (const list of byRegionTrending.values()) {
    list.sort((a, b) => b.trendPct - a.trendPct);
    trendingItems.push(...list.slice(0, 80));
  }
  trendingItems.sort((a, b) => b.trendPct - a.trendPct);

  const trendingRegions = Array.from(regionSet)
    .map((id) => ({ id, name: sde.regions[id] || String(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(
    `Loaded ${daysLoaded}-day market history for ${Object.keys(history7d).length} regions (${trendingItems.length} trending entries).`
  );
  return {
    history7d,
    historySellPrice7d,
    historyTrend7d,
    historyActive14d,
    trending: {
      updatedAt: new Date().toISOString(),
      regions: trendingRegions,
      items: trendingItems,
    },
  };
}

async function fetchFwLpOffers(sde) {
  console.log('Fetching FW LP Store offers for 6 militias...');
  const corporations = await runPool(FW_MILITIAS, 6, async (corp) => {
    try {
      const res = await fetchWithRetry(
        `https://esi.evetech.net/latest/loyalty/stores/${corp.corporationId}/offers/?datasource=tranquility`
      );
      const raw = await res.json();
      if (!Array.isArray(raw)) {
        return { ...corp, offers: [] };
      }
      const offers = [];
      for (const o of raw) {
        if (!o || o.lp_cost <= 0 || !sde.items[o.type_id]) continue;
        offers.push({
          offerId: o.offer_id,
          typeId: o.type_id,
          quantity: o.quantity,
          lpCost: o.lp_cost,
          iskCost: o.isk_cost,
          ...(o.ak_cost > 0 ? { akCost: o.ak_cost } : {}),
          requiredItems: Array.isArray(o.required_items)
            ? o.required_items.map((r) => ({ typeId: r.type_id, quantity: r.quantity }))
            : [],
        });
      }
      return { ...corp, offers };
    } catch (err) {
      console.warn(`Failed to fetch LP offers for ${corp.name}:`, err?.message || err);
      return { ...corp, offers: [] };
    }
  });

  const totalOffers = corporations.reduce((acc, c) => acc + c.offers.length, 0);
  console.log(`Loaded ${totalOffers} marketable FW LP offers across ${corporations.length} militias.`);
  return {
    updatedAt: new Date().toISOString(),
    corporations,
  };
}

async function main() {
  const start = Date.now();
  const sde = await loadSdeData();
  const [fwStations, fwLpOffers] = await Promise.all([
    fetchFwAndActivity(sde),
    fetchFwLpOffers(sde),
  ]);

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

  // Rank Top 50 High-Volume NPC Stations
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
    .slice(0, 50);

  // Deduplicate target stations (Top 50 High-Volume + Top 50 FW)
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

  const routes = computeRoutesLocally(HUBS, allTargetStations, sde);
  const { history7d, historySellPrice7d, historyTrend7d, historyActive14d, trending } = await fetchMarketHistory(Array.from(regionsToFetch), sde);

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
      historySellPrice7d,
      historyTrend7d,
      historyActive14d,
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

  const trendingPath = path.join(outDir, 'market-trending.json');
  await fs.writeFile(trendingPath, JSON.stringify(trending));

  const fwLpPath = path.join(outDir, 'fw-lp-offers.json');
  await fs.writeFile(fwLpPath, JSON.stringify(fwLpOffers));

  const mSize = ((await fs.stat(marketPath)).size / (1024 * 1024)).toFixed(2);
  const eSize = ((await fs.stat(empirePath)).size / (1024 * 1024)).toFixed(2);
  const tSize = ((await fs.stat(trendingPath)).size / 1024).toFixed(0);
  const lpSize = ((await fs.stat(fwLpPath)).size / 1024).toFixed(0);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsed}s! Preloaded ${allTargetStations.length} hubs (${mSize} MB) + ${Object.keys(empireStationsMeta).length} High/Low-Sec empire stations (${eSize} MB) + ${trending.items.length} trending items (${tSize} KB) + FW LP offers (${lpSize} KB).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
