'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Map as LeafletMap, Marker, Polyline, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoStop, haversineKm, formatETA } from '@/lib/geo';

export interface RealLeafletMapProps {
  tripId: number;
  routeName: string;
  vehiclePlate?: string | null;
  geoStops: GeoStop[];
  currentStopOrder: number;
  liveGps: {
    lat: number;
    lng: number;
    speed?: number | null;
    heading?: number | null;
    timestamp?: string;
  } | null;
  isDriverControl?: boolean;
  onAdvanceStop?: (stopOrder: number) => void;
  userBoardStopOrder?: number | null;
  userAlightStopOrder?: number | null;
  className?: string;
}

export default function RealLeafletMap({
  tripId,
  routeName,
  vehiclePlate,
  geoStops,
  currentStopOrder,
  liveGps,
  isDriverControl = false,
  onAdvanceStop,
  userBoardStopOrder,
  userAlightStopOrder,
  className = '',
}: RealLeafletMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const busMarkerRef = useRef<Marker | null>(null);
  const stopsLayerRef = useRef<LayerGroup | null>(null);
  const polylinesLayerRef = useRef<LayerGroup | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [followingBus, setFollowingBus] = useState(true);

  // Compute effective bus position
  const effectiveBusPos = React.useMemo(() => {
    if (liveGps && typeof liveGps.lat === 'number' && typeof liveGps.lng === 'number') {
      return { lat: liveGps.lat, lng: liveGps.lng };
    }
    const currentGeo = geoStops.find((s) => s.stop_order === currentStopOrder) || geoStops[0];
    if (currentGeo) return currentGeo.coords;
    return { lat: -1.286389, lng: 36.817223 }; // Nairobi default
  }, [liveGps, geoStops, currentStopOrder]);

  // Initialize Leaflet Map instance
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;

    async function initMap() {
      const L = (await import('leaflet')).default;
      if (isCancelled || !mapContainerRef.current) return;

      // Ensure no duplicate map instance
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const initialCenter: [number, number] = [effectiveBusPos.lat, effectiveBusPos.lng];

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 11,
        zoomControl: true,
        attributionControl: true,
      });

      // CartoDB Dark Matter retina tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      stopsLayerRef.current = L.layerGroup().addTo(map);
      polylinesLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
      setMapLoaded(true);

      // Break "following bus" mode if user manually drags/pans map
      map.on('dragstart', () => {
        setFollowingBus(false);
      });
    }

    initMap();

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Route Polylines and Stop Pin Markers
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || geoStops.length === 0) return;
    let isCancelled = false;

    async function updateLayers() {
      const L = (await import('leaflet')).default;
      if (isCancelled || !mapInstanceRef.current) return;

      const map = mapInstanceRef.current;
      const stopsLayer = stopsLayerRef.current;
      const polylinesLayer = polylinesLayerRef.current;

      if (stopsLayer) stopsLayer.clearLayers();
      if (polylinesLayer) polylinesLayer.clearLayers();

      const latlngs: [number, number][] = geoStops.map((s) => [s.coords.lat, s.coords.lng]);

      // 1. Full Corridor Polyline Base (Glow / Shadow)
      if (polylinesLayer && latlngs.length >= 2) {
        // Base glow line
        L.polyline(latlngs, {
          color: '#06b6d4',
          weight: 6,
          opacity: 0.25,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(polylinesLayer);

        // Core cyan transit line
        L.polyline(latlngs, {
          color: '#0891b2',
          weight: 3,
          opacity: 0.85,
          dashArray: '4, 8',
          lineCap: 'round',
        }).addTo(polylinesLayer);

        // Traveled segment up to current stop in emerald
        const traveledStops = geoStops.filter((s) => s.stop_order <= currentStopOrder);
        if (traveledStops.length >= 2) {
          const traveledCoords: [number, number][] = traveledStops.map((s) => [s.coords.lat, s.coords.lng]);
          L.polyline(traveledCoords, {
            color: '#10b981',
            weight: 4,
            opacity: 0.95,
            lineCap: 'round',
          }).addTo(polylinesLayer);
        }
      }

      // 2. Station Pin Markers
      if (stopsLayer) {
        geoStops.forEach((stop) => {
          const isPassed = stop.stop_order < currentStopOrder;
          const isCurrent = stop.stop_order === currentStopOrder;
          const isNext = stop.stop_order === currentStopOrder + 1;
          const isUserBoard = stop.stop_order === userBoardStopOrder;
          const isUserAlight = stop.stop_order === userAlightStopOrder;

          let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
          let ringGlow = '';
          let iconGlyph = `${stop.stop_order}`;

          if (isUserBoard) {
            badgeColor = 'bg-pink-600 text-white border-pink-400 font-bold';
            ringGlow = 'ring-4 ring-pink-500/30';
            iconGlyph = '🚩';
          } else if (isUserAlight) {
            badgeColor = 'bg-amber-600 text-white border-amber-400 font-bold';
            ringGlow = 'ring-4 ring-amber-500/30';
            iconGlyph = '🏁';
          } else if (isCurrent) {
            badgeColor = 'bg-cyan-500 text-white border-cyan-300 font-bold';
            ringGlow = 'ring-4 ring-cyan-500/40 animate-pulse';
          } else if (isPassed) {
            badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-600/80';
            iconGlyph = '✓';
          } else if (isNext) {
            badgeColor = 'bg-sky-700 text-sky-200 border-sky-400 font-semibold';
            ringGlow = 'ring-2 ring-sky-400/40';
          }

          const html = `
            <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer group">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono shadow-lg border transition-transform duration-200 group-hover:scale-125 ${badgeColor} ${ringGlow}">
                ${iconGlyph}
              </div>
              <div class="absolute top-8 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-[10px] font-bold text-slate-200 whitespace-nowrap opacity-90 group-hover:opacity-100 pointer-events-none shadow">
                ${stop.stop_name}
              </div>
            </div>
          `;

          const pinIcon = L.divIcon({
            html,
            className: 'busgo-station-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          const marker = L.marker([stop.coords.lat, stop.coords.lng], { icon: pinIcon });

          // Distance from vehicle
          const distKm = haversineKm(effectiveBusPos, stop.coords);
          const etaStr = formatETA(distKm, liveGps?.speed || 60);

          const popupContent = document.createElement('div');
          popupContent.className = 'p-2 min-w-[200px] text-xs font-sans';
          popupContent.innerHTML = `
            <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
              <span class="font-bold text-white text-sm tracking-tight">${stop.stop_name}</span>
              <span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">Stop #${stop.stop_order}</span>
            </div>
            <div class="space-y-1 text-slate-300">
              <div class="flex justify-between">
                <span class="text-slate-500">Status:</span>
                <span class="font-semibold ${isPassed ? 'text-emerald-400' : isCurrent ? 'text-cyan-400' : 'text-slate-300'}">
                  ${isPassed ? 'Passed' : isCurrent ? 'At Stop' : isNext ? 'Next Stop' : 'Upcoming'}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Distance:</span>
                <span class="font-mono text-white">${distKm.toFixed(1)} km</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Est. Arrival:</span>
                <span class="font-mono text-cyan-400">${isPassed ? 'Departed' : isCurrent ? 'Now' : etaStr}</span>
              </div>
            </div>
          `;

          if (isDriverControl && onAdvanceStop && !isPassed) {
            const btn = document.createElement('button');
            btn.className = 'mt-3 w-full py-1 px-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] transition';
            btn.innerText = `🚌 Mark Bus At ${stop.stop_name}`;
            btn.onclick = () => {
              onAdvanceStop(stop.stop_order);
              marker.closePopup();
            };
            popupContent.appendChild(btn);
          }

          marker.bindPopup(popupContent);
          stopsLayer.addLayer(marker);
        });
      }
    }

    updateLayers();

    return () => {
      isCancelled = true;
    };
  }, [mapLoaded, geoStops, currentStopOrder, effectiveBusPos, liveGps, userBoardStopOrder, userAlightStopOrder, isDriverControl, onAdvanceStop]);

  // Update or Create Live Vehicle Marker with Heading and Radar Pulse
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    let isCancelled = false;

    async function updateBusMarker() {
      const L = (await import('leaflet')).default;
      if (isCancelled || !mapInstanceRef.current) return;

      const map = mapInstanceRef.current;
      const heading = liveGps?.heading ?? 0;
      const speed = liveGps?.speed ?? 0;
      const speedText = speed > 0 ? `${Math.round(speed)} km/h` : '0 km/h';

      const busHtml = `
        <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer group">
          <!-- Radar pulse wave -->
          <div class="absolute w-12 h-12 rounded-full bg-cyan-500/30 border border-cyan-400/50 leaflet-radar-pulse pointer-events-none"></div>

          <!-- Rotating Vehicle Shield -->
          <div style="transform: rotate(${heading}deg);" class="relative w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-600 to-indigo-600 border-2 border-white shadow-2xl flex items-center justify-center text-white text-base transition-transform duration-300">
            🚐
          </div>

          <!-- Speedometer Badge -->
          <div class="absolute -bottom-5 px-2 py-0.5 rounded-full bg-slate-950/95 border border-cyan-500/40 text-[9px] font-mono font-black text-cyan-300 whitespace-nowrap shadow-lg">
            ⚡ ${speedText}
          </div>
        </div>
      `;

      const busIcon = L.divIcon({
        html: busHtml,
        className: 'busgo-live-vehicle',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (!busMarkerRef.current) {
        const marker = L.marker([effectiveBusPos.lat, effectiveBusPos.lng], {
          icon: busIcon,
          zIndexOffset: 1000,
        }).addTo(map);

        const busPopup = `
          <div class="p-2 min-w-[190px] text-xs font-sans">
            <div class="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
              <span class="font-bold text-white text-sm">🚐 ${vehiclePlate ?? 'PSV Express'}</span>
              <span class="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono text-[10px]">LIVE GPS</span>
            </div>
            <div class="space-y-1 text-slate-300 text-xs">
              <div class="flex justify-between"><span class="text-slate-500">Route:</span><span class="text-white">${routeName}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Speed:</span><span class="font-mono text-cyan-400 font-bold">${speedText}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Heading:</span><span class="font-mono text-slate-200">${Math.round(heading)}°</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Telemetry:</span><span class="text-slate-400">${liveGps?.timestamp ? new Date(liveGps.timestamp).toLocaleTimeString() : 'Realtime'}</span></div>
            </div>
          </div>
        `;
        marker.bindPopup(busPopup);
        busMarkerRef.current = marker;
      } else {
        busMarkerRef.current.setLatLng([effectiveBusPos.lat, effectiveBusPos.lng]);
        busMarkerRef.current.setIcon(busIcon);
      }

      // Auto-follow vehicle if enabled
      if (followingBus) {
        map.panTo([effectiveBusPos.lat, effectiveBusPos.lng], { animate: true, duration: 0.8 });
      }
    }

    updateBusMarker();

    return () => {
      isCancelled = true;
    };
  }, [mapLoaded, effectiveBusPos, liveGps, followingBus, vehiclePlate, routeName]);

  // Recenter on bus handler
  const handleRecenter = useCallback(() => {
    if (!mapInstanceRef.current) return;
    setFollowingBus(true);
    mapInstanceRef.current.flyTo([effectiveBusPos.lat, effectiveBusPos.lng], 13, {
      animate: true,
      duration: 1.0,
    });
  }, [effectiveBusPos]);

  // Fit entire route bounds handler
  const handleFitRoute = useCallback(async () => {
    if (!mapInstanceRef.current || geoStops.length === 0) return;
    const L = (await import('leaflet')).default;
    setFollowingBus(false);
    const bounds = L.latLngBounds(geoStops.map((s) => [s.coords.lat, s.coords.lng]));
    mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], animate: true });
  }, [geoStops]);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden border border-slate-800 bg-[#090c15] shadow-2xl ${className}`}>
      {/* Map canvas */}
      <div ref={mapContainerRef} className="w-full h-[420px] z-0" />

      {/* Floating Action Controls */}
      <div className="absolute bottom-4 right-4 z-[400] flex flex-col gap-2">
        <button
          onClick={handleRecenter}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold shadow-xl transition backdrop-blur-md cursor-pointer ${
            followingBus
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 ring-2 ring-cyan-500/30'
              : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:bg-slate-800'
          }`}
          title="Center map on live vehicle position"
        >
          <span>🎯</span>
          <span>{followingBus ? 'Lock on Bus' : 'Track Bus'}</span>
        </button>

        <button
          onClick={handleFitRoute}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-bold shadow-xl transition backdrop-blur-md cursor-pointer"
          title="Zoom out to show entire route corridor"
        >
          <span>🗺️</span>
          <span>Fit Corridor</span>
        </button>
      </div>

      {/* Corridor Header Overlay */}
      <div className="absolute top-3 left-3 z-[400] pointer-events-none">
        <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-xl px-3 py-1.5 shadow-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold text-white">{routeName}</span>
          <span className="text-[10px] text-slate-400 font-mono">({geoStops.length} Stages)</span>
        </div>
      </div>
    </div>
  );
}

