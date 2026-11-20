import type { SystemActivity, UniverseStationsData } from '../types';

export type RoutePreference = 'highsec' | 'shortest';

interface BfsResult {
  dist: Map<number, number>;
  parent: Map<number, number>;
}

let cachedUniverseRef: UniverseStationsData | null = null;
let cachedGraph: Map<number, number[]> | null = null;
const bfsCache = new Map<string, BfsResult>();

/** Binary min-heap keyed by numeric priority for exact (lowSecCount, totalJumps) routing. */
class MinHeap {
  private nodes: number[] = [];
  private costs: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, cost: number): void {
    this.nodes.push(node);
    this.costs.push(cost);
    let idx = this.nodes.length - 1;
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this.costs[parentIdx] <= this.costs[idx]) break;
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  pop(): { node: number; cost: number } | undefined {
    const len = this.nodes.length;
    if (len === 0) return undefined;
    const node = this.nodes[0];
    const cost = this.costs[0];
    const lastNode = this.nodes.pop()!;
    const lastCost = this.costs.pop()!;
    if (len > 1) {
      this.nodes[0] = lastNode;
      this.costs[0] = lastCost;
      let idx = 0;
      const half = this.nodes.length >> 1;
      while (idx < half) {
        let smallest = (idx << 1) + 1;
        const right = smallest + 1;
        if (right < this.nodes.length && this.costs[right] < this.costs[smallest]) {
          smallest = right;
        }
        if (this.costs[idx] <= this.costs[smallest]) break;
        this.swap(idx, smallest);
        idx = smallest;
      }
    }
    return { node, cost };
  }

  private swap(i: number, j: number): void {
    [this.nodes[i], this.nodes[j]] = [this.nodes[j], this.nodes[i]];
    [this.costs[i], this.costs[j]] = [this.costs[j], this.costs[i]];
  }
}

function getGraph(universe: UniverseStationsData): Map<number, number[]> {
  if (cachedUniverseRef === universe && cachedGraph) {
    return cachedGraph;
  }
  const graph = new Map<number, number[]>();
  const edges = universe.edges ?? [];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i];
    const b = edges[i + 1];
    let listA = graph.get(a);
    if (!listA) {
      listA = [];
      graph.set(a, listA);
    }
    listA.push(b);

    let listB = graph.get(b);
    if (!listB) {
      listB = [];
      graph.set(b, listB);
    }
    listB.push(a);
  }
  cachedUniverseRef = universe;
  cachedGraph = graph;
  bfsCache.clear();
  return graph;
}

const LOWSEC_PENALTY = 100_000;

function getBfsResult(
  startSystemId: number,
  universe: UniverseStationsData | null,
  preference: RoutePreference
): BfsResult | null {
  if (!universe || !universe.edges?.length || startSystemId <= 0) return null;
  const cacheKey = `${startSystemId}:${preference}`;
  const existing = bfsCache.get(cacheKey);
  if (existing) return existing;

  const graph = getGraph(universe);
  const dist = new Map<number, number>([[startSystemId, 0]]);
  const parent = new Map<number, number>([[startSystemId, -1]]);

  if (preference === 'highsec') {
    // Dijkstra minimizing (low/null-sec entries * LOWSEC_PENALTY + totalJumps)
    const bestCost = new Map<number, number>([[startSystemId, 0]]);
    const heap = new MinHeap();
    heap.push(startSystemId, 0);

    while (heap.size > 0) {
      const top = heap.pop()!;
      const cur = top.node;
      if (top.cost > (bestCost.get(cur) ?? Infinity)) continue;

      const curDist = dist.get(cur)!;
      const neighbors = graph.get(cur);
      if (!neighbors) continue;

      for (const nxt of neighbors) {
        const sys = universe.systems[String(nxt)];
        const isLowOrNull = !sys || sys[2] < 0.45;
        const nextCost = top.cost + (isLowOrNull ? LOWSEC_PENALTY : 0) + 1;
        if (nextCost < (bestCost.get(nxt) ?? Infinity)) {
          bestCost.set(nxt, nextCost);
          dist.set(nxt, curDist + 1);
          parent.set(nxt, cur);
          heap.push(nxt, nextCost);
        }
      }
    }
  } else {
    // Shortest path regardless of security status
    const queue = [startSystemId];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const d = dist.get(cur)!;
      const neighbors = graph.get(cur);
      if (!neighbors) continue;
      for (const nxt of neighbors) {
        if (dist.has(nxt)) continue;
        dist.set(nxt, d + 1);
        parent.set(nxt, cur);
        queue.push(nxt);
      }
    }
  }

  const result: BfsResult = { dist, parent };
  bfsCache.set(cacheKey, result);
  return result;
}

export function getSystemJumpMap(
  startSystemId: number,
  universe: UniverseStationsData | null,
  preference: RoutePreference
): Map<number, number> | null {
  return getBfsResult(startSystemId, universe, preference)?.dist ?? null;
}

export function getRouteSystemPath(
  fromSystemId: number,
  toSystemId: number,
  universe: UniverseStationsData | null,
  preference: RoutePreference
): number[] {
  if (!universe || !universe.edges?.length || fromSystemId <= 0 || toSystemId <= 0) {
    return [];
  }
  if (fromSystemId === toSystemId) return [fromSystemId];

  const bfs = getBfsResult(fromSystemId, universe, preference);
  if (!bfs || !bfs.parent.has(toSystemId)) return [];

  const path: number[] = [];
  let cur = toSystemId;
  while (cur !== -1) {
    path.push(cur);
    cur = bfs.parent.get(cur) ?? -1;
  }
  path.reverse();
  return path;
}

const JITA_SYSTEM_ID = 30000142;

export function summarizePathKills(
  systemIds: number[],
  activityMap: Record<number, SystemActivity>,
  universe: UniverseStationsData | null
): { totalShipKills: number; hottestSystem: { name: string; kills: number } | null } {
  const seen = new Set<number>();
  let totalShipKills = 0;
  let hottest: { name: string; kills: number } | null = null;

  for (const sysId of systemIds) {
    if (sysId === JITA_SYSTEM_ID || seen.has(sysId)) continue;
    seen.add(sysId);
    const kills = activityMap[sysId]?.shipKills ?? 0;
    totalShipKills += kills;
    if (kills > 0 && (!hottest || kills > hottest.kills)) {
      const name = universe?.systems[String(sysId)]?.[0] ?? String(sysId);
      hottest = { name, kills };
    }
  }
  return { totalShipKills, hottestSystem: hottest };
}
