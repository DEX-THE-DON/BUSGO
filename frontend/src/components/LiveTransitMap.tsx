'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  GeoStop,
  resolveRouteGeoStops,
  haversineKm,
  formatETA,
} from '@/lib/geo';
import { wsBaseUrl, fetchTripStops, TripStop } from '@/services/api';
import { IconRoute } from '@/components/dashboard/FluxIcons';

const RealLeafletMap = dynamic(() => import('@/components/RealLeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[380px] rounded-2xl border border-slate-800 bg-[#090c15] flex flex-col items-center justify-center p-8 text-center shadow-xl">
      <div className="w-8 h-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin mb-3" />
      <p className="text-xs font-bold text-slate-300">Loading Kenyan Highway GIS Tiles...</p>
      <p className="text-[10px] text-slate-500 mt-1">OpenStreetMap & CartoDB Dark Matter</p>
    </div>
  ),
});

export interface LiveTransitMapProps {
  tripId: number;
  routeName: string;
  vehiclePlate?: string | null;
  stops?: { id?: number; stop_name: string; stop_order: number }[];
  currentStopOrder?: number | null;
  userBoardStopOrder?: number | null;
  userAlightStopOrder?: number | null;
  initialLat?: number | null;
  initialLng?: number | null;
  initialSpeed?: number | null;
  initialHeading?: number | null;
  tripStatus?: string;
  isDriverControl?: boolean;
  onAdvanceStop?: (stopOrder: number) => void;
  className?: string;
}

export default function LiveTransitMap({
  tripId,
  routeName,
  vehiclePlate,
  stops: initialStops = [],
  currentStopOrder: initialCurrentStopOrder = 1,
  initialLat,
  initialLng,
  initialSpeed,
  initialHeading,
  userBoardStopOrder,
  userAlightStopOrder,
  tripStatus = 'in_progress',
  isDriverControl = false,
  onAdvanceStop,
  className = '',
}: LiveTransitMapProps) {
  const [fetchedStops, setFetchedStops] = useState<TripStop[]>([]);
  const [overrideStopOrder, setOverrideStopOrder] = useState<number | null>(null);
  const [status, setStatus] = useState<string>(tripStatus);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeNotification, setActiveNotification] = useState<string | null>(null);
  const [selectedStop, setSelectedStop] = useState<GeoStop | null>(null);
  const [viewMode, setViewMode] = useState<'osm' | 'radar'>('osm');
  const [liveGps, setLiveGps] = useState<{
    lat: number;
    lng: number;
    speed?: number | null;
    heading?: number | null;
    timestamp?: string;
  } | null>(() => {
    if (initialLat != null && initialLng != null) {
      return { lat: initialLat, lng: initialLng, speed: initialSpeed, heading: initialHeading };
    }
    return null;
  });

  useEffect(() => {
    if (initialLat != null && initialLng != null) {
      setLiveGps((prev) => ({
        lat: initialLat,
        lng: initialLng,
        speed: initialSpeed ?? prev?.speed ?? null,
        heading: initialHeading ?? prev?.heading ?? null,
        timestamp: prev?.timestamp,
      }));
    }
  }, [initialLat, initialLng, initialSpeed, initialHeading]);

  // Derived current stop
  const currentStop = overrideStopOrder ?? initialCurrentStopOrder ?? 1;

  // Derived stops list
  const stopsList: TripStop[] = useMemo(() => {
    if (initialStops && initialStops.length > 0) {
      return initialStops.map((s, idx) => ({
        id: s.id ?? idx + 1,
        stop_name: s.stop_name,
        stop_order: s.stop_order,
      }));
    }
    return fetchedStops;
  }, [initialStops, fetchedStops]);

  // Fetch stops asynchronously if not provided
  useEffect(() => {
    if (initialStops.length === 0 && tripId) {
      let isSubscribed = true;
      fetchTripStops(tripId)
        .then((res) => {
          if (isSubscribed && res.stops && res.stops.length > 0) {
            setFetchedStops(res.stops);
          }
        })
        .catch(() => {});

      return () => {
        isSubscribed = false;
      };
    }
  }, [tripId, initialStops.length]);

  // Connect to live WebSocket for real-time stop announcements & GPS telemetry
  useEffect(() => {
    if (!tripId) return;
    let ws: WebSocket | null = null;
    let isCancelled = false;

    try {
      ws = new WebSocket(`${wsBaseUrl()}/ws/trip/${tripId}`);

      ws.onopen = () => {
        if (!isCancelled) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'trip_at_stop' && data.trip_id === tripId) {
            setOverrideStopOrder(data.stop_order);
            const stopName = stopsList.find((s) => s.stop_order === data.stop_order)?.stop_name;
            setActiveNotification(`Bus arrived at ${stopName ?? `Stop #${data.stop_order}`}`);
            setTimeout(() => setActiveNotification(null), 5000);
          }
          if (data.event === 'trip_status' && data.trip_id === tripId) {
            setStatus(data.status);
          }
          if (data.event === 'trip_gps' && data.trip_id === tripId) {
            setLiveGps({
              lat: data.lat,
              lng: data.lng,
              speed: data.speed,
              heading: data.heading,
              timestamp: data.timestamp,
            });
          }
        } catch {
          /* ignore non-json frames */
        }
      };

      ws.onclose = () => {
        if (!isCancelled) setWsConnected(false);
      };
      ws.onerror = () => {
        if (!isCancelled) setWsConnected(false);
      };
    } catch {
      // Ignored
    }

    return () => {
      isCancelled = true;
      if (ws) ws.close();
    };
  }, [tripId, stopsList]);

  // Resolve coordinates
  const geoStops: GeoStop[] = useMemo(() => {
    return resolveRouteGeoStops(stopsList);
  }, [stopsList]);

  // ViewBox coordinate projection (SVG: 800 x 340)
  const SVG_WIDTH = 800;
  const SVG_HEIGHT = 340;
  const PADDING_X = 80;
  const PADDING_Y = 50;

  const { minLat, maxLat, minLng, maxLng } = useMemo(() => {
    if (geoStops.length === 0) {
      return { minLat: -1.5, maxLat: 0.5, minLng: 34.5, maxLng: 37.5 };
    }
    const lats = geoStops.map((s) => s.coords.lat);
    const lngs = geoStops.map((s) => s.coords.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  }, [geoStops]);

  const project = useCallback(
    (lat: number, lng: number): { x: number; y: number } => {
      const latSpan = maxLat - minLat || 0.1;
      const lngSpan = maxLng - minLng || 0.1;

      // X: lng increases eastward (left to right)
      const x = PADDING_X + ((lng - minLng) / lngSpan) * (SVG_WIDTH - 2 * PADDING_X);
      // Y: lat increases northward (top to bottom inverted for SVG)
      const y = SVG_HEIGHT - (PADDING_Y + ((lat - minLat) / latSpan) * (SVG_HEIGHT - 2 * PADDING_Y));

      return {
        x: Math.max(PADDING_X, Math.min(SVG_WIDTH - PADDING_X, x)),
        y: Math.max(PADDING_Y, Math.min(SVG_HEIGHT - PADDING_Y, y)),
      };
    },
    [maxLat, maxLng, minLat, minLng]
  );

  // Projected stop nodes
  const projectedStops = useMemo(() => {
    return geoStops.map((stop) => {
      const pt = project(stop.coords.lat, stop.coords.lng);
      return {
        ...stop,
        x: pt.x,
        y: pt.y,
      };
    });
  }, [geoStops, project]);

  // Current bus coordinates & projection
  const currentStopIndex = useMemo(() => {
    const idx = geoStops.findIndex((s) => s.stop_order === currentStop);
    return idx === -1 ? 0 : idx;
  }, [geoStops, currentStop]);

  const busProjected = useMemo(() => {
    if (liveGps && typeof liveGps.lat === 'number' && typeof liveGps.lng === 'number') {
      return project(liveGps.lat, liveGps.lng);
    }
    if (projectedStops.length === 0) {
      return { x: SVG_WIDTH / 2, y: SVG_HEIGHT / 2 };
    }
    if (currentStopIndex >= projectedStops.length - 1) {
      const last = projectedStops[projectedStops.length - 1];
      return { x: last.x, y: last.y };
    }

    const cur = projectedStops[currentStopIndex];
    const next = projectedStops[currentStopIndex + 1];
    // Place bus 35% between current stop and next stop
    return {
      x: cur.x + 0.35 * (next.x - cur.x),
      y: cur.y + 0.35 * (next.y - cur.y),
    };
  }, [liveGps, project, projectedStops, currentStopIndex]);

  // Next stop calculation
  const nextStop = useMemo(() => {
    if (currentStopIndex < geoStops.length - 1) {
      return geoStops[currentStopIndex + 1];
    }
    return null;
  }, [geoStops, currentStopIndex]);

  // Next stop ETA and distance
  const nextStopMetrics = useMemo(() => {
    if (!nextStop || geoStops.length === 0) return null;
    const curCoords = geoStops[currentStopIndex]?.coords;
    if (!curCoords) return null;
    const distance = haversineKm(curCoords, nextStop.coords);
    const eta = formatETA(distance);
    return { distance: distance.toFixed(1), eta };
  }, [currentStopIndex, geoStops, nextStop]);

  // Destination stop ETA and total distance
  const destMetrics = useMemo(() => {
    if (geoStops.length <= 1) return null;
    const curCoords = geoStops[currentStopIndex]?.coords;
    const destCoords = geoStops[geoStops.length - 1]?.coords;
    if (!curCoords || !destCoords) return null;
    const distance = haversineKm(curCoords, destCoords);
    const eta = formatETA(distance);
    return { distance: distance.toFixed(1), eta };
  }, [currentStopIndex, geoStops]);

  // Polyline points string
  const polylinePoints = useMemo(() => {
    return projectedStops.map((p) => `${p.x},${p.y}`).join(' ');
  }, [projectedStops]);

  // Completed path slice
  const completedPolylinePoints = useMemo(() => {
    const passed = projectedStops.slice(0, currentStopIndex + 1);
    if (passed.length === 0) return '';
    const pts = passed.map((p) => `${p.x},${p.y}`);
    if (currentStopIndex < projectedStops.length - 1) {
      pts.push(`${busProjected.x},${busProjected.y}`);
    }
    return pts.join(' ');
  }, [projectedStops, currentStopIndex, busProjected]);

  // Route progress percentage
  const progressPercent = useMemo(() => {
    if (geoStops.length <= 1) return 100;
    return Math.round((currentStopIndex / (geoStops.length - 1)) * 100);
  }, [currentStopIndex, geoStops.length]);

  // Manual / Simulation Advancement
  const advanceBus = (targetOrder: number) => {
    setOverrideStopOrder(targetOrder);
    if (onAdvanceStop) {
      onAdvanceStop(targetOrder);
    }
    const name = stopsList.find((s) => s.stop_order === targetOrder)?.stop_name;
    setActiveNotification(`Bus advanced to ${name ?? `Stop #${targetOrder}`}`);
    setTimeout(() => setActiveNotification(null), 4000);
  };

  const handleSimulateNext = () => {
    if (currentStopIndex < geoStops.length - 1) {
      advanceBus(geoStops[currentStopIndex + 1].stop_order);
    } else {
      // Loop back to start
      advanceBus(geoStops[0].stop_order);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl ${className}`}
    >
      {/* Top Transit HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
            <IconRoute className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black tracking-wide text-white uppercase">{routeName}</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  wsConnected
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                {wsConnected ? (liveGps ? 'GPS Telemetry Active' : 'Live Satellite') : 'Tracking Synced'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>Trip #{tripId}</span>
              <span>·</span>
              <span>Plate: <span className="font-mono text-cyan-300 font-bold">{vehiclePlate || 'Fleet Unit'}</span></span>
              {liveGps?.speed != null && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-400 font-black">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    ⚡ {Math.round(liveGps.speed)} km/h
                  </span>
                </>
              )}
              {liveGps?.heading != null && (
                <>
                  <span>·</span>
                  <span className="font-mono text-sky-400 text-[11px]">
                    🧭 {Math.round(liveGps.heading)}°
                  </span>
                </>
              )}
              <span>·</span>
              <span>Status: <span className="capitalize font-semibold text-slate-200">{status.replace('_', ' ')}</span></span>
            </div>
          </div>
        </div>

        {/* ETA & Next Stop Quick Badge */}
        <div className="flex items-center gap-3">
          {nextStop ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-1.5 text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Next Destination</div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-emerald-400">{nextStop.stop_name}</span>
                {nextStopMetrics && (
                  <span className="text-[11px] font-bold text-slate-300">
                    · ~{nextStopMetrics.eta} ({nextStopMetrics.distance} km)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-right">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Final Destination</div>
              <span className="text-xs font-bold text-white">Trip Finished / At Terminus</span>
            </div>
          )}

          {/* Dual Map Mode Switcher */}
          <div className="flex items-center rounded-xl bg-slate-950/80 p-1 border border-slate-800 shadow-inner">
            <button
              type="button"
              onClick={() => setViewMode('osm')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'osm'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🗺️ Highway Map</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('radar')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'radar'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>⚡ Neon Radar</span>
            </button>
          </div>

          {/* Test / Simulation Trigger */}
          <button
            onClick={handleSimulateNext}
            title="Simulate vehicle moving to the next stop along the highway corridor"
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 transition"
          >
            <span>⏩ Advance</span>
          </button>
        </div>
      </div>

      {/* Real-time Notification Banner */}
      {activeNotification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full border border-emerald-500/40 bg-slate-950/95 px-4 py-1.5 text-xs font-bold text-emerald-300 shadow-xl backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span>{activeNotification}</span>
        </div>
      )}

      {/* Map Presentation Layer */}
      {viewMode === 'osm' ? (
        <RealLeafletMap
          tripId={tripId}
          routeName={routeName}
          vehiclePlate={vehiclePlate}
          geoStops={geoStops}
          currentStopOrder={currentStop}
          liveGps={liveGps}
          isDriverControl={isDriverControl}
          onAdvanceStop={advanceBus}
          userBoardStopOrder={userBoardStopOrder}
          userAlightStopOrder={userAlightStopOrder}
        />
      ) : (
        /* Main Interactive Vector Map Canvas */
        <div className="relative h-[340px] w-full bg-[#070b14] select-none">
        {/* Subtle GIS Background Grid */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #38bdf8 1px, transparent 1px), linear-gradient(to bottom, #38bdf8 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Ambient Glow behind the bus route */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[200px] bg-cyan-600/10 blur-[100px] pointer-events-none rounded-full" />

        {/* SVG Route Corridor Layer */}
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-full w-full overflow-visible"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Highway Route Gradients */}
            <linearGradient id="route-base-glow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.4" />
            </linearGradient>

            <linearGradient id="route-completed" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#059669" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>

            {/* Filter for route neon aura */}
            <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Base Inactive Route Polyline */}
          {polylinePoints && (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#1e293b"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Route Aura / Glowing Path */}
          {polylinePoints && (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="url(#route-base-glow)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 6"
              className="animate-pulse"
            />
          )}

          {/* Completed / Traveled Route Segment */}
          {completedPolylinePoints && (
            <polyline
              points={completedPolylinePoints}
              fill="none"
              stroke="url(#route-completed)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#neon-glow)"
            />
          )}

          {/* Stop Nodes */}
          {projectedStops.map((stop) => {
            const isPassed = stop.stop_order < currentStop;
            const isCurrent = stop.stop_order === currentStop;
            const isBoarding = userBoardStopOrder === stop.stop_order;
            const isAlighting = userAlightStopOrder === stop.stop_order;

            return (
              <g
                key={stop.stop_order}
                className="cursor-pointer transition-transform hover:scale-110"
                onClick={() => {
                  setSelectedStop(stop);
                  if (isDriverControl && onAdvanceStop && stop.stop_order !== currentStop) {
                    advanceBus(stop.stop_order);
                  }
                }}
              >
                {/* Node Ring Halo */}
                {isCurrent && (
                  <circle
                    cx={stop.x}
                    cy={stop.y}
                    r="18"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="1.5"
                    strokeOpacity="0.8"
                    className="animate-ping"
                  />
                )}

                {/* Node Base Circle */}
                <circle
                  cx={stop.x}
                  cy={stop.y}
                  r={isCurrent ? '10' : '7'}
                  fill={
                    isCurrent
                      ? '#10b981'
                      : isPassed
                      ? '#065f46'
                      : isBoarding
                      ? '#3b82f6'
                      : isAlighting
                      ? '#a855f7'
                      : '#1e293b'
                  }
                  stroke={isCurrent ? '#ffffff' : '#334155'}
                  strokeWidth={isCurrent ? '3' : '2'}
                  filter={isCurrent ? 'url(#neon-glow)' : undefined}
                />

                {/* Inner Dot for completed */}
                {isPassed && (
                  <circle cx={stop.x} cy={stop.y} r="2.5" fill="#34d399" />
                )}

                {/* Stop Label Text */}
                <text
                  x={stop.x}
                  y={stop.y - 14}
                  textAnchor="middle"
                  className={`text-[11px] font-black tracking-wider uppercase select-none ${
                    isCurrent
                      ? 'fill-emerald-400 font-extrabold'
                      : isBoarding
                      ? 'fill-sky-400'
                      : isAlighting
                      ? 'fill-purple-400'
                      : isPassed
                      ? 'fill-slate-400'
                      : 'fill-slate-300'
                  }`}
                  style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}
                >
                  {stop.stop_name}
                </text>

                {/* Special Tag for User Boarding / Alighting */}
                {isBoarding && (
                  <g transform={`translate(${stop.x - 36}, ${stop.y + 12})`}>
                    <rect
                      width="72"
                      height="16"
                      rx="8"
                      fill="#1e3a8a"
                      stroke="#60a5fa"
                      strokeWidth="1"
                    />
                    <text
                      x="36"
                      y="11"
                      textAnchor="middle"
                      className="fill-blue-200 text-[8px] font-black uppercase tracking-wider"
                    >
                      Your Pickup
                    </text>
                  </g>
                )}

                {isAlighting && (
                  <g transform={`translate(${stop.x - 42}, ${stop.y + 12})`}>
                    <rect
                      width="84"
                      height="16"
                      rx="8"
                      fill="#581c87"
                      stroke="#c084fc"
                      strokeWidth="1"
                    />
                    <text
                      x="42"
                      y="11"
                      textAnchor="middle"
                      className="fill-purple-200 text-[8px] font-black uppercase tracking-wider"
                    >
                      Your Dropoff
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Animated Bus Marker on Corridor */}
          <g
            transform={`translate(${busProjected.x}, ${busProjected.y})`}
            className="transition-all duration-700 ease-out"
          >
            {/* Pulsing Radar Wave 1 */}
            <circle
              cx="0"
              cy="0"
              r="24"
              fill="#0284c7"
              fillOpacity="0.25"
              className="animate-ping"
            />
            {/* Concentric Radar Ring 2 */}
            <circle
              cx="0"
              cy="0"
              r="34"
              fill="none"
              stroke="#00f3ff"
              strokeWidth="1"
              strokeDasharray="4 3"
              strokeOpacity="0.5"
              className="animate-spin"
              style={{ animationDuration: '9s' }}
            />

            {/* Heading Orientation Indicator Arrow */}
            {liveGps?.heading != null && (
              <g transform={`rotate(${liveGps.heading})`}>
                <polygon
                  points="0,-24 -5,-17 5,-17"
                  fill="#00f3ff"
                  filter="url(#neon-glow)"
                />
              </g>
            )}

            {/* Bus Marker Disc */}
            <circle
              cx="0"
              cy="0"
              r="16"
              fill="#0f172a"
              stroke="#38bdf8"
              strokeWidth="2.5"
              filter="url(#neon-glow)"
            />

            {/* Bus Silhouette / Icon inside disc */}
            <g transform="translate(-8, -8) scale(0.67)">
              <path
                d="M4 16C4 16.6 4.4 17 5 17H6C6.6 17 7 16.6 7 16V15H17V16C17 16.6 17.4 17 18 17H19C19.6 17 20 16.6 20 16V6C20 3.8 18.2 2 16 2H8C5.8 2 4 3.8 4 6V16ZM6.5 13C5.7 13 5 12.3 5 11.5C5 10.7 5.7 10 6.5 10C7.3 10 8 10.7 8 11.5C8 12.3 7.3 13 6.5 13ZM17.5 13C16.7 13 16 12.3 16 11.5C16 10.7 16.7 10 17.5 10C18.3 10 19 10.7 19 11.5C19 12.3 18.3 13 17.5 13ZM6 5H18V9H6V5Z"
                fill="#38bdf8"
              />
            </g>

            {/* Floating Vehicle Plate & Speed Badge */}
            <g transform="translate(0, 22)">
              <rect
                x="-42"
                y="0"
                width="84"
                height={liveGps?.speed != null ? 28 : 16}
                rx="6"
                fill="#090d16"
                stroke="#38bdf8"
                strokeWidth="1"
              />
              <text
                x="0"
                y="11"
                textAnchor="middle"
                className="fill-sky-300 font-mono text-[9px] font-black tracking-wide"
              >
                {vehiclePlate || 'BUSGO-45'}
              </text>
              {liveGps?.speed != null && (
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  className="fill-emerald-400 font-mono text-[8px] font-black"
                >
                  ⚡ {Math.round(liveGps.speed)} km/h
                </text>
              )}
            </g>
          </g>
        </svg>

        {/* Selected Stop Details Popup Modal */}
        {selectedStop && (
          <div className="absolute bottom-4 left-4 z-20 max-w-xs rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Stop #{selectedStop.stop_order}
              </span>
              <button
                onClick={() => setSelectedStop(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="text-sm font-black text-white mt-1">{selectedStop.stop_name}</div>
            <div className="text-xs text-slate-300 mt-1">
              Coordinates: {selectedStop.coords.lat.toFixed(4)}°, {selectedStop.coords.lng.toFixed(4)}°
            </div>
            {isDriverControl && selectedStop.stop_order !== currentStop && (
              <button
                onClick={() => {
                  advanceBus(selectedStop.stop_order);
                  setSelectedStop(null);
                }}
                className="mt-2.5 w-full rounded-lg bg-emerald-500 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shadow"
              >
                Mark Bus Arrived Here
              </button>
            )}
          </div>
        )}

        {/* Coordinates Legend in bottom right */}
        <div className="absolute bottom-3 right-3 hidden sm:flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1 text-[10px] font-mono text-slate-400 backdrop-blur">
          <span>Lat {minLat.toFixed(2)}° to {maxLat.toFixed(2)}°</span>
          <span>·</span>
          <span>Lng {minLng.toFixed(2)}° to {maxLng.toFixed(2)}°</span>
        </div>
      </div>
      )}

      {/* Transit Route Ribbon & Stop Timeline */}
      <div className="border-t border-slate-800/80 bg-slate-950 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Highway Stop Progress:</span>
            <span className="text-xs font-black text-white">
              {currentStopIndex + 1} of {geoStops.length} ({progressPercent}%)
            </span>
          </div>
          {destMetrics && (
            <span className="text-xs font-medium text-slate-400">
              Terminus ETA: <span className="text-cyan-400 font-bold">{destMetrics.eta}</span> ({destMetrics.distance} km remaining)
            </span>
          )}
        </div>

        {/* Linear Progress Bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800 mb-4">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Horizontal Stopwise Node Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {geoStops.map((s, idx) => {
            const isPassed = s.stop_order < currentStop;
            const isCurrent = s.stop_order === currentStop;
            const isUpcoming = s.stop_order > currentStop;
            const isUserBoard = userBoardStopOrder === s.stop_order;
            const isUserAlight = userAlightStopOrder === s.stop_order;

            return (
              <button
                key={s.stop_order}
                onClick={() => {
                  if (isDriverControl && onAdvanceStop && s.stop_order !== currentStop) {
                    advanceBus(s.stop_order);
                  } else {
                    setSelectedStop(s);
                  }
                }}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                  isCurrent
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 shadow-md ring-1 ring-emerald-500/50'
                    : isPassed
                    ? 'border-slate-800 bg-slate-900/80 text-slate-400'
                    : isUpcoming
                    ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    : 'border-slate-800 text-slate-400'
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ${
                    isCurrent
                      ? 'bg-emerald-400 text-slate-950'
                      : isPassed
                      ? 'bg-slate-700 text-slate-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isPassed ? '✓' : idx + 1}
                </span>

                <span>{s.stop_name}</span>

                {isCurrent && (
                  <span className="rounded bg-emerald-400/20 px-1 py-0.2 text-[9px] uppercase tracking-wider text-emerald-300">
                    At Stop
                  </span>
                )}
                {isUserBoard && (
                  <span className="rounded bg-blue-500/20 px-1 py-0.2 text-[9px] uppercase tracking-wider text-blue-300">
                    Boarding
                  </span>
                )}
                {isUserAlight && (
                  <span className="rounded bg-purple-500/20 px-1 py-0.2 text-[9px] uppercase tracking-wider text-purple-300">
                    Alighting
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
