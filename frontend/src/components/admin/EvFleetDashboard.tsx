'use client';

import React, { useEffect, useState } from 'react';
import {
  fetchEvFleet,
  fetchChargingStations,
  recordEvTelemetry,
  EvVehicle,
  ChargingStation,
  errMsg,
} from '@/services/api';

export default function EvFleetDashboard() {
  const [fleet, setFleet] = useState<EvVehicle[]>([]);
  const [stations, setStations] = useState<ChargingStation[]>([]);
  const [totalCo2, setTotalCo2] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Simulation modal
  const [selectedEv, setSelectedEv] = useState<EvVehicle | null>(null);
  const [simSoc, setSimSoc] = useState<number>(80);
  const [simStatus, setSimStatus] = useState<string>('discharging');
  const [updating, setUpdating] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [fleetRes, stationsRes] = await Promise.all([
        fetchEvFleet(),
        fetchChargingStations(),
      ]);
      setFleet(fleetRes.ev_fleet || []);
      setTotalCo2(fleetRes.total_co2_saved_kg || 0);
      setStations(stationsRes.stations || []);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEv) return;

    try {
      setUpdating(true);
      setError('');
      await recordEvTelemetry({
        vehicle_id: selectedEv.vehicle_id,
        battery_soc_pct: simSoc,
        charging_status: simStatus,
        battery_temp_c: simStatus.includes('charging') ? 34.2 : 28.5,
        power_consumption_kwh_per_km: simStatus === 'idle' ? 0.05 : (simStatus.includes('charging') ? 0.0 : 0.82),
      });

      setSuccessNotice(`Updated telemetry for ${selectedEv.plate_number}: Battery at ${simSoc}% (${simStatus}).`);
      setSelectedEv(null);
      loadData();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h2 className="text-lg font-black text-white tracking-wide uppercase">
              Green Fleet & EV Telemetry Depot
            </h2>
            <span className="px-2 py-0.5 rounded bg-lime-950/80 text-lime-400 border border-lime-800/50 text-[10px] font-black">
              BASIGO / ROAM
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time battery State-of-Charge (SoC %), regenerative energy harvest, highway charging depots, and CO₂ savings.
          </p>
        </div>

        <button
          onClick={loadData}
          className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
        >
          <span>🔄</span> Refresh Telemetry
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError('')} className="text-rose-400 font-bold">✕</button>
        </div>
      )}

      {successNotice && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs flex items-center justify-between">
          <span>✓ {successNotice}</span>
          <button onClick={() => setSuccessNotice('')} className="text-emerald-400 font-bold">✕</button>
        </div>
      )}

      {/* Headline Green Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total CO₂ Emissions Saved</div>
          <div className="text-2xl font-black text-lime-400 mt-1">{totalCo2.toLocaleString()} kg</div>
          <div className="text-[11px] text-slate-500 mt-1">vs Equivalent Diesel Fleet km</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Active Electric PSVs</div>
          <div className="text-2xl font-black text-cyan-400 mt-1">{fleet.length} Vehicles</div>
          <div className="text-[11px] text-slate-500 mt-1">14-Seater & 31-Seater electric buses</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Highway Charging Depots</div>
          <div className="text-2xl font-black text-amber-400 mt-1">{stations.length} Fast Hubs</div>
          <div className="text-[11px] text-slate-500 mt-1">A104, A109 & Thika Superhighway</div>
        </div>
      </div>

      {/* EV Fleet Grid */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>🚌</span> Live Electric Transit Telemetry
        </h3>

        {fleet.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800 text-xs">
            No electric vehicles registered in the fleet yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fleet.map((ev) => {
              const soc = ev.battery_soc_pct;
              const isLow = soc < 20;
              const isMed = soc >= 20 && soc < 50;
              const socColor = isLow ? '#f43f5e' : isMed ? '#f59e0b' : '#a3e635';

              return (
                <div
                  key={ev.vehicle_id}
                  className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4 relative overflow-hidden"
                >
                  {/* SACCO livery accent */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: ev.sacco_color || '#06b6d4' }}
                  />

                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">⚡</span>
                        <span className="text-base font-black text-white">{ev.plate_number}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {ev.vehicle_type_name}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{ev.sacco_name}</div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full border ${
                          ev.charging_status.includes('charging')
                            ? 'bg-lime-950 text-lime-400 border-lime-800/60 animate-pulse'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {ev.charging_status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Battery SoC Progress Bar */}
                  <div>
                    <div className="flex justify-between items-end mb-1 text-xs">
                      <span className="font-semibold text-slate-400">Battery State-of-Charge</span>
                      <span className="text-lg font-black" style={{ color: socColor }}>
                        {soc.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-slate-950 border border-slate-800 overflow-hidden p-0.5">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, soc))}%`,
                          backgroundColor: socColor,
                          boxShadow: `0 0 10px ${socColor}88`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Telemetry Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                      <span className="text-[9px] uppercase text-slate-500 font-bold block">Est. Range</span>
                      <span className="text-cyan-400 font-black text-sm">{ev.estimated_range_km} km</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                      <span className="text-[9px] uppercase text-slate-500 font-bold block">Cell Temp</span>
                      <span className="text-slate-200 font-black text-sm">{ev.battery_temp_c}°C</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                      <span className="text-[9px] uppercase text-slate-500 font-bold block">Power Rate</span>
                      <span className="text-amber-400 font-black text-sm">{ev.power_consumption_kwh_per_km} kWh/km</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                      <span className="text-[9px] uppercase text-slate-500 font-bold block">Regen Harvest</span>
                      <span className="text-lime-400 font-black text-sm">+{ev.regen_braking_kwh} kWh</span>
                    </div>
                  </div>

                  {/* Escarpment Advisory Banner if low */}
                  {isLow && (
                    <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-[11px] flex items-center gap-2">
                      <span>⚠️</span>
                      <span>
                        <b>Limuru Escarpment Climb Advisory:</b> Battery below 20%. Divert to Limuru Fast Station before ascending.
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => {
                        setSelectedEv(ev);
                        setSimSoc(ev.battery_soc_pct);
                        setSimStatus(ev.charging_status);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700"
                    >
                      <span>🛠️</span> Telemetry Dongle Simulator
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Highway EV Fast Charging Stations Directory */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>⚡</span> Kenya Highway EV Fast Charging Hubs
          </h3>
          <span className="text-xs text-slate-400 font-mono">{stations.length} Active Stations</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
              <tr>
                <th className="py-3 px-4">Station Name</th>
                <th className="py-3 px-4">Operator</th>
                <th className="py-3 px-4">Corridor</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4">Max Output</th>
                <th className="py-3 px-4">Ports Free</th>
                <th className="py-3 px-4">Standard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {stations.map((st) => (
                <tr key={st.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                    <span className="text-lime-400">⚡</span> {st.name}
                  </td>
                  <td className="py-3 px-4 font-semibold text-cyan-300">{st.operator}</td>
                  <td className="py-3 px-4 font-mono text-slate-300">{st.corridor}</td>
                  <td className="py-3 px-4 text-slate-400">{st.location_name}</td>
                  <td className="py-3 px-4 font-black text-amber-400">{st.power_kw} kW DC</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-lime-950 text-lime-300 border border-lime-800/50">
                      {st.ports_available} / {st.ports_total} Available
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[10px] text-slate-400">{st.connector_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Simulator Modal */}
      {selectedEv && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setSelectedEv(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-md bg-slate-800 text-xs"
            >
              ✕
            </button>

            <form onSubmit={handleSimulate} className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🛠️</span>
                <div>
                  <h3 className="text-base font-black text-white">EV Telemetry Simulation</h3>
                  <p className="text-[11px] text-slate-400">Vehicle: {selectedEv.plate_number} ({selectedEv.vehicle_type_name})</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 flex justify-between mb-1">
                  <span>Battery State-of-Charge (SoC %)</span>
                  <span className="font-bold text-cyan-400">{simSoc}%</span>
                </label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={simSoc}
                  onChange={(e) => setSimSoc(Number(e.target.value))}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Charging / Powertrain Status
                </label>
                <select
                  value={simStatus}
                  onChange={(e) => setSimStatus(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="discharging">Discharging (Highway Cruise)</option>
                  <option value="charging_dc_fast">Charging DC Fast (150kW Depot)</option>
                  <option value="charging_ac">Charging AC (Overnight Depot)</option>
                  <option value="idle">Idle (Stage Marshall Standby)</option>
                </select>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedEv(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-lime-500 to-emerald-500 text-slate-950 font-black text-xs hover:brightness-110 shadow-lg shadow-lime-500/20"
                >
                  {updating ? 'Transmitting...' : 'Send Telemetry &rarr;'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

