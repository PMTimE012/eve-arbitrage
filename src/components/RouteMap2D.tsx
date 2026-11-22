import { Map as MapIcon, Maximize2, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketDataset, SystemActivity, UniverseStationsData } from '../types';
import { getRouteSystemPath, type RoutePreference } from '../utils/routing';
import type { SavedTripPlan } from '../utils/savedPlans';

interface RouteMap2DProps {
  plan: SavedTripPlan;
  universe: UniverseStationsData | null;
  dataset: MarketDataset | null;
  activityMap: Record<number, SystemActivity>;
  routePref?: RoutePreference;
}

interface EmpireNode {
  systemId: number;
  name: string;
  regionId: number;
  sec: number;
  x: number;
  y: number;
  isTopHub: boolean;
  isTopFw: boolean;
}

function getSecColor(sec: number): string {
  if (sec >= 0.45) return '#34d399';
  if (sec > 0.0) return '#fbbf24';
  return '#f87171';
}

function resolveStationSystemId(
  stationId: number,
  universe: UniverseStationsData | null,
  dataset: MarketDataset | null
): number | null {
  if (!stationId) return null;
  const fromTop = dataset?.topStations.find((s) => s.stationId === stationId);
  if (fromTop) return fromTop.systemId;
  const fromFw = dataset?.fwStations?.find((s) => s.stationId === stationId);
  if (fromFw) return fromFw.systemId;
  if (universe) {
    const found = universe.stations.find((s) => s[0] === stationId);
    if (found) return found[2];
  }
  return null;
}

export function RouteMap2D({
  plan,
  universe,
  dataset,
  routePref = 'shortest',
}: RouteMap2DProps) {
  const [hoveredSysId, setHoveredSysId] = useState<number | null>(null);
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const { zoom, pan } = view;
  const [lastPlanUid, setLastPlanUid] = useState(plan.uid);
  if (plan.uid !== lastPlanUid) {
    setLastPlanUid(plan.uid);
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
  }

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const WIDTH = 210;
  const HEIGHT = 500;

  // Priority label sets: Top 20 Hub & Top 20 FW systems
  const { topHubSysIds, topFwSysIds } = useMemo(() => {
    const hubs = new Set<number>((dataset?.topStations ?? []).slice(0, 20).map((s) => s.systemId));
    const fws = new Set<number>((dataset?.fwStations ?? []).slice(0, 20).map((s) => s.systemId));
    return { topHubSysIds: hubs, topFwSysIds: fws };
  }, [dataset]);

  // Build route path & stop markers
  const routeContext = useMemo(() => {
    if (!universe || plan.stops.length === 0) {
      return {
        fullPath: [] as number[],
        approachPath: [] as number[],
        routeSet: new Set<number>(),
        stopsBySys: new Map<number, number[]>(),
        approachLabels: new Map<number, string>(),
        finalDestSysId: null as number | null,
      };
    }

    const approachPath: number[] = [];
    const approachLabels = new Map<number, string>();
    const app = plan.approach;
    if (app && plan.stops[0]?.systemId > 0) {
      const appWaypoints = [
        app.currentSystemId,
        app.buySystemId,
        app.sellSystemId,
        plan.stops[0].systemId,
      ].filter((id) => id > 0);
      if (appWaypoints.length > 0) {
        approachPath.push(appWaypoints[0]);
        for (let i = 1; i < appWaypoints.length; i++) {
          const fromSys = appWaypoints[i - 1];
          const toSys = appWaypoints[i];
          if (fromSys === toSys) continue;
          const leg = getRouteSystemPath(fromSys, toSys, universe, routePref);
          if (leg.length > 1) {
            for (let k = 1; k < leg.length; k++) approachPath.push(leg[k]);
          } else {
            approachPath.push(toSys);
          }
        }
      }
      if (app.currentSystemId > 0) {
        approachLabels.set(
          app.currentSystemId,
          app.buySystemId === app.currentSystemId ? 'CUR/BUY' : 'CUR'
        );
      }
      if (app.buySystemId > 0 && app.buySystemId !== app.currentSystemId) {
        approachLabels.set(app.buySystemId, 'BUY');
      }
      if (app.sellSystemId > 0 && app.sellSystemId !== plan.stops[0].systemId) {
        const existing = approachLabels.get(app.sellSystemId);
        approachLabels.set(app.sellSystemId, existing ? `${existing}/SELL` : 'SELL');
      }
    }

    const waypoints: { systemId: number; stopNum?: number; isFinalDest?: boolean }[] = [];
    plan.stops.forEach((s, idx) => {
      if (s.systemId > 0) waypoints.push({ systemId: s.systemId, stopNum: idx + 1 });
    });

    const firstDestId = plan.stops[0]?.items[0]?.destStationId ?? 0;
    const finalDestSysId = resolveStationSystemId(firstDestId, universe, dataset);
    if (finalDestSysId && finalDestSysId > 0) {
      waypoints.push({ systemId: finalDestSysId, isFinalDest: true });
    }

    if (waypoints.length === 0) {
      return {
        fullPath: [] as number[],
        approachPath,
        routeSet: new Set<number>(approachPath),
        stopsBySys: new Map<number, number[]>(),
        approachLabels,
        finalDestSysId: null as number | null,
      };
    }

    const fullPath: number[] = [waypoints[0].systemId];
    for (let i = 1; i < waypoints.length; i++) {
      const fromSys = waypoints[i - 1].systemId;
      const toSys = waypoints[i].systemId;
      if (fromSys === toSys) continue;
      const leg = getRouteSystemPath(fromSys, toSys, universe, routePref);
      if (leg.length > 1) {
        for (let k = 1; k < leg.length; k++) fullPath.push(leg[k]);
      } else {
        fullPath.push(toSys);
      }
    }

    const stopsBySys = new Map<number, number[]>();
    for (const wp of waypoints) {
      if (wp.stopNum) {
        const arr = stopsBySys.get(wp.systemId) ?? [];
        arr.push(wp.stopNum);
        stopsBySys.set(wp.systemId, arr);
      }
    }

    return {
      fullPath,
      approachPath,
      routeSet: new Set([...approachPath, ...fullPath]),
      stopsBySys,
      approachLabels,
      finalDestSysId,
    };
  }, [universe, plan, dataset, routePref]);

  // Project ALL High-Sec & Low-Sec systems (sec > 0.0) into 2D map coordinates, auto-fitted to the route
  const { empireNodes, empireMap, intraEdges, crossRegionEdges, routeEdges, approachEdges, worldBounds } = useMemo(() => {
    if (!universe) {
      return {
        empireNodes: [] as EmpireNode[],
        empireMap: new Map<number, EmpireNode>(),
        intraEdges: [] as [EmpireNode, EmpireNode][],
        crossRegionEdges: [] as [EmpireNode, EmpireNode][],
        routeEdges: [] as { from: EmpireNode; to: EmpireNode; isDanger: boolean }[],
        approachEdges: [] as { from: EmpireNode; to: EmpireNode; isDanger: boolean }[],
        worldBounds: { minX: 0, maxX: WIDTH, minY: 0, maxY: HEIGHT },
      };
    }

    // Fit initial viewport around the active route (or all High/Low-Sec if no route)
    const fitIds = [...routeContext.approachPath, ...routeContext.fullPath].filter((id) => {
      const s = universe.systems[String(id)];
      return s && typeof s[3] === 'number' && typeof s[4] === 'number';
    });

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const boundsSource =
      fitIds.length > 0
        ? fitIds
        : Object.keys(universe.systems)
            .filter((k) => {
              const s = universe.systems[k];
              return s && s[2] > 0 && typeof s[3] === 'number';
            })
            .map(Number);

    for (const id of boundsSource) {
      const s = universe.systems[String(id)];
      if (!s || typeof s[3] !== 'number' || typeof s[4] !== 'number') continue;
      const px = s[3];
      const py = -s[4];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    if (!Number.isFinite(minX)) {
      return {
        empireNodes: [] as EmpireNode[],
        empireMap: new Map<number, EmpireNode>(),
        intraEdges: [] as [EmpireNode, EmpireNode][],
        crossRegionEdges: [] as [EmpireNode, EmpireNode][],
        routeEdges: [] as { from: EmpireNode; to: EmpireNode; isDanger: boolean }[],
        approachEdges: [] as { from: EmpireNode; to: EmpireNode; isDanger: boolean }[],
        worldBounds: { minX: 0, maxX: WIDTH, minY: 0, maxY: HEIGHT },
      };
    }

    const spanX = Math.max(2000, maxX - minX);
    const spanY = Math.max(2000, maxY - minY);
    const padX = 28;
    const padY = 36;
    const scale = Math.min((WIDTH - padX * 2) / spanX, (HEIGHT - padY * 2) / spanY);
    const offsetX = (WIDTH - spanX * scale) / 2;
    const offsetY = (HEIGHT - spanY * scale) / 2;

    const map = new Map<number, EmpireNode>();
    for (const [idStr, s] of Object.entries(universe.systems)) {
      const sysId = Number(idStr);
      const sec = s[2];
      // Show ALL High-Sec & Low-Sec systems (sec > 0.0), plus any system on the active route
      if (sec <= 0.0 && !routeContext.routeSet.has(sysId)) continue;
      if (typeof s[3] !== 'number' || typeof s[4] !== 'number') continue;

      map.set(sysId, {
        systemId: sysId,
        name: s[0],
        regionId: s[1],
        sec,
        x: offsetX + (s[3] - minX) * scale,
        y: offsetY + (-s[4] - minY) * scale,
        isTopHub: topHubSysIds.has(sysId),
        isTopFw: topFwSysIds.has(sysId),
      });
    }

    const intraList: [EmpireNode, EmpireNode][] = [];
    const crossList: [EmpireNode, EmpireNode][] = [];
    const seen = new Set<string>();
    const rawEdges = universe.edges ?? [];
    for (let i = 0; i < rawEdges.length; i += 2) {
      const a = rawEdges[i];
      const b = rawEdges[i + 1];
      const na = map.get(a);
      const nb = map.get(b);
      if (!na || !nb) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (na.regionId !== nb.regionId) {
        crossList.push([na, nb]);
      } else {
        intraList.push([na, nb]);
      }
    }

    const rEdges: { from: EmpireNode; to: EmpireNode; isDanger: boolean }[] = [];
    const mainEdgeKeys = new Set<string>();
    for (let i = 1; i < routeContext.fullPath.length; i++) {
      const from = map.get(routeContext.fullPath[i - 1]);
      const to = map.get(routeContext.fullPath[i]);
      if (!from || !to) continue;
      const key =
        from.systemId < to.systemId
          ? `${from.systemId}:${to.systemId}`
          : `${to.systemId}:${from.systemId}`;
      mainEdgeKeys.add(key);
      rEdges.push({
        from,
        to,
        isDanger: from.sec < 0.45 || to.sec < 0.45,
      });
    }

    const aEdges: { from: EmpireNode; to: EmpireNode; isDanger: boolean }[] = [];
    const seenAppKeys = new Set<string>();
    for (let i = 1; i < routeContext.approachPath.length; i++) {
      const from = map.get(routeContext.approachPath[i - 1]);
      const to = map.get(routeContext.approachPath[i]);
      if (!from || !to) continue;
      const key =
        from.systemId < to.systemId
          ? `${from.systemId}:${to.systemId}`
          : `${to.systemId}:${from.systemId}`;
      // Don't draw duplicate overlapping lines on edges already in the main route
      if (mainEdgeKeys.has(key) || seenAppKeys.has(key)) continue;
      seenAppKeys.add(key);
      aEdges.push({
        from,
        to,
        isDanger: from.sec < 0.45 || to.sec < 0.45,
      });
    }

    const nodesArr = Array.from(map.values());
    let wMinX = Infinity;
    let wMaxX = -Infinity;
    let wMinY = Infinity;
    let wMaxY = -Infinity;
    for (const n of nodesArr) {
      if (n.x < wMinX) wMinX = n.x;
      if (n.x > wMaxX) wMaxX = n.x;
      if (n.y < wMinY) wMinY = n.y;
      if (n.y > wMaxY) wMaxY = n.y;
    }

    return {
      empireNodes: nodesArr,
      empireMap: map,
      intraEdges: intraList,
      crossRegionEdges: crossList,
      routeEdges: rEdges,
      approachEdges: aEdges,
      worldBounds: { minX: wMinX, maxX: wMaxX, minY: wMinY, maxY: wMaxY },
    };
  }, [universe, routeContext, topHubSysIds, topFwSysIds]);

  const clampPan = (px: number, py: number, z: number) => {
    const margin = 36;
    const minPanX = margin - WIDTH / 2 - z * (worldBounds.maxX - WIDTH / 2);
    const maxPanX = WIDTH - margin - WIDTH / 2 - z * (worldBounds.minX - WIDTH / 2);
    const minPanY = margin - HEIGHT / 2 - z * (worldBounds.maxY - HEIGHT / 2);
    const maxPanY = HEIGHT - margin - HEIGHT / 2 - z * (worldBounds.minY - HEIGHT / 2);
    return {
      x: minPanX > maxPanX ? (minPanX + maxPanX) / 2 : Math.min(maxPanX, Math.max(minPanX, px)),
      y: minPanY > maxPanY ? (minPanY + maxPanY) / 2 : Math.min(maxPanY, Math.max(minPanY, py)),
    };
  };

  // Attach non-passive wheel listener so zooming centers on mouse cursor without scrolling page
  const hasNodes = empireNodes.length > 0;
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || !hasNodes) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const cw = el.clientWidth || WIDTH;
      const ch = el.clientHeight || HEIGHT;
      const viewScale = Math.min(cw / WIDTH, ch / HEIGHT);
      const viewOffX = (cw - WIDTH * viewScale) / 2;
      const viewOffY = (ch - HEIGHT * viewScale) / 2;
      const vx = (e.clientX - rect.left - viewOffX) / viewScale - WIDTH / 2;
      const vy = (e.clientY - rect.top - viewOffY) / viewScale - HEIGHT / 2;
      const factor = e.deltaY < 0 ? 1.18 : 0.85;

      setView((prev) => {
        const nextZoom = Math.min(12, Math.max(0.12, prev.zoom * factor));
        const ratio = nextZoom / prev.zoom;
        const nextPan = clampPan(
          vx - ratio * (vx - prev.pan.x),
          vy - ratio * (vy - prev.pan.y),
          nextZoom
        );
        return {
          zoom: nextZoom,
          pan: nextPan,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasNodes, worldBounds]);

  // Render all ~3,500 High/Low-Sec dots & stargates onto Canvas at 60fps
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = mapContainerRef.current;
    if (!canvas || !container || empireNodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth || WIDTH;
    const ch = container.clientHeight || HEIGHT;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match SVG viewBox preserveAspectRatio="xMidYMid meet"
    const viewScale = Math.min(cw / WIDTH, ch / HEIGHT);
    const viewOffX = (cw - WIDTH * viewScale) / 2;
    const viewOffY = (ch - HEIGHT * viewScale) / 2;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    ctx.translate(viewOffX, viewOffY);
    ctx.scale(viewScale, viewScale);
    ctx.translate(WIDTH / 2 + pan.x, HEIGHT / 2 + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-WIDTH / 2, -HEIGHT / 2);

    const invScale = 1 / Math.sqrt(zoom);

    // 1a. Intra-region Stargate Lines (ultra-thin solid)
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = 0.35 * invScale;
    ctx.beginPath();
    for (const [a, b] of intraEdges) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // 1b. Cross-region Stargate Lines (ultra-thin dashed)
    ctx.setLineDash([2 * invScale, 2.5 * invScale]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 0.35 * invScale;
    ctx.beginPath();
    for (const [a, b] of crossRegionEdges) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. All High/Low-Sec System Dots (micro dots off-route; clear dots on-route)
    for (const n of empireNodes) {
      const onRoute = routeContext.routeSet.has(n.systemId);
      const isStop = routeContext.stopsBySys.has(n.systemId) || routeContext.finalDestSysId === n.systemId;
      const r = (isStop ? 2.6 : onRoute ? 1.8 : n.isTopHub || n.isTopFw ? 0.9 : 0.55) * invScale;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isStop
        ? '#cbd5e1'
        : onRoute
        ? '#94a3b8'
        : n.isTopHub || n.isTopFw
        ? '#64748b'
        : '#334155';
      ctx.fill();
    }

    ctx.restore();
  }, [empireNodes, intraEdges, crossRegionEdges, routeContext, zoom, pan]);

  // Hit-test any High/Low-Sec system under mouse cursor
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = mapContainerRef.current;
    if (!container || empireNodes.length === 0) return;
    const cw = container.clientWidth || WIDTH;
    const ch = container.clientHeight || HEIGHT;
    const viewScale = Math.min(cw / WIDTH, ch / HEIGHT);

    if (dragRef.current) {
      const nextX = dragRef.current.origX + (e.clientX - dragRef.current.startX) / viewScale;
      const nextY = dragRef.current.origY + (e.clientY - dragRef.current.startY) / viewScale;
      setView((prev) => ({
        ...prev,
        pan: clampPan(nextX, nextY, prev.zoom),
      }));
      return;
    }

    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const viewOffX = (cw - WIDTH * viewScale) / 2;
    const viewOffY = (ch - HEIGHT * viewScale) / 2;

    // Invert transform to SVG world coords
    const wx = ((mx - viewOffX) / viewScale - (WIDTH / 2 + pan.x)) / zoom + WIDTH / 2;
    const wy = ((my - viewOffY) / viewScale - (HEIGHT / 2 + pan.y)) / zoom + HEIGHT / 2;
    const maxDistSq = Math.pow(9 / (viewScale * zoom), 2);

    let bestId: number | null = null;
    let bestDistSq = maxDistSq;
    for (const n of empireNodes) {
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestId = n.systemId;
      }
    }
    if (bestId !== hoveredSysId) {
      setHoveredSysId(bestId);
    }
  };

  const invScale = 1 / Math.sqrt(zoom);

  // Labels to render in SVG overlay: Approach, Stops, DEST, Top 50 Hub, Top 50 FW, and Hovered system
  const labeledNodes = useMemo(() => {
    return empireNodes.filter(
      (n) =>
        routeContext.approachLabels.has(n.systemId) ||
        routeContext.stopsBySys.has(n.systemId) ||
        routeContext.finalDestSysId === n.systemId ||
        n.isTopHub ||
        n.isTopFw ||
        n.systemId === hoveredSysId
    );
  }, [empireNodes, routeContext, hoveredSysId]);

  const activeNode =
    (hoveredSysId !== null ? empireMap.get(hoveredSysId) : null) ??
    (routeContext.fullPath[0] ? empireMap.get(routeContext.fullPath[0]) : null) ??
    null;

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#050811] flex flex-col overflow-hidden h-full">
      {/* Header with +, -, Fit Route */}
      <div className="px-2 py-1.5 border-b border-slate-800/80 bg-[#090d16] flex items-center justify-between gap-1 text-[10px]">
        <div className="flex items-center gap-1 text-slate-200 font-semibold truncate">
          <MapIcon className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="truncate">
            {routeContext.fullPath.length > 1 ? `${routeContext.fullPath.length - 1}j` : 'Map'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              setView((prev) => ({
                ...prev,
                zoom: Math.min(12, prev.zoom * 1.35),
              }))
            }
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Zoom in (+)"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() =>
              setView((prev) => ({
                ...prev,
                zoom: Math.max(0.12, prev.zoom * 0.74),
              }))
            }
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Zoom out (-)"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })}
            className="p-1 rounded text-cyan-300 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Fit full route (Origin → Dest)"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Canvas (All High/Low-Sec) + SVG Overlay (Animated Dashed Route & Top 50 Hub/FW Labels) */}
      {empireNodes.length === 0 ? (
        <div className="flex-1 min-h-[340px] flex items-center justify-center text-xs text-slate-500">
          Loading New Eden map...
        </div>
      ) : (
        <div
          ref={mapContainerRef}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => {
            if (dragRef.current) {
              dragRef.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            if (!dragRef.current) setHoveredSysId(null);
          }}
          className="flex-1 min-h-[340px] relative overflow-hidden touch-none cursor-grab active:cursor-grabbing bg-[radial-gradient(ellipse_at_center,_rgba(14,116,144,0.08)_0%,_rgba(4,7,15,1)_82%)]"
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="relative w-full h-full min-h-[340px] select-none pointer-events-none"
          >
            <g
              transform={`translate(${WIDTH / 2 + pan.x}, ${HEIGHT / 2 + pan.y}) scale(${zoom}) translate(${-WIDTH / 2}, ${-HEIGHT / 2})`}
            >
              {/* Approach Leg Animated Dotted Lines (Current -> En-Route -> Ori) */}
              {approachEdges.map((edge, idx) => (
                <line
                  key={`app-${idx}`}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={edge.isDanger ? '#f43f5e' : '#f59e0b'}
                  strokeWidth={0.8 * invScale}
                  strokeDasharray={`${0.3 * invScale} ${1.7 * invScale}`}
                  strokeLinecap="round"
                  opacity={0.95}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from={`${2 * invScale}`}
                    to="0"
                    dur="0.7s"
                    repeatCount="indefinite"
                  />
                </line>
              ))}

              {/* Thin Animated Dashed Route Lines */}
              {routeEdges.map((edge, idx) => (
                <line
                  key={`rt-${idx}`}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={edge.isDanger ? '#fbbf24' : '#38bdf8'}
                  strokeWidth={1.3 * invScale}
                  strokeDasharray={`${4 * invScale} ${4 * invScale}`}
                  strokeLinecap="round"
                  opacity={0.95}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from={`${8 * invScale}`}
                    to="0"
                    dur="0.8s"
                    repeatCount="indefinite"
                  />
                </line>
              ))}

              {/* Important Rings & Labels (Approach, Stops, DEST, Top 50 Hub, Top 50 FW, Hovered) */}
              {labeledNodes.map((node) => {
                const appLabel = routeContext.approachLabels.get(node.systemId);
                const stopNums = routeContext.stopsBySys.get(node.systemId) ?? [];
                const isFinalDest = routeContext.finalDestSysId === node.systemId;
                const isImportant = !!appLabel || stopNums.length > 0 || isFinalDest;
                const isHovered = node.systemId === hoveredSysId;
                const secColor = getSecColor(node.sec);
                const radius = (isImportant ? 2.6 : 1.5) * invScale;

                return (
                  <g key={node.systemId} transform={`translate(${node.x}, ${node.y})`}>
                    {isImportant && (
                      <circle
                        r={radius + 1.5 * invScale}
                        fill="none"
                        stroke={isFinalDest ? '#34d399' : stopNums.length > 0 ? '#22d3ee' : '#f59e0b'}
                        strokeWidth={0.9 * invScale}
                      />
                    )}
                    {isHovered && (
                      <circle r={radius + 1.5 * invScale} fill={secColor} opacity={0.9} />
                    )}

                    {isFinalDest ? (
                      <text
                        y={-(radius + 3 * invScale)}
                        textAnchor="middle"
                        fontSize={6.5 * invScale}
                        className="fill-emerald-300 font-bold"
                      >
                        DEST
                      </text>
                    ) : stopNums.length > 0 ? (
                      <text
                        y={-(radius + 3 * invScale)}
                        textAnchor="middle"
                        fontSize={6.5 * invScale}
                        className="fill-cyan-300 font-bold"
                      >
                        S{stopNums.join(',')}
                      </text>
                    ) : appLabel ? (
                      <text
                        y={-(radius + 3 * invScale)}
                        textAnchor="middle"
                        fontSize={6.2 * invScale}
                        className="fill-amber-300 font-bold"
                      >
                        {appLabel}
                      </text>
                    ) : null}

                    <text
                      y={radius + 7 * invScale}
                      textAnchor="middle"
                      fontSize={(isImportant || isHovered ? 6.8 : 5.6) * invScale}
                      className="font-semibold"
                    >
                      {isHovered && <tspan fill={secColor}>{node.sec.toFixed(1)} </tspan>}
                      <tspan
                        fill={
                          isImportant || isHovered
                            ? '#f1f5f9'
                            : node.isTopHub
                            ? '#7dd3fc'
                            : '#cbd5e1'
                        }
                        opacity={isImportant || isHovered ? 1 : 0.78}
                      >
                        {node.name}
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      {/* Hover / Selected System Footer */}
      {activeNode && (
        <div className="px-2.5 py-1.5 border-t border-slate-800/80 bg-[#090d16] flex items-center justify-between gap-1 text-[10px] tabular-nums">
          <div className="flex items-center gap-1 min-w-0">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: getSecColor(activeNode.sec) }}
            />
            <span style={{ color: getSecColor(activeNode.sec) }} className="font-bold">
              {activeNode.sec.toFixed(2)}
            </span>
            <span className="font-semibold text-white truncate">{activeNode.name}</span>
          </div>
          {activeNode.isTopHub ? (
            <span className="text-[9px] text-sky-300 shrink-0">Top 20 Hub</span>
          ) : activeNode.isTopFw ? (
            <span className="text-[9px] text-amber-300 shrink-0">Top 20 FW</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
