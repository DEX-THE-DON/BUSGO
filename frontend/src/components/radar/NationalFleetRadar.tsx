'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { Map as LeafletMap, Marker, Polyline, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  fetchRadarFleet,
  fetchChargingStations,
  fetchHighwayBlackspots,
  RadarVehicle,
  ChargingStation,
  HighwayBlackspot,
} from '@/services/api';
import Link from 'next/link';

// Kenyan Highway Corridors Waypoint Geometry
const HIGHWAY_CORRIDORS: Record<string, { name: string; color: string; coords: [number, number][] }> = {
  a104: {
    name: 'A104 Great North Road (Nairobi - Nakuru - Eldoret)',
    color: '#06b6d4', // Neon Cyan
    coords: [
      [-1.2864, 36.8172], // Nairobi CBD
      [-1.2677, 36.8049], // Westlands
      [-1.2585, 36.7516], // Kangemi
      [-1.2540, 36.7210], // Uthiru
      [-1.2447, 36.6631], // Kikuyu
      [-1.1118, 36.6437], // Limuru Escarpment
      [-0.9897, 36.5861], // Mai Mahiu Junction
      [-0.7172, 36.4310], // Naivasha
      [-0.4920, 36.2870], // Gilgil
      [-0.3031, 36.0800], // Nakuru Terminal
      [-0.2200, 35.8500], // Salgaa
      [0.0400, 35.5300],  // Timboroa
      [0.5143, 35.2698],  // Eldoret
    ],
  },
  a109: {
    name: 'A109 Mombasa Highway (Nairobi - Voi - Mombasa)',
    color: '#f59e0b', // Neon Amber
    coords: [
      [-1.2864, 36.8172], // Nairobi CBD
      [-1.4500, 36.9800], // Athi River
      [-1.5300, 37.1000], // Machakos Junction
      [-2.0200, 37.3800], // Sultan Hamud
      [-2.0700, 37.4600], // Emali
      [-2.2800, 37.8200], // Makindu
      [-2.4200, 37.9700], // Kibwezi
      [-2.6900, 38.1670], // Mtito Andei
      [-3.0700, 38.4800], // Manyani
      [-3.3960, 38.5560], // Voi Junction
      [-3.5600, 38.7500], // Maungu
      [-3.7300, 39.0400], // Mackinnon Road
      [-3.7800, 39.2700], // Samburu
      [-3.8600, 39.4700], // Mariakani
      [-3.9600, 39.5400], // Mazeras
      [-4.0435, 39.6682], // Mombasa Terminal
    ],
  },
  thika: {
    name: 'A2 Thika Superhighway (Nairobi - Thika - Nyeri)',
    color: '#10b981', // Neon Emerald
    coords: [
      [-1.2864, 36.8172], // Nairobi CBD
      [-1.2185, 36.8876], // Roysambu
      [-1.1824, 36.9298], // Kahawa
      [-1.1444, 36.9583], // Ruiru
      [-1.1026, 37.0132], // Juja
      [-1.0333, 37.0694], // Thika Town
      [-0.9230, 37.1230], // Kenol
      [-0.7211, 37.1526], // Murang'a
      [-0.6653, 37.2025], // Sagana
      [-0.4833, 37.1167], // Karatina
      [-0.4197, 36.9511], // Nyeri
    ],
  },
};

interface NationalFleetRadarProps {
  className?: string;
  autoRefreshIntervalSeconds?: number;
}

export default function NationalFleetRadar({
  className = '',
  autoRefreshIntervalSeconds = 10,
}: NationalFleetRadarProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const polylinesLayerRef = useRef<LayerGroup | null>(null);
  const vehiclesLayerRef = useRef<LayerGroup | null>(null);
  const stationsLayerRef = useRef<LayerGroup | null>(null);
  const blackspotsLayerRef = useRef<LayerGroup | null>(null);

  const [fleet, setFleet] = useState<RadarVehicle[]>([]);
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [blackspots, setBlackspots] = useState<HighwayBlackspot[]>([]);
  const [showBlackspots, setShowBlackspots] = useState(true);
  const [selectedBlackspot, setSelectedBlackspot] = useState<HighwayBlackspot | null>(null);
  const [activeCorridor, setActiveCorridor] = useState<string>('all');
  const [evOnly, setEvOnly] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<RadarVehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Load Fleet, Stations & Blackspots
  const loadRadarData = async () => {
    try {
      const [fleetRes, stationsRes, blackspotsRes] = await Promise.all([
        fetchRadarFleet(),
        fetchChargingStations(),
        fetchHighwayBlackspots(),
      ]);
      setFleet(fleetRes.fleet || []);
      setStations(stationsRes.stations || []);
      setBlackspots(blackspotsRes.blackspots || []);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error('Failed to load radar data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRadarData();
    const interval = setInterval(loadRadarData, autoRefreshIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshIntervalSeconds]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;

    async function initLeaflet() {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      // Center Kenya (Nakuru/Naivasha crossroads)
      const map = L.map(mapContainerRef.current, {
        center: [-0.9, 37.2],
        zoom: 7,
        zoomControl: true,
        attributionControl: true,
      });

      // CartoDB Dark Matter retina basemap
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 18,
      }).addTo(map);

      polylinesLayerRef.current = L.layerGroup().addTo(map);
      stationsLayerRef.current = L.layerGroup().addTo(map);
      vehiclesLayerRef.current = L.layerGroup().addTo(map);
      blackspotsLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;

      // Draw Highway Polylines
      Object.entries(HIGHWAY_CORRIDORS).forEach(([key, corridor]) => {
        // Outer glowing line
        L.polyline(corridor.coords, {
          color: corridor.color,
          weight: 6,
          opacity: 0.35,
          lineCap: 'round',
        }).addTo(polylinesLayerRef.current!);

        // Core bright line
        L.polyline(corridor.coords, {
          color: corridor.color,
          weight: 2.5,
          opacity: 0.9,
          dashArray: '8, 6',
        }).addTo(polylinesLayerRef.current!);

        // Waypoint nodes
        corridor.coords.forEach(([lat, lng]) => {
          L.circleMarker([lat, lng], {
            radius: 3.5,
            color: corridor.color,
            fillColor: '#0f172a',
            fillOpacity: 1,
            weight: 2,
          }).addTo(polylinesLayerRef.current!);
        });
      });
    }

    initLeaflet();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    return fleet.filter((v) => {
      if (evOnly && !v.is_electric) return false;
      if (activeCorridor === 'a104' && !v.route_name.toLowerCase().includes('nakuru') && !v.route_name.toLowerCase().includes('eldoret')) {
        return false;
      }
      if (activeCorridor === 'a109' && !v.route_name.toLowerCase().includes('mombasa')) {
        return false;
      }
      if (activeCorridor === 'thika' && !v.route_name.toLowerCase().includes('thika') && !v.route_name.toLowerCase().includes('nyeri')) {
        return false;
      }
      return true;
    });
  }, [fleet, activeCorridor, evOnly]);

  // Render Vehicles and Stations on Map
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    let isCancelled = false;

    async function updateMarkers() {
      const L = (await import('leaflet')).default;
      if (isCancelled) return;

      // Update EV Charging Stations
      if (stationsLayerRef.current) {
        stationsLayerRef.current.clearLayers();
        stations.forEach((st) => {
          const stationIcon = L.divIcon({
            className: 'custom-station-icon',
            html: `
              <div style="
                background: #090d16;
                border: 2px solid #84cc16;
                border-radius: 9999px;
                padding: 4px 7px;
                display: flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 0 12px rgba(132, 204, 22, 0.6);
                cursor: pointer;
              ">
                <span style="font-size: 11px;">⚡</span>
                <span style="font-size: 9px; font-weight: 800; color: #bef264; font-family: monospace;">${st.power_kw}kW</span>
              </div>
            `,
            iconSize: [60, 24],
            iconAnchor: [30, 12],
          });

          const m = L.marker([st.lat, st.lng], { icon: stationIcon }).addTo(stationsLayerRef.current!);
          m.bindPopup(`
            <div style="font-family: sans-serif; padding: 4px; color: #e2e8f0;">
              <div style="font-size: 13px; font-weight: bold; color: #a3e635;">⚡ ${st.name}</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Operator: <b>${st.operator}</b> • Corridor: ${st.corridor}</div>
              <div style="margin-top: 6px; font-size: 11px; background: rgba(132,204,22,0.1); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(132,204,22,0.3);">
                <b>${st.ports_available} / ${st.ports_total}</b> Fast Ports Available (${st.connector_type})
              </div>
            </div>
          `);
        });
      }

      // Update Vehicle Markers
      if (vehiclesLayerRef.current) {
        vehiclesLayerRef.current.clearLayers();
        filteredVehicles.forEach((veh) => {
          const saccoColor = veh.sacco_color || '#06b6d4';
          const speedText = veh.current_speed ? `${Math.round(veh.current_speed)}kph` : '78kph';
          const evBadge = veh.is_electric ? '⚡' : '🚌';

          const busIcon = L.divIcon({
            className: 'custom-bus-radar-icon',
            html: `
              <div style="
                position: relative;
                background: #090d16;
                border: 2px solid ${saccoColor};
                border-radius: 8px;
                padding: 3px 6px;
                display: flex;
                align-items: center;
                gap: 5px;
                box-shadow: 0 0 16px ${saccoColor}88;
                cursor: pointer;
              ">
                <span style="font-size: 12px;">${evBadge}</span>
                <div style="display: flex; flex-direction: column;">
                  <span style="font-size: 9px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${veh.plate_number || 'KDA 123'}</span>
                  <span style="font-size: 8px; font-weight: bold; color: ${saccoColor};">${speedText}</span>
                </div>
              </div>
            `,
            iconSize: [85, 30],
            iconAnchor: [42, 15],
          });

          const marker = L.marker([veh.current_lat, veh.current_lng], { icon: busIcon }).addTo(vehiclesLayerRef.current!);

          marker.on('click', () => {
            setSelectedVehicle(veh);
          });

          marker.bindPopup(`
            <div style="font-family: sans-serif; padding: 4px; color: #e2e8f0; min-width: 170px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12px; font-weight: bold; color: ${saccoColor};">${veh.sacco_name}</span>
                <span style="font-size: 10px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${veh.plate_number}</span>
              </div>
              <div style="font-size: 11px; font-weight: 600; margin-top: 4px; color: #f8fafc;">${veh.route_name}</div>
              <div style="margin-top: 6px; font-size: 10px; color: #94a3b8; display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                <div>Speed: <b style="color: #38bdf8;">${veh.current_speed || 78} km/h</b></div>
                <div>Occupancy: <b style="color: #f43f5e;">${veh.occupied_seats || 0}/${veh.seat_capacity || 31}</b></div>
              </div>
              ${veh.is_electric ? '<div style="margin-top: 6px; font-size: 9px; color: #a3e635; font-weight: bold;">⚡ Electric Powertrain Active</div>' : ''}
              <div style="margin-top: 8px; text-align: right;">
                <a href="/?trip=${veh.trip_id}" style="color: #38bdf8; font-size: 10px; font-weight: bold; text-decoration: none;">Book Seats &rarr;</a>
              </div>
            </div>
          `);
        });
      }

      // Update Highway Blackspots & Hazard Geofences
      if (blackspotsLayerRef.current) {
        blackspotsLayerRef.current.clearLayers();
        if (showBlackspots) {
          blackspots.forEach((spot) => {
            // Pulsing hazard danger radius circle
            L.circle([spot.lat, spot.lng], {
              radius: spot.radius_km * 1000,
              color: '#f43f5e',
              fillColor: '#f43f5e',
              fillOpacity: 0.12,
              weight: 1.5,
              dashArray: '5, 5',
            }).addTo(blackspotsLayerRef.current!);

            // Hazard badge marker
            const spotIcon = L.divIcon({
              className: 'custom-blackspot-icon',
              html: `
                <div style="
                  background: #881337;
                  border: 2px solid #f43f5e;
                  border-radius: 9999px;
                  padding: 3px 6px;
                  display: flex;
                  align-items: center;
                  gap: 3px;
                  box-shadow: 0 0 10px rgba(244, 63, 94, 0.7);
                  cursor: pointer;
                ">
                  <span style="font-size: 11px;">⚠️</span>
                  <span style="font-size: 9px; font-weight: 800; color: #fecdd3; font-family: sans-serif;">${spot.speed_limit_kmh}kph</span>
                </div>
              `,
              iconSize: [55, 22],
              iconAnchor: [27, 11],
            });

            const m = L.marker([spot.lat, spot.lng], { icon: spotIcon }).addTo(blackspotsLayerRef.current!);
            m.on('click', () => setSelectedBlackspot(spot));
            m.bindPopup(`
              <div style="font-family: sans-serif; padding: 4px; color: #e2e8f0; max-width: 240px;">
                <div style="font-size: 12px; font-weight: bold; color: #fb7185;">⚠️ ${spot.name}</div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 1px;">${spot.corridor} • Limit: <b>${spot.speed_limit_kmh} km/h</b></div>
                <div style="font-size: 10px; color: #fda4af; margin-top: 4px;"><i>"${spot.caution_sw}"</i></div>
              </div>
            `);
          });
        }
      }
    }

    updateMarkers();

    return () => {
      isCancelled = true;
    };
  }, [filteredVehicles, stations, blackspots, showBlackspots]);

  // Aggregate Stats
  const stats = useMemo(() => {
    const totalBuses = fleet.length;
    const totalEv = fleet.filter((v) => v.is_electric).length;
    const totalPassengers = fleet.reduce((acc, v) => acc + (v.occupied_seats || 0), 0);
    const avgSpeed = fleet.length
      ? Math.round(fleet.reduce((acc, v) => acc + (v.current_speed || 75), 0) / fleet.length)
      : 75;

    return { totalBuses, totalEv, totalPassengers, avgSpeed };
  }, [fleet]);

  return (
    <div className={`relative flex flex-col w-full rounded-2xl border border-slate-800 bg-[#090d16] overflow-hidden shadow-2xl ${className}`}>
      {/* Top Header & Corridor Filter Bar */}
      <div className="p-4 md:p-5 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
            <h2 className="text-base font-black tracking-wider text-white uppercase flex items-center gap-2">
              National Highway Fleet Radar <span className="text-xs px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/50">LIVE GIS</span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time GPS telemetry across Kenyan highway corridors (A104, A109, Thika Superhighway)
          </p>
        </div>

        {/* Corridor Quick Selectors */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: 'All Corridors' },
            { id: 'a104', label: 'A104 Western' },
            { id: 'a109', label: 'A109 Coast' },
            { id: 'thika', label: 'Thika / A2' },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCorridor(c.id)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeCorridor === c.id
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {c.label}
            </button>
          ))}

          <button
            onClick={() => setEvOnly(!evOnly)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all ${
              evOnly
                ? 'bg-lime-400 text-slate-950 font-black shadow-md shadow-lime-400/30'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <span>⚡</span> EV Only
          </button>

          <button
            onClick={() => setShowBlackspots(!showBlackspots)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all ${
              showBlackspots
                ? 'bg-rose-500 text-slate-950 font-black shadow-md shadow-rose-500/30'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <span>⚠️</span> Blackspots ({blackspots.length})
          </button>

          <button
            onClick={loadRadarData}
            title="Refresh GPS Feed"
            className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 text-xs flex items-center gap-1"
          >
            <span>🔄</span>
            <span className="hidden sm:inline text-[10px]">Sync</span>
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-800/60 bg-slate-950/40 text-center py-2 px-3 gap-2 text-xs">
        <div className="border-r border-slate-800/40 py-1">
          <div className="text-[10px] uppercase font-bold text-slate-500">Active Transit Fleet</div>
          <div className="text-sm font-black text-white">{stats.totalBuses} Vehicles</div>
        </div>
        <div className="border-r border-slate-800/40 py-1">
          <div className="text-[10px] uppercase font-bold text-slate-500">Corridor Commuters</div>
          <div className="text-sm font-black text-cyan-400">{stats.totalPassengers} En Route</div>
        </div>
        <div className="border-r border-slate-800/40 py-1">
          <div className="text-[10px] uppercase font-bold text-slate-500">Avg Highway Speed</div>
          <div className="text-sm font-black text-emerald-400">{stats.avgSpeed} km/h</div>
        </div>
        <div className="py-1">
          <div className="text-[10px] uppercase font-bold text-slate-500">EV Fleet & Chargers</div>
          <div className="text-sm font-black text-lime-400">{stats.totalEv} EVs • {stations.length} Fast Depots</div>
        </div>
      </div>

      {/* Interactive Map Canvas */}
      <div className="relative w-full h-[540px] bg-[#05070d]">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Legend Overlay */}
        <div className="absolute bottom-4 left-4 z-[400] bg-slate-950/80 backdrop-blur-md border border-slate-800 rounded-xl p-2.5 text-[10px] space-y-1.5 pointer-events-auto shadow-xl">
          <div className="font-bold text-slate-300 mb-1 flex items-center gap-1">
            <span>🗺️</span> Kenya Highway Corridors
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-3 h-1 bg-[#06b6d4] rounded-full inline-block shadow-sm shadow-cyan-400" />
            <span>A104 Great North (Eldoret/Nakuru)</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-3 h-1 bg-[#f59e0b] rounded-full inline-block shadow-sm shadow-amber-400" />
            <span>A109 Mombasa Highway</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-3 h-1 bg-[#10b981] rounded-full inline-block shadow-sm shadow-emerald-400" />
            <span>Thika Superhighway / A2</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 pt-1 border-t border-slate-800/60">
            <span className="text-xs">⚡</span>
            <span className="text-lime-400 font-bold">120kW+ Fast EV Depot</span>
          </div>
        </div>

        {/* Vehicle Selection Drawer (if clicked) */}
        {selectedVehicle && (
          <div className="absolute top-4 right-4 z-[400] w-72 bg-slate-950/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-4 shadow-2xl animate-in fade-in slide-in-from-right-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                  {selectedVehicle.sacco_name}
                </span>
                <h3 className="text-base font-black text-white mt-1">{selectedVehicle.plate_number}</h3>
              </div>
              <button
                onClick={() => setSelectedVehicle(null)}
                className="text-slate-400 hover:text-white p-1 rounded-md bg-slate-900 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 text-xs space-y-2 border-t border-slate-800 pt-2">
              <div className="text-slate-300 font-semibold">{selectedVehicle.route_name}</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Speed</span>
                  <span className="text-cyan-400 font-bold">{selectedVehicle.current_speed || 78} km/h</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Occupancy</span>
                  <span className="text-white font-bold">{selectedVehicle.occupied_seats || 0} / {selectedVehicle.seat_capacity || 31}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Powertrain</span>
                  <span className={selectedVehicle.is_electric ? 'text-lime-400 font-bold' : 'text-slate-300'}>
                    {selectedVehicle.is_electric ? '⚡ 100% Electric' : 'Diesel PSV'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Status</span>
                  <span className="text-emerald-400 font-bold capitalize">{selectedVehicle.status}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <Link
                  href={`/?trip=${selectedVehicle.trip_id}`}
                  className="w-full text-center py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black text-xs hover:brightness-110 transition-all shadow-md shadow-cyan-500/20"
                >
                  Book Seat on This Bus &rarr;
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Blackspot Detail Drawer */}
        {selectedBlackspot && (
          <div className="absolute top-4 left-4 z-[400] w-80 bg-slate-950/95 backdrop-blur-md border border-rose-500/80 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-left-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/40">
                  ⚠️ {selectedBlackspot.severity.toUpperCase()} HAZARD
                </span>
                <h3 className="text-base font-black text-white mt-1">{selectedBlackspot.name}</h3>
                <span className="text-xs text-slate-400">{selectedBlackspot.corridor}</span>
              </div>
              <button
                onClick={() => setSelectedBlackspot(null)}
                className="text-slate-400 hover:text-white p-1 rounded-md bg-slate-900 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 text-xs space-y-2 border-t border-slate-800 pt-2">
              <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-200 text-xs">
                <span className="font-bold block mb-1">📢 Swahili Advisory:</span>
                <p className="italic">&quot;{selectedBlackspot.caution_sw}&quot;</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Speed Limit</span>
                  <span className="text-amber-400 font-bold">{selectedBlackspot.speed_limit_kmh} km/h</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Danger Zone</span>
                  <span className="text-white font-bold">{selectedBlackspot.radius_km} km radius</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block text-[9px] uppercase">Hazard Profile</span>
                  <span className="text-slate-300 font-semibold">{selectedBlackspot.hazard_type}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

