import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Flame,
  Globe,
  Search,
  Skull,
  Swords,
  Zap,
} from 'lucide-react';
import type {
  FwStationInfo,
  StationOption,
  TopStationInfo,
  UniverseStationsData,
} from '../types';
import { formatISK, formatInt } from '../utils/arbitrage';

export const ALL_HUBS_OPTION: StationOption = {
  stationId: -1,
  stationName: 'All Stations (Auto-Find Best)',
  systemId: -1,
  systemName: 'All Stations',
  regionId: -1,
  regionName: 'High/Low-Sec Scan',
  security: 1.0,
  hubKey: 'all',
};

interface StationSelectorProps {
  label: string;
  selected: StationOption | null;
  topStations: TopStationInfo[];
  fwStations: FwStationInfo[];
  universe: UniverseStationsData | null;
  allowAllHubs?: boolean;
  align?: 'left' | 'right';
  onSelect: (station: StationOption) => void;
}

function getSecColor(sec: number): string {
  if (sec >= 0.5) return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
  if (sec > 0.0) return 'text-amber-400 bg-amber-500/15 border-amber-500/30';
  return 'text-rose-400 bg-rose-500/15 border-rose-500/30';
}

export function StationSelector({
  label,
  selected,
  topStations,
  fwStations,
  universe,
  allowAllHubs = false,
  align = 'left',
  onSelect,
}: StationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery('');
    }
  }, [open]);

  const hubMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of topStations) {
      if (s.hubKey) map.set(s.stationId, s.hubKey);
    }
    return map;
  }, [topStations]);

  const searchResults = useMemo<StationOption[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || !universe) return [];

    const matches: StationOption[] = [];
    for (const [stationId, stationName, systemId] of universe.stations) {
      const sys = universe.systems[String(systemId)];
      if (!sys) continue;
      const [systemName, regionId, security] = sys;
      const regionName = universe.regions[String(regionId)] || '';

      if (
        stationName.toLowerCase().includes(q) ||
        systemName.toLowerCase().includes(q) ||
        regionName.toLowerCase().includes(q)
      ) {
        matches.push({
          stationId,
          stationName,
          systemId,
          systemName,
          regionId,
          regionName,
          security,
          hubKey: hubMap.get(stationId) ?? null,
        });
        if (matches.length >= 40) break;
      }
    }
    return matches;
  }, [query, universe, hubMap]);

  const handlePick = (station: StationOption) => {
    onSelect(station);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>

      {/* Compact Single-Row Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 bg-[#090d16] border border-slate-700/80 hover:border-cyan-500/60 rounded-lg px-2.5 py-2 text-left transition cursor-pointer"
      >
        {selected ? (
          selected.stationId === -1 ? (
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-cyan-300 bg-cyan-500/15 border-cyan-500/30 shrink-0">
                ALL
              </span>
              <span className="text-xs sm:text-sm font-medium text-cyan-200 truncate">
                {selected.stationName}
              </span>
            </div>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums shrink-0 ${getSecColor(
                  selected.security
                )}`}
              >
                {selected.security.toFixed(1)}
              </span>
              <span className="text-xs sm:text-sm font-medium text-white truncate">
                {selected.stationName}
              </span>
              <span className="text-[11px] text-slate-500 truncate hidden sm:inline shrink-0">
                ({selected.regionName})
              </span>
            </div>
          )
        ) : (
          <span className="text-xs text-slate-400">Select station...</span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Multi-Column Popover */}
      {open && (
        <div
          className={`absolute top-full mt-1.5 z-50 w-[min(94vw,680px)] rounded-xl bg-[#0d1424] border border-slate-700 shadow-2xl overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* Top Search + All Hubs Bar */}
          <div className="p-2.5 border-b border-slate-800 bg-[#090d16] flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search any NPC station, system (e.g. Onnamon), or region..."
                className="w-full bg-[#0e1526] border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            {allowAllHubs && (
              <button
                type="button"
                onClick={() => handlePick(ALL_HUBS_OPTION)}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer shrink-0 ${
                  selected?.stationId === -1
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                    : 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>All Stations</span>
              </button>
            )}
          </div>

          {/* Search Mode vs Multi-Column Mode */}
          {query.trim() ? (
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/50">
              {searchResults.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No NPC stations found for "{query}".
                </div>
              ) : (
                searchResults.map((st) => (
                  <button
                    key={st.stationId}
                    type="button"
                    onClick={() => handlePick(st)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/70 transition cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums shrink-0 ${getSecColor(
                          st.security
                        )}`}
                      >
                        {st.security.toFixed(1)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {st.stationName}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {st.systemName} • {st.regionName}
                        </div>
                      </div>
                    </div>
                    {st.hubKey && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        <Zap className="w-2.5 h-2.5" />
                        Instant
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800">
              {/* Column 1: Top 10 High-Volume Stations */}
              <div className="flex flex-col">
                <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 shrink-0" />
                  <span>Top 10 High-Volume Hubs</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/50">
                  {topStations.map((st, idx) => (
                    <button
                      key={st.stationId}
                      type="button"
                      onClick={() => handlePick(st)}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-800/70 transition flex items-start justify-between gap-2 cursor-pointer ${
                        selected?.stationId === st.stationId ? 'bg-cyan-500/10' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500 w-4 shrink-0">
                            #{idx + 1}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1 py-0.5 rounded border tabular-nums shrink-0 ${getSecColor(
                              st.security
                            )}`}
                          >
                            {st.security.toFixed(1)}
                          </span>
                          <span className="text-xs font-medium text-white truncate">
                            {st.stationName}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 pl-5 mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span>{st.regionName}</span>
                          <span>•</span>
                          <span className="text-cyan-400/90 tabular-nums">
                            {formatInt(st.orderCount)} ord
                          </span>
                          {st.buyIskValue > 0 && (
                            <span className="text-emerald-400/90 tabular-nums">
                              ({formatISK(st.buyIskValue, true)})
                            </span>
                          )}
                        </div>
                      </div>
                      {st.hubKey && (
                        <Zap className="w-3 h-3 text-cyan-400 shrink-0 mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 2: Top 10 Faction Warfare & Reship Stations */}
              <div className="flex flex-col">
                <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-[11px] font-semibold text-rose-300 flex items-center gap-1.5">
                  <Swords className="w-3.5 h-3.5 shrink-0" />
                  <span>Top 10 Faction Warfare & Reship</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/50">
                  {fwStations.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      Loading live FW warzone activity...
                    </div>
                  ) : (
                    fwStations.map((st, idx) => (
                      <button
                        key={st.stationId}
                        type="button"
                        onClick={() => handlePick(st)}
                        className={`w-full text-left px-3 py-2 hover:bg-slate-800/70 transition cursor-pointer ${
                          selected?.stationId === st.stationId ? 'bg-cyan-500/10' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500 w-4 shrink-0">
                            #{idx + 1}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1 py-0.5 rounded border tabular-nums shrink-0 ${getSecColor(
                              st.security
                            )}`}
                          >
                            {st.security.toFixed(1)}
                          </span>
                          <span className="text-xs font-medium text-white truncate">
                            {st.stationName}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 pl-5 mt-0.5 flex flex-wrap items-center gap-2">
                          <span>{st.regionName}</span>
                          <span className="inline-flex items-center gap-0.5 text-sky-400 tabular-nums">
                            <Activity className="w-2.5 h-2.5" />
                            {formatInt(st.jumps)}j/h
                          </span>
                          <span className="inline-flex items-center gap-0.5 text-rose-400 tabular-nums">
                            <Skull className="w-2.5 h-2.5" />
                            {formatInt(st.shipKills)}k/h
                          </span>
                          {st.contested && st.contested !== 'uncontested' && (
                            <span className="text-[9px] px-1 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 uppercase">
                              {st.contested}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
