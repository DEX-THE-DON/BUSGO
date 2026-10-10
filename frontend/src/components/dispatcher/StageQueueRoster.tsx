'use client';

import React, { useState, useEffect } from 'react';
import {
  fetchStageQueue,
  checkinStageQueue,
  dispatchStageQueue,
  skipStageQueue,
  StageQueueItem,
  Route,
  Vehicle,
  User,
  fetchRoutes,
  fetchAdminVehicles,
  fetchAdminDrivers,
  DriverRow,
  errMsg,
  wsBaseUrl,
  getToken,
} from '@/services/api';

interface StageQueueRosterProps {
  currentRouteId?: number;
  onTripSelected?: (tripId: number) => void;
}

export default function StageQueueRoster({
  currentRouteId,
  onTripSelected,
}: StageQueueRosterProps) {
  const [queue, setQueue] = useState<StageQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  // Routes, Vehicles & Drivers for Check-in Modal
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<number>(currentRouteId || 1);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);
  const [selectedDriverId, setSelectedDriverId] = useState<number>(0);
  const [stageName, setStageName] = useState('Nairobi CBD Bay 1');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<number | null>(null);

  const loadQueue = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetchStageQueue(selectedRouteId, stageName);
      setQueue(res.queue || []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const loadMetadata = async () => {
    try {
      const [rRes, vRes, dRes] = await Promise.all([
        fetchRoutes().then((r) => r.routes).catch(() => []),
        fetchAdminVehicles().then((r) => r.vehicles).catch(() => []),
        fetchAdminDrivers().then((r) => r.drivers).catch(() => []),
      ]);
      setRoutes(rRes || []);
      setVehicles(vRes || []);
      setDrivers(dRes || []);
      if (rRes && rRes.length > 0 && !selectedRouteId) {
        setSelectedRouteId(rRes[0].id);
      }
      if (vRes && vRes.length > 0) {
        setSelectedVehicleId(vRes[0].id);
      }
      if (dRes && dRes.length > 0) {
        setSelectedDriverId(dRes[0].id);
      }
    } catch (err) {
      console.warn('Metadata load error:', err);
    }
  };

  useEffect(() => {
    loadMetadata();
  }, []);

  useEffect(() => {
    loadQueue();
  }, [selectedRouteId, stageName]);

  // Real-time WebSocket listener for stage updates
  useEffect(() => {
    const token = getToken();
    const wsUrl = `${wsBaseUrl()}/ws/notifications${token ? `?token=${token}` : ''}`;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'stage_queue_updated') {
            loadQueue();
          }
        } catch {
          /* ignore non-json */
        }
      };
    } catch {
      /* ignore offline ws */
    }

    return () => {
      if (socket) socket.close();
    };
  }, [selectedRouteId, stageName]);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(''), 4500);
  };

  const handleDispatch = async (entry: StageQueueItem) => {
    try {
      setDispatchingId(entry.id);
      const res = await dispatchStageQueue(entry.id);
      showNotice(`✓ ${entry.plate_number} Dispatched! Next vehicle advanced to Loading Bay.`);
      await loadQueue();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setDispatchingId(null);
    }
  };

  const handleSkip = async (entry: StageQueueItem) => {
    try {
      await skipStageQueue(entry.id);
      showNotice(`✓ ${entry.plate_number} bumped to the back of the queue.`);
      await loadQueue();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const handleCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCheckinLoading(true);
      setError('');
      const res = await checkinStageQueue({
        route_id: selectedRouteId,
        vehicle_id: selectedVehicleId,
        driver_id: selectedDriverId || undefined,
        stage_name: stageName,
      });
      showNotice(`✓ ${res.message}`);
      setShowCheckinModal(false);
      await loadQueue();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCheckinLoading(false);
    }
  };

  const loadingBayVehicle = queue.find((q) => q.position === 1 && q.status === 'loading');
  const waitingVehicles = queue.filter((q) => q.id !== loadingBayVehicle?.id);

  return (
    <div className="space-y-6">
      {/* Marshall Header & Bay Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#121624] border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              FIFO TERMINAL ROSTER
            </span>
            <span className="text-xs text-slate-400">• Karani wa Stage</span>
          </div>
          <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
            <span>Stage Marshall Loading Bay Queue</span>
            <span className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-emerald-400 rounded border border-slate-700">
              Live Dispatch
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manages first-in, first-out vehicle lineup. Position #1 is the active loading bay where online &amp; walk-in passengers board.
          </p>
        </div>

        {/* Actions & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-medium"
          >
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowCheckinModal(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow transition flex items-center gap-1.5"
          >
            <span>➕ Check-in Arriving Vehicle</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center justify-between animate-fadeIn">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice('')} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-between animate-fadeIn">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* POSITION 1: ACTIVE LOADING BAY CARD */}
      {loadingBayVehicle ? (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-r from-emerald-950/20 via-[#131e18] to-slate-900 p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 px-4 py-1 bg-emerald-500/20 border-b border-l border-emerald-500/30 rounded-bl-xl text-[10px] font-bold font-mono tracking-widest text-emerald-400 uppercase">
            BAY #1 • ACTIVE LOADING BAY
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Vehicle & Sacco specs */}
            <div className="lg:col-span-5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-white font-mono tracking-wider">
                  {loadingBayVehicle.plate_number}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-indigo-300 border border-slate-700">
                  {loadingBayVehicle.sacco_name}
                </span>
              </div>
              <div className="text-xs text-slate-300 flex items-center gap-3">
                <span>👤 Driver: <strong className="text-white">{loadingBayVehicle.driver_name}</strong></span>
                <span>📞 {loadingBayVehicle.driver_phone}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Checked in at: {loadingBayVehicle.checked_in_at ? new Date(loadingBayVehicle.checked_in_at).toLocaleTimeString() : '—'}
              </div>
            </div>

            {/* Occupancy Progress */}
            <div className="lg:col-span-4 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400 font-medium">Passenger Load Occupancy</span>
                <span className="font-mono font-bold text-white">
                  {loadingBayVehicle.booked_seats} / {loadingBayVehicle.capacity} Seats ({loadingBayVehicle.load_percentage}%)
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    loadingBayVehicle.is_full
                      ? 'bg-amber-400'
                      : loadingBayVehicle.load_percentage > 50
                      ? 'bg-emerald-500'
                      : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.max(8, loadingBayVehicle.load_percentage)}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>{loadingBayVehicle.capacity - loadingBayVehicle.booked_seats} Seats Remaining</span>
                {loadingBayVehicle.is_full && (
                  <span className="text-amber-400 font-bold">★ VEHICLE FULL - READY FOR DEPARTURE</span>
                )}
              </div>
            </div>

            {/* Stage Marshall Dispatch Trigger */}
            <div className="lg:col-span-3 flex flex-col gap-2">
              <button
                onClick={() => handleDispatch(loadingBayVehicle)}
                disabled={dispatchingId === loadingBayVehicle.id}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>🚀 Dispatch &amp; Advance Bay</span>
              </button>
              <div className="flex gap-2">
                {loadingBayVehicle.trip_id && onTripSelected && (
                  <button
                    onClick={() => onTripSelected(loadingBayVehicle.trip_id!)}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded-lg border border-slate-700 transition"
                  >
                    View Manifest
                  </button>
                )}
                <button
                  onClick={() => handleSkip(loadingBayVehicle)}
                  className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 text-[11px] font-semibold rounded-lg border border-slate-700 transition"
                >
                  Bump to Back
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 text-center space-y-2">
          <div className="text-3xl">🚐</div>
          <h3 className="text-sm font-bold text-white">Loading Bay is Currently Empty</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No vehicle is currently queued in Bay #1 for this route. Click below to check in an arriving vehicle.
          </p>
          <button
            onClick={() => setShowCheckinModal(true)}
            className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow"
          >
            Check-in Vehicle to Bay #1
          </button>
        </div>
      )}

      {/* POSITIONS 2+ : WAITING IN QUEUE / ON DECK */}
      <div className="rounded-2xl bg-[#121624] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Holding Yard Lineup ({waitingVehicles.length} Vehicles Waiting)
            </h3>
            <p className="text-xs text-slate-400">
              Vehicles automatically advance forward when the Bay #1 vehicle is dispatched.
            </p>
          </div>
          <button
            onClick={loadQueue}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {waitingVehicles.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No waiting vehicles in the holding yard. Check in more matatus to populate queue.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {waitingVehicles.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition space-y-2.5 relative"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-indigo-400 font-mono font-bold text-xs flex items-center justify-center border border-slate-700">
                      #{item.position}
                    </span>
                    <span className="font-bold text-sm text-white font-mono">
                      {item.plate_number}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.position === 2
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.position === 2 ? 'ON DECK' : `IN YARD (#${item.position})`}
                  </span>
                </div>

                <div className="text-xs text-slate-300 space-y-1">
                  <div>Driver: <span className="text-white font-medium">{item.driver_name}</span></div>
                  <div>Phone: <span className="text-slate-400">{item.driver_phone}</span></div>
                  <div>Sacco: <span className="text-slate-400">{item.sacco_name}</span></div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">
                    Checked in: {item.checked_in_at ? new Date(item.checked_in_at).toLocaleTimeString() : '—'}
                  </span>
                  <button
                    onClick={() => handleSkip(item)}
                    className="text-slate-400 hover:text-rose-400 text-[10px] font-medium"
                  >
                    Bump Back
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CHECK-IN MODAL */}
      {showCheckinModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121624] border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🚐 Check-in Arriving Vehicle</span>
              </h3>
              <button
                onClick={() => setShowCheckinModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCheckin} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-medium">Corridor Route</label>
                <select
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(Number(e.target.value))}
                  className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500"
                >
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (KES {r.base_fare})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Select Vehicle Plate</label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(Number(e.target.value))}
                  className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500 font-mono"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate_number} • {v.body_type || 'PSV Matatu'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Assign Driver</label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(Number(e.target.value))}
                  className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value={0}>Auto-assign Registered Vehicle Driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} ({d.phone || 'No phone'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Terminal / Bay Name</label>
                <input
                  type="text"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="e.g. Tea Room Bay 1"
                  className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-[11px] text-indigo-300">
                🛡️ <strong>NTSA Safety Gate:</strong> The sweeper will verify valid RSL, inspection certificate, speed governor, and driver PSV badge before admitting the vehicle to the queue.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCheckinModal(false)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={checkinLoading}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition disabled:opacity-50"
                >
                  {checkinLoading ? 'Checking In...' : 'Confirm Check-in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
