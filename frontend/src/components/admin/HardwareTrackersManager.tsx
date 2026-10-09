'use client';

import React, { useState, useEffect } from 'react';
import {
  fetchHardwareTrackers,
  bindHardwareTracker,
  fetchTrackerHistory,
  fetchOverspeedAlerts,
  ingestGenericTelemetry,
  ingestHardwareHexFrame,
  HardwareTrackerDevice,
  OverspeedAlert,
  TrackerBreadcrumb,
  Vehicle,
} from '@/services/api';

interface HardwareTrackersManagerProps {
  vehicles: Vehicle[];
  onRefreshVehicles?: () => void;
}

export default function HardwareTrackersManager({
  vehicles,
  onRefreshVehicles,
}: HardwareTrackersManagerProps) {
  const [activeSubTab, setActiveSubTab] = useState<'trackers' | 'bind' | 'simulator' | 'overspeed'>('trackers');
  const [trackers, setTrackers] = useState<HardwareTrackerDevice[]>([]);
  const [overspeedAlerts, setOverspeedAlerts] = useState<OverspeedAlert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Binding Form State
  const [bindPlate, setBindPlate] = useState<string>('');
  const [bindImei, setBindImei] = useState<string>('');
  const [bindModel, setBindModel] = useState<string>('teltonika_fmb920');
  const [bindingLoading, setBindingLoading] = useState<boolean>(false);

  // History Modal State
  const [selectedImei, setSelectedImei] = useState<string | null>(null);
  const [selectedPlate, setSelectedPlate] = useState<string>('');
  const [breadcrumbs, setBreadcrumbs] = useState<TrackerBreadcrumb[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Simulator State
  const [simProtocol, setSimProtocol] = useState<'teltonika' | 'concox' | 'generic'>('generic');
  const [simPlate, setSimPlate] = useState<string>('');
  const [simImei, setSimImei] = useState<string>('358721094819283');
  const [simLat, setSimLat] = useState<number>(-1.286389);
  const [simLng, setSimLng] = useState<number>(36.817223);
  const [simSpeed, setSimSpeed] = useState<number>(72.5);
  const [simHeading, setSimHeading] = useState<number>(315);
  const [simHexData, setSimHexData] = useState<string>(
    '000000000000002b08010000018c1b3f2000010131481f0000f40d4f0690013b0c0041000101ef010000000100004ad2'
  );
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [tRes, oRes] = await Promise.all([
        fetchHardwareTrackers(),
        fetchOverspeedAlerts(50),
      ]);
      setTrackers(tRes.trackers);
      setOverspeedAlerts(oRes.alerts);
    } catch (err: any) {
      setError(err?.message || 'Failed to load hardware tracker telemetry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, []);

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bindPlate || !bindImei) {
      setError('Vehicle plate and 15-digit IMEI are required.');
      return;
    }
    setBindingLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await bindHardwareTracker({
        plate_number: bindPlate,
        tracker_imei: bindImei.trim(),
        tracker_model: bindModel,
      });
      setSuccess(res.message);
      setBindImei('');
      await loadData();
      if (onRefreshVehicles) onRefreshVehicles();
      setActiveSubTab('trackers');
    } catch (err: any) {
      setError(err?.message || 'Failed to bind tracker.');
    } finally {
      setBindingLoading(false);
    }
  };

  const handleViewHistory = async (imei: string, plate: string) => {
    setSelectedImei(imei);
    setSelectedPlate(plate);
    setHistoryLoading(true);
    try {
      const res = await fetchTrackerHistory(imei, 100);
      setBreadcrumbs(res.breadcrumbs);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch tracker history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRunSimulator = async () => {
    setSimLoading(true);
    setSimResult(null);
    setError('');
    setSuccess('');
    try {
      if (simProtocol === 'generic') {
        const res = await ingestGenericTelemetry({
          imei: simImei || undefined,
          plate_number: simPlate || undefined,
          lat: simLat,
          lng: simLng,
          speed: simSpeed,
          heading: simHeading,
          satellites: 12,
          ignition: true,
          protocol: 'generic_sim',
        });
        setSimResult(res);
        setSuccess(`Telemetry point ingested for ${res.plate_number}.`);
      } else {
        const res = await ingestHardwareHexFrame(simProtocol, simHexData.trim(), simImei);
        setSimResult(res);
        setSuccess(`Hardware binary frame decoded and ingested via ${simProtocol.toUpperCase()} protocol!`);
      }
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Simulator ingestion failed.');
    } finally {
      setSimLoading(false);
    }
  };

  const onlineCount = trackers.filter((t) => t.is_online).length;
  const offlineCount = trackers.length - onlineCount;

  return (
    <div className="space-y-6">
      {/* Top Banner / Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Physical Trackers
          </div>
          <div className="mt-2 text-2xl font-bold text-white flex items-baseline gap-2">
            {trackers.length}
            <span className="text-xs text-slate-400 font-normal">devices</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Teltonika & Concox fleet units</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Online (10m)
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400 flex items-baseline gap-2">
            {onlineCount}
            <span className="text-xs text-slate-400 font-normal">active</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Streaming continuous GPS telemetry</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
            Signal Lost / Offline
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-400 flex items-baseline gap-2">
            {offlineCount}
            <span className="text-xs text-slate-400 font-normal">disconnected</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">No socket heartbeat &gt; 10 mins</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            NTSA Speed Violations
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-400 flex items-baseline gap-2">
            {overspeedAlerts.length}
            <span className="text-xs text-slate-400 font-normal">&gt; 80 km/h</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Statutory PSV limit alerts</div>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-xs underline hover:text-white">
            Dismiss
          </button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-sm flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-xs underline hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Subtabs */}
      <div className="flex border-b border-slate-800 space-x-6 text-sm font-medium">
        <button
          onClick={() => setActiveSubTab('trackers')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeSubTab === 'trackers'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Fleet Trackers ({trackers.length})
        </button>
        <button
          onClick={() => setActiveSubTab('bind')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeSubTab === 'bind'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          + Bind New Tracker
        </button>
        <button
          onClick={() => setActiveSubTab('simulator')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeSubTab === 'simulator'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Packet Ingestion Simulator
        </button>
        <button
          onClick={() => setActiveSubTab('overspeed')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeSubTab === 'overspeed'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          NTSA Speed Audits ({overspeedAlerts.length})
        </button>
      </div>

      {/* SUBTAB 1: Active Trackers Table */}
      {activeSubTab === 'trackers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-white">Registered Physical Trackers</h3>
              <p className="text-xs text-slate-400">
                Connected Teltonika (Port 5027) & Concox GT06 (Port 5023) hardware units.
              </p>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg transition-colors border border-slate-700"
            >
              {loading ? 'Refreshing...' : 'Refresh List'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Vehicle Plate</th>
                  <th className="py-3 px-4">SACCO</th>
                  <th className="py-3 px-4">Hardware Model</th>
                  <th className="py-3 px-4">IMEI Number</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Speed</th>
                  <th className="py-3 px-4">Last Position</th>
                  <th className="py-3 px-4">Last Ping</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {trackers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500 font-sans">
                      No hardware GPS trackers registered yet. Click &quot;+ Bind New Tracker&quot; to link your first unit.
                    </td>
                  </tr>
                ) : (
                  trackers.map((t) => (
                    <tr key={t.tracker_imei} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-sans font-bold text-white">
                        {t.plate_number}
                        {t.active_trip_name && (
                          <div className="text-[11px] text-cyan-400 font-normal truncate max-w-xs">
                            Active: {t.active_trip_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-300">
                        {t.sacco_name || 'Independent'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 border border-slate-700 text-slate-200">
                          {t.tracker_model.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{t.tracker_imei}</td>
                      <td className="py-3 px-4 font-sans">
                        {t.is_online ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            ONLINE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                            OFFLINE
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {t.last_speed !== null && t.last_speed !== undefined ? (
                          <span
                            className={
                              t.last_speed > 80
                                ? 'text-rose-400 font-bold'
                                : 'text-slate-200'
                            }
                          >
                            {t.last_speed.toFixed(1)} km/h
                          </span>
                        ) : (
                          <span className="text-slate-500">0.0 km/h</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {t.last_lat && t.last_lng ? (
                          <span>
                            {t.last_lat.toFixed(4)}, {t.last_lng.toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-slate-600">No fix</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-400 text-[11px]">
                        {t.last_ping_at ? (
                          new Date(t.last_ping_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        ) : (
                          <span className="text-slate-600">Never</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        <button
                          onClick={() => handleViewHistory(t.tracker_imei, t.plate_number)}
                          className="px-2.5 py-1 text-xs bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 rounded border border-cyan-500/30 transition-colors"
                        >
                          Breadcrumbs
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 2: Bind New Tracker Form */}
      {activeSubTab === 'bind' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-xl mx-auto shadow-sm">
          <h3 className="text-lg font-bold text-white">Bind Physical GPS Tracker</h3>
          <p className="text-xs text-slate-400 mt-1">
            Associate a 15-digit IMEI tracking hardware device with a fleet vehicle to automatically ingest telemetry.
          </p>

          <form onSubmit={handleBind} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Select Fleet Vehicle (Plate Number)
              </label>
              <select
                value={bindPlate}
                onChange={(e) => setBindPlate(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="">-- Choose Vehicle --</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.plate_number}>
                    {v.plate_number} {v.owner_name ? `(${v.owner_name})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tracker IMEI (15 Digits)
              </label>
              <input
                type="text"
                value={bindImei}
                onChange={(e) => setBindImei(e.target.value)}
                placeholder="e.g. 358721094819283"
                required
                pattern="[0-9]{15}"
                maxLength={15}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Enter the exact 15-digit serial printed on the Teltonika or Concox tracker label.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Hardware Tracker Protocol & Model
              </label>
              <select
                value={bindModel}
                onChange={(e) => setBindModel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="teltonika_fmb920">Teltonika FMB920 (Codec 8 TCP/5027)</option>
                <option value="teltonika_fmb120">Teltonika FMB120 Dual SIM (Codec 8 TCP/5027)</option>
                <option value="teltonika_fmc130">Teltonika FMC130 4G LTE (Codec 8 TCP/5027)</option>
                <option value="concox_gt06">Concox / Jimi GT06 (TCP/5023)</option>
                <option value="concox_wetrack2">Concox WeTrack2 / CRX1 (TCP/5023)</option>
                <option value="generic_rest">Generic HTTP / REST Gateway</option>
              </select>
            </div>

            <div className="pt-2 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveSubTab('trackers')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bindingLoading}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white rounded-lg transition-colors shadow"
              >
                {bindingLoading ? 'Binding...' : 'Save & Register Tracker'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUBTAB 3: Packet Ingestion Simulator */}
      {activeSubTab === 'simulator' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
          <div className="max-w-2xl">
            <h3 className="text-lg font-bold text-white">Hardware Packet Ingestion Simulator</h3>
            <p className="text-xs text-slate-400 mt-1">
              Verify incoming GPS telematics frames directly. Simulates hardware pings from roadside trackers without physical GSM devices.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Ingestion Protocol
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSimProtocol('generic');
                    }}
                    className={`py-2 px-3 text-xs rounded-lg border font-medium transition-colors ${
                      simProtocol === 'generic'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Normalized REST
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimProtocol('teltonika');
                      setSimHexData(
                        '000000000000002b08010000018c1b3f2000010131481f0000f40d4f0690013b0c0041000101ef010000000100004ad2'
                      );
                    }}
                    className={`py-2 px-3 text-xs rounded-lg border font-medium transition-colors ${
                      simProtocol === 'teltonika'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Teltonika Codec 8
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimProtocol('concox');
                      setSimHexData(
                        '78781f221a0a0910243b18006bf2b0024479e34b053700018d450d0a'
                      );
                    }}
                    className={`py-2 px-3 text-xs rounded-lg border font-medium transition-colors ${
                      simProtocol === 'concox'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Concox GT06 Frame
                  </button>
                </div>
              </div>

              {simProtocol === 'generic' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Plate Number (Optional)
                      </label>
                      <input
                        type="text"
                        value={simPlate}
                        onChange={(e) => setSimPlate(e.target.value)}
                        placeholder="e.g. KDA 123A"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white uppercase focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Tracker IMEI
                      </label>
                      <input
                        type="text"
                        value={simImei}
                        onChange={(e) => setSimImei(e.target.value)}
                        placeholder="e.g. 358721094819283"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        value={simLat}
                        onChange={(e) => setSimLat(parseFloat(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        value={simLng}
                        onChange={(e) => setSimLng(parseFloat(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Speed (km/h)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={simSpeed}
                        onChange={(e) => setSimSpeed(parseFloat(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                      <span className="text-[10px] text-slate-500">
                        {simSpeed > 80 ? '⚠️ Exceeds 80 km/h legal limit' : '✓ Normal speed'}
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Heading (0-360°)
                      </label>
                      <input
                        type="number"
                        value={simHeading}
                        onChange={(e) => setSimHeading(parseInt(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Tracker IMEI
                    </label>
                    <input
                      type="text"
                      value={simImei}
                      onChange={(e) => setSimImei(e.target.value)}
                      placeholder="e.g. 358721094819283"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Binary Frame (Hex Encoded)
                    </label>
                    <textarea
                      rows={4}
                      value={simHexData}
                      onChange={(e) => setSimHexData(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-emerald-400 font-mono focus:outline-none focus:border-cyan-500"
                    />
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[11px] text-slate-500">
                        Length: {simHexData.replace(/\s+/g, '').length / 2} bytes
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (simProtocol === 'teltonika') {
                            setSimHexData(
                              '000000000000002b08010000018c1b3f2000010131481f0000f40d4f0690013b0c0041000101ef010000000100004ad2'
                            );
                          } else {
                            setSimHexData(
                              '78781f221a0a0910243b18006bf2b0024479e34b053700018d450d0a'
                            );
                          }
                        }}
                        className="text-[11px] text-cyan-400 hover:underline"
                      >
                        Reset Sample Frame
                      </button>
                    </div>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={handleRunSimulator}
                disabled={simLoading}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs rounded-lg transition-all shadow-md"
              >
                {simLoading ? 'Transmitting Ingestion Ping...' : 'Transmit Ingestion Ping'}
              </button>
            </div>

            {/* Ingestion Response Output */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Live Socket Server Response
                </div>
                {simResult ? (
                  <pre className="text-xs font-mono text-cyan-400 bg-slate-900 p-3 rounded-lg overflow-x-auto max-h-80 border border-slate-800/80">
                    {JSON.stringify(simResult, null, 2)}
                  </pre>
                ) : (
                  <div className="text-xs text-slate-500 italic py-12 text-center">
                    Transmit a simulated frame to observe live server decoding and ACK packet.
                  </div>
                )}
              </div>

              {simResult && (
                <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                  <span>
                    Status: <strong className="text-emerald-400">Accepted & Broadcasted</strong>
                  </span>
                  <span>Vehicle: <strong className="text-white">{simResult.plate_number || 'OK'}</strong></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: Overspeed Violations Log */}
      {activeSubTab === 'overspeed' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-white">NTSA Statutory Speed Limit Audits</h3>
              <p className="text-xs text-slate-400">
                Automatic overspeed detection for PSV commercial vehicles exceeding 80 km/h.
              </p>
            </div>
            <span className="px-2.5 py-1 text-xs bg-rose-500/10 text-rose-400 rounded-md border border-rose-500/20 font-semibold">
              Statutory Limit: 80.0 km/h
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Log ID</th>
                  <th className="py-3 px-4">Vehicle Plate</th>
                  <th className="py-3 px-4">SACCO</th>
                  <th className="py-3 px-4">Speed Recorded</th>
                  <th className="py-3 px-4">Excess Over 80 km/h</th>
                  <th className="py-3 px-4">Position</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {overspeedAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                      ✓ No speed violations recorded across the fleet. All vehicles within 80 km/h limit.
                    </td>
                  </tr>
                ) : (
                  overspeedAlerts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-500">#{a.id}</td>
                      <td className="py-3 px-4 font-sans font-bold text-white">
                        {a.plate_number || 'UNKNOWN'}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-300">
                        {a.sacco_name || 'Independent'}
                      </td>
                      <td className="py-3 px-4 text-rose-400 font-bold">
                        {a.speed.toFixed(1)} km/h
                      </td>
                      <td className="py-3 px-4 text-rose-300">
                        +{(a.speed - 80).toFixed(1)} km/h
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {a.lat.toFixed(4)}, {a.lng.toFixed(4)}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-400">
                        {new Date(a.recorded_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Breadcrumbs History Modal */}
      {selectedImei && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>GPS Breadcrumb Trail:</span>
                  <span className="text-cyan-400">{selectedPlate}</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono">IMEI: {selectedImei}</p>
              </div>
              <button
                onClick={() => setSelectedImei(null)}
                className="text-slate-400 hover:text-white text-lg p-1"
              >
                ✕
              </button>
            </div>

            {historyLoading ? (
              <div className="py-12 text-center text-xs text-slate-400">
                Loading telematics track points...
              </div>
            ) : breadcrumbs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No telemetry breadcrumbs recorded for this tracker yet.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>Total Trail Points: {breadcrumbs.length}</span>
                  <span className="text-emerald-400">✓ Ingestion active</span>
                </div>
                <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-lg">
                  <table className="w-full text-left text-xs font-mono text-slate-300">
                    <thead className="bg-slate-950 sticky top-0 text-slate-400 text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Time</th>
                        <th className="py-2 px-3">Coordinates</th>
                        <th className="py-2 px-3">Speed</th>
                        <th className="py-2 px-3">Heading</th>
                        <th className="py-2 px-3">Sats</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {breadcrumbs.map((b, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="py-1.5 px-3 text-slate-400 text-[11px]">
                            {new Date(b.recorded_at).toLocaleTimeString()}
                          </td>
                          <td className="py-1.5 px-3 text-[11px]">
                            {b.lat.toFixed(5)}, {b.lng.toFixed(5)}
                          </td>
                          <td className="py-1.5 px-3">
                            <span className={b.speed > 80 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                              {b.speed.toFixed(1)} km/h
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-slate-400">{b.heading}°</td>
                          <td className="py-1.5 px-3 text-slate-500">{b.satellites || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedImei(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg transition-colors"
              >
                Close Trail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

