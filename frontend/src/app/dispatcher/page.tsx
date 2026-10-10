'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  fetchTrips,
  fetchTripStops,
  createWalkInBooking,
  fetchDispatcherManifest,
  reconcileStageTrip,
  disburseStagePayoutB2C,
  fetchDispatchOutbox,
  TripOption,
  TripStop,
  StageManifest,
  StageManifestPassenger,
  StageReconciliation,
  StageB2CPayoutResponse,
  DispatchOutboxItem,
  errMsg,
} from '@/services/api';
import {
  queueOfflineWalkin,
  getPendingWalkins,
  syncOfflineWalkins,
  PendingOfflineWalkin,
} from '@/lib/offlineStore';
import StageQueueRoster from '@/components/dispatcher/StageQueueRoster';

export default function StageDispatcherPage() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number>(0);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [manifest, setManifest] = useState<StageManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Offline & PWA Sync State
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingWalkins, setPendingWalkins] = useState<PendingOfflineWalkin[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Walk-in booking state
  const [showWalkinModal, setShowWalkinModal] = useState(false);
  const [walkinSeat, setWalkinSeat] = useState<number>(1);
  const [boardOrder, setBoardOrder] = useState<number>(1);
  const [alightOrder, setAlightOrder] = useState<number>(4);
  const [passengerName, setPassengerName] = useState('Walk-In Stage Passenger');
  const [passengerPhone, setPassengerPhone] = useState('254700000000');
  const [fareAmount, setFareAmount] = useState<number>(350);
  const [walkinLoading, setWalkinLoading] = useState(false);

  // Reconciliation state
  const [fuelDeduction, setFuelDeduction] = useState<number>(1500);
  const [conductorCommission, setConductorCommission] = useState<number>(500);
  const [otherExpenses, setOtherExpenses] = useState<number>(200);
  const [notes, setNotes] = useState('Stage departure handover by Stage Clerk');
  const [reconciliationResult, setReconciliationResult] = useState<StageReconciliation | null>(null);
  const [reconciling, setReconciling] = useState(false);

  // M-Pesa B2C Payout State
  const [b2cDriverPhone, setB2cDriverPhone] = useState('254712345678');
  const [b2cDriverName, setB2cDriverName] = useState('James Mwangi (Driver)');
  const [b2cPayoutType, setB2cPayoutType] = useState<
    'conductor_commission' | 'driver_float' | 'fuel_deduction' | 'sacco_surplus'
  >('conductor_commission');
  const [b2cLoading, setB2cLoading] = useState(false);
  const [b2cResult, setB2cResult] = useState<StageB2CPayoutResponse | null>(null);

  // Outbox SMS state
  const [showOutboxModal, setShowOutboxModal] = useState(false);
  const [outboxItems, setOutboxItems] = useState<DispatchOutboxItem[]>([]);
  const [outboxLoading, setOutboxLoading] = useState(false);

  // Manifest tab
  const [activeTab, setActiveTab] = useState<'all' | 'cash' | 'mpesa'>('all');

  // Load trips
  useEffect(() => {
    fetchTrips()
      .then((res) => {
        setTrips(res.trips);
        if (res.trips.length > 0) {
          setSelectedTripId(res.trips[0].id);
        }
      })
      .catch((err) => setError(errMsg(err)));
  }, []);

  // Monitor network online / offline status & check pending IndexedDB walk-ins
  const refreshPendingWalkins = useCallback(async () => {
    try {
      const items = await getPendingWalkins(selectedTripId);
      setPendingWalkins(items);
    } catch {
      // IndexedDB not ready or in SSR
    }
  }, [selectedTripId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(window.navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      handleSyncOfflineWalkins();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    refreshPendingWalkins();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [selectedTripId, refreshPendingWalkins]);

  // Load manifest & stops when selected trip changes
  const loadTripData = useCallback(async () => {
    if (!selectedTripId) return;
    try {
      setLoading(true);
      setError('');
      const [manifestData, stopsData] = await Promise.all([
        fetchDispatcherManifest(selectedTripId),
        fetchTripStops(selectedTripId),
      ]);
      setManifest(manifestData);
      setStops(stopsData.stops);
    } catch (err) {
      if (isOnline) {
        setError(errMsg(err));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTripId, isOnline]);

  useEffect(() => {
    loadTripData();
    refreshPendingWalkins();
  }, [selectedTripId, loadTripData, refreshPendingWalkins]);

  // Sync queued offline walk-in bookings to server
  const handleSyncOfflineWalkins = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const syncResult = await syncOfflineWalkins(createWalkInBooking);
      if (syncResult.syncedCount > 0) {
        setSuccessMsg(`✓ Synced ${syncResult.syncedCount} offline walk-in tickets to central server.`);
        await loadTripData();
      }
      await refreshPendingWalkins();
    } catch (err) {
      console.error('Walkin sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Quick Walk-In Booking Handler (Online with Offline Fallback)
  const handleWalkinBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalkinLoading(true);
    setError('');
    setSuccessMsg('');

    // If device is offline (e.g. dead zone stage), queue to IndexedDB directly
    if (!isOnline) {
      try {
        const offCode = `OFF-${Date.now().toString().slice(-6)}`;
        await queueOfflineWalkin({
          tripId: selectedTripId,
          seatNumber: walkinSeat,
          passengerName: passengerName.trim() || 'Stage Walk-in',
          passengerPhone: passengerPhone.trim() || '254700000000',
          boardStopOrder: boardOrder,
          alightStopOrder: alightOrder,
          fareAmount: fareAmount,
          offlineReceipt: offCode,
        });
        await refreshPendingWalkins();
        setSuccessMsg(`📶 Offline Mode: Ticket #${offCode} queued locally in device memory. Will auto-sync when network reconnects.`);
        setShowWalkinModal(false);
      } catch (offErr) {
        setError(`Failed to save offline: ${errMsg(offErr)}`);
      } finally {
        setWalkinLoading(false);
      }
      return;
    }

    try {
      const res = await createWalkInBooking({
        trip_id: selectedTripId,
        seat_number: walkinSeat,
        board_stop_order: boardOrder,
        alight_stop_order: alightOrder,
        passenger_name: passengerName.trim() || 'Stage Passenger',
        passenger_phone: passengerPhone.trim() || '254700000000',
        fare_amount: fareAmount,
        notes: 'Walk-in cash collection at stage gate',
      });
      setSuccessMsg(`✓ Walk-in ticket issued for Seat #${res.seat_number} (Receipt: ${res.receipt_number}). SMS confirmation dispatched.`);
      setShowWalkinModal(false);
      await loadTripData();
    } catch (err) {
      // If network fails midway, fallback to queue
      try {
        const offCode = `OFF-${Date.now().toString().slice(-6)}`;
        await queueOfflineWalkin({
          tripId: selectedTripId,
          seatNumber: walkinSeat,
          passengerName: passengerName.trim() || 'Stage Walk-in',
          passengerPhone: passengerPhone.trim() || '254700000000',
          boardStopOrder: boardOrder,
          alightStopOrder: alightOrder,
          fareAmount: fareAmount,
          offlineReceipt: offCode,
        });
        await refreshPendingWalkins();
        setSuccessMsg(`Connection dropped. Ticket #${offCode} queued locally in device storage.`);
        setShowWalkinModal(false);
      } catch {
        setError(errMsg(err));
      }
    } finally {
      setWalkinLoading(false);
    }
  };

  // Handle End-of-trip Stage Reconciliation
  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    setReconciling(true);
    setError('');
    try {
      const res = await reconcileStageTrip({
        trip_id: selectedTripId,
        fuel_deduction: fuelDeduction,
        conductor_commission: conductorCommission,
        other_expenses: otherExpenses,
        notes,
      });
      setReconciliationResult(res);
      setSuccessMsg(`✓ 'Mshiko wa Stage' reconciliation logged! Net SACCO cash handed over: KES ${res.net_sacco_cash}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setReconciling(false);
    }
  };

  // Instant M-Pesa B2C Payout to Driver
  const handleDisburseB2C = async () => {
    if (!selectedTripId || conductorCommission <= 0) return;
    setB2cLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await disburseStagePayoutB2C({
        trip_id: selectedTripId,
        recipient_phone: b2cDriverPhone,
        recipient_name: b2cDriverName,
        amount: conductorCommission,
        payout_type: b2cPayoutType,
        reconciliation_id: reconciliationResult?.id,
        notes: `Stage Handover Payout for Trip #${selectedTripId}`,
      });
      setB2cResult(res);
      setSuccessMsg(`💸 KES ${res.amount} disbursed via Safaricom B2C (Ref: ${res.b2c_transaction_id}). SMS receipt dispatched!`);
    } catch (err) {
      setError(`B2C Disbursement failed: ${errMsg(err)}`);
    } finally {
      setB2cLoading(false);
    }
  };

  // Load Outbox SMS Logs
  const handleOpenOutbox = async () => {
    setShowOutboxModal(true);
    setOutboxLoading(true);
    try {
      const res = await fetchDispatchOutbox(30);
      setOutboxItems(res.outbox);
    } catch (err) {
      console.error(err);
    } finally {
      setOutboxLoading(false);
    }
  };

  const currentTrip = trips.find((t) => t.id === selectedTripId);

  const displayedPassengers =
    activeTab === 'cash'
      ? manifest?.cash_passengers ?? []
      : activeTab === 'mpesa'
      ? manifest?.mpesa_passengers ?? []
      : [...(manifest?.mpesa_passengers ?? []), ...(manifest?.cash_passengers ?? [])];

  const totalDeductions = fuelDeduction + conductorCommission + otherExpenses;
  const netCashHandover = Math.max(0, (manifest?.cash_total ?? 0) - totalDeductions);

  return (
    <main className="min-h-screen bg-[#07090e] text-slate-100 p-4 sm:p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">📋</span>
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-sky-300 to-emerald-400">
                Stage Dispatcher &amp; Walk-In Cash POS
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Terminal Stage Clerk Console &bull; Walk-In Seat Booking &bull; End-of-Trip Cash Reconciler (&quot;Mshiko wa Stage&quot;)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Online / Offline Dead-Zone Badge */}
            <span
              className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 transition-all ${
                isOnline
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {isOnline ? 'Stage Online' : 'Dead Zone Offline'}
            </span>

            {/* Offline Pending Walk-in Sync Trigger */}
            {pendingWalkins.length > 0 && (
              <button
                type="button"
                disabled={isSyncing || !isOnline}
                onClick={handleSyncOfflineWalkins}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>⚡</span>
                {isSyncing ? 'Syncing...' : `Sync (${pendingWalkins.length}) Offline`}
              </button>
            )}

            {/* Outbox SMS Logs Modal Trigger */}
            <button
              type="button"
              onClick={handleOpenOutbox}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-sky-300 border border-slate-700 transition flex items-center gap-1.5"
            >
              <span>📨</span> Outbox SMS Logs
            </button>

            <Link
              href="/driver"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              Driver Console &rarr;
            </Link>
            <Link
              href="/admin"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              Admin HQ &rarr;
            </Link>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-2xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 p-3.5 rounded-2xl bg-emerald-950/70 border border-emerald-500 text-emerald-300 text-xs flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}
      </div>

      {/* Stage Marshall FIFO Loading Bay Lineup */}
      <div className="max-w-7xl mx-auto mb-8">
        <StageQueueRoster onTripSelected={(id) => setSelectedTripId(id)} />
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Trip Selector + Quick Walk-in Tap Blueprint */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trip Selector Bar */}
          <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Select Scheduled Departure Trip
            </label>
            <select
              value={selectedTripId}
              onChange={(e) => setSelectedTripId(Number(e.target.value))}
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-2xl text-sm font-bold text-white focus:outline-none focus:border-amber-400"
            >
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} &bull; {t.route_name} &bull; {t.plate_number || 'Fleet Unit'} ({t.status.toUpperCase()})
                </option>
              ))}
            </select>

            {manifest && (
              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Capacity</span>
                  <span className="text-lg font-black text-white font-mono">{manifest.total_seats} Seats</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Booked</span>
                  <span className="text-lg font-black text-emerald-400 font-mono">
                    {manifest.filled_seats} ({manifest.total_seats > 0 ? Math.round((manifest.filled_seats / manifest.total_seats) * 100) : 0}%)
                  </span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Available Seats</span>
                  <span className="text-lg font-black text-amber-400 font-mono">{manifest.empty_seats.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* Rapid Touch Seat Selector Grid */}
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Seat Status &bull; Quick Touch POS
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tap an empty seat to immediately issue a walk-in cash ticket
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-emerald-500/20 border border-emerald-500" />
                  Available
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-amber-500 border border-amber-400" />
                  Walk-In Cash
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-cyan-600 border border-cyan-400" />
                  Online App
                </span>
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-500 text-xs">Loading seat status...</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5 pt-2">
                {Array.from({ length: manifest?.total_seats ?? 14 }, (_, i) => i + 1).map((seat) => {
                  const cashPax = manifest?.cash_passengers.find((p) => p.seat_number === seat);
                  const appPax = manifest?.mpesa_passengers.find((p) => p.seat_number === seat);
                  const isBooked = Boolean(cashPax || appPax);

                  return (
                    <button
                      key={seat}
                      type="button"
                      disabled={isBooked}
                      onClick={() => {
                        setWalkinSeat(seat);
                        setShowWalkinModal(true);
                      }}
                      className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center min-h-[72px] ${
                        cashPax
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                          : appPax
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                          : 'bg-slate-950 border-slate-800 hover:border-emerald-500 hover:bg-emerald-500/10 text-slate-300 cursor-pointer active:scale-95 shadow-sm'
                      }`}
                      title={
                        cashPax
                          ? `Seat #${seat}: ${cashPax.passenger_name} (Cash Walk-In)`
                          : appPax
                          ? `Seat #${seat}: ${appPax.passenger_name} (App Passenger)`
                          : `Seat #${seat}: Free — Tap to Issue Walk-In Ticket`
                      }
                    >
                      <span className="text-xs font-mono font-black">#{seat}</span>
                      <span className="text-[10px] mt-1 truncate max-w-full">
                        {cashPax ? '💵 Cash' : appPax ? '📱 App' : '+ Cash'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Passenger Manifest Categorized View */}
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-800">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Live Departure Passenger Manifest
              </h3>
              <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({manifest?.filled_seats ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('cash')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === 'cash' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Stage Cash ({manifest?.cash_passengers.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('mpesa')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    activeTab === 'mpesa' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  App M-Pesa ({manifest?.mpesa_passengers.length ?? 0})
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {displayedPassengers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No passengers in this manifest view.</div>
              ) : (
                displayedPassengers.map((p) => (
                  <div
                    key={`${p.seat_number}-${p.passenger_name}`}
                    className="p-3 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center font-mono font-black text-amber-400">
                        #{p.seat_number}
                      </span>
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>{p.passenger_name}</span>
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                              p.payment_provider === 'cash'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-cyan-500/20 text-cyan-300'
                            }`}
                          >
                            {p.payment_provider === 'cash' ? 'Cash Walk-In' : 'App M-Pesa'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {p.board_stop || 'Stage'} &rarr; {p.alight_stop || 'Destination'} &bull; {p.passenger_phone || 'No phone'}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <span className="font-bold text-emerald-400 block">KES {p.amount}</span>
                      <span className="text-[10px] text-slate-500">{p.receipt_number || 'STG-CASH'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: "Mshiko wa Stage" End-of-Trip Cash Reconciler & B2C Payouts */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
            <div className="pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">💰</span>
                <h3 className="text-sm font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-emerald-400">
                  Mshiko wa Stage
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                End-of-Trip Cash Reconciliation &amp; Commission Payout
              </p>
            </div>

            {/* Stage Totals Card */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Physical Cash Collected:</span>
                <span className="font-mono font-black text-amber-400">KES {manifest?.cash_total ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Digital M-Pesa Total:</span>
                <span className="font-mono font-black text-cyan-400">KES {manifest?.mpesa_total ?? 0}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800 font-bold">
                <span className="text-slate-300">Total Trip Revenue:</span>
                <span className="font-mono font-black text-emerald-400">KES {manifest?.total_collections ?? 0}</span>
              </div>
            </div>

            {/* Reconciliation Form */}
            <form onSubmit={handleReconcile} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  ⛽ Fuel Station Deductions (KES)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={fuelDeduction}
                  onChange={(e) => setFuelDeduction(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  🧑‍✈️ Conductor &amp; Driver Allowance / Commission (KES)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={conductorCommission}
                  onChange={(e) => setConductorCommission(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  🏛️ Stage Council &amp; Parking Fees (KES)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={otherExpenses}
                  onChange={(e) => setOtherExpenses(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Handover Notes / Stage Remarks
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              {/* Net Cash Handover Result */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 to-slate-950 border border-emerald-500/50 text-center">
                <span className="text-[10px] font-black uppercase text-emerald-400 block tracking-wider">
                  Net SACCO Cash Handover
                </span>
                <span className="text-2xl font-black font-mono text-white mt-1 block">
                  KES {netCashHandover}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  (Gross Cash KES {manifest?.cash_total ?? 0} &minus; Total Deductions KES {totalDeductions})
                </span>
              </div>

              <button
                type="submit"
                disabled={reconciling || !selectedTripId}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-emerald-600 hover:from-amber-400 hover:to-emerald-500 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider transition shadow-lg shadow-amber-900/40 disabled:opacity-50"
              >
                {reconciling ? 'Logging Handover...' : '📝 Save Handover Ledger'}
              </button>
            </form>

            {reconciliationResult && (
              <div className="p-3.5 bg-emerald-950/80 border border-emerald-500 rounded-2xl text-xs text-emerald-200">
                <span className="font-bold block">✓ Handover Ledger #{reconciliationResult.id} Registered</span>
                <span className="text-[10px] text-slate-300 block mt-1">
                  Time: {new Date(reconciliationResult.reconciled_at).toLocaleTimeString()}
                </span>
              </div>
            )}

            {/* Instant M-Pesa B2C Automated Stage Payout */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 space-y-3 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-black uppercase text-emerald-400 flex items-center gap-1.5">
                    <span>💸</span> M-Pesa B2C Driver Payout
                  </h5>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Disburse allowance directly to mobile wallet
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-bold border border-emerald-500/30">
                  Instant B2C
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-400 mb-1">Driver Phone</label>
                  <input
                    type="text"
                    value={b2cDriverPhone}
                    onChange={(e) => setB2cDriverPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono"
                    placeholder="2547..."
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-400 mb-1">Driver Name</label>
                  <input
                    type="text"
                    value={b2cDriverName}
                    onChange={(e) => setB2cDriverName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                    placeholder="James Mwangi"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase text-slate-400 mb-1">Payout Purpose</label>
                <select
                  value={b2cPayoutType}
                  onChange={(e) => setB2cPayoutType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="conductor_commission">Conductor &amp; Driver Allowance</option>
                  <option value="driver_float">Driver Petty Float</option>
                  <option value="fuel_deduction">Fuel Float Re-imbursement</option>
                  <option value="sacco_surplus">SACCO Daily Surplus</option>
                </select>
              </div>

              <button
                type="button"
                disabled={b2cLoading || conductorCommission <= 0}
                onClick={handleDisburseB2C}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {b2cLoading ? 'Processing B2C Disbursement...' : `💸 Disburse KES ${conductorCommission} to Driver (B2C)`}
              </button>

              {b2cResult && (
                <div className="p-3 bg-emerald-950/80 border border-emerald-500 rounded-xl text-xs space-y-1 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-300">✓ Disbursed via Safaricom B2C</span>
                    <span className="font-mono font-bold text-emerald-400">{b2cResult.b2c_transaction_id}</span>
                  </div>
                  <div className="text-[10px] text-slate-300">
                    KES {b2cResult.amount} sent to {b2cResult.recipient_phone} ({b2cResult.sacco_name})
                  </div>
                  <div className="text-[10px] text-emerald-400 font-semibold">
                    SMS receipt delivered to driver mobile wallet.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Walk-in Cash Booking Modal */}
      {showWalkinModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-emerald-500/50 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h4 className="text-base font-black text-white">Issue Stage Cash Ticket</h4>
                <span className="text-xs text-amber-400 font-mono font-bold">Seat #{walkinSeat} &bull; {currentTrip?.name}</span>
              </div>
              <button onClick={() => setShowWalkinModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleWalkinBooking} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Passenger Name
                </label>
                <input
                  type="text"
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Passenger Phone (For SMS Ticket)
                </label>
                <input
                  type="text"
                  value={passengerPhone}
                  onChange={(e) => setPassengerPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-cyan-400"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Pickup Stop
                  </label>
                  <select
                    value={boardOrder}
                    onChange={(e) => setBoardOrder(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-xs text-white"
                  >
                    {stops.map((s) => (
                      <option key={s.id} value={s.stop_order}>
                        {s.stop_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                    Dropoff Stop
                  </label>
                  <select
                    value={alightOrder}
                    onChange={(e) => setAlightOrder(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-xs text-white"
                  >
                    {stops.map((s) => (
                      <option key={s.id} value={s.stop_order}>
                        {s.stop_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Cash Fare Collected (KES)
                </label>
                <input
                  type="number"
                  min={50}
                  step={10}
                  value={fareAmount}
                  onChange={(e) => setFareAmount(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-black font-mono text-emerald-400"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={walkinLoading}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition mt-2 shadow-lg shadow-emerald-950/40"
              >
                {walkinLoading ? 'Printing POS Receipt...' : isOnline ? '🖨️ Receive Cash & Issue Ticket' : '📶 Queue Offline Cash Ticket'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Dispatches Outbox SMS Logs Modal */}
      {showOutboxModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-3xl bg-slate-900 border border-sky-500/40 rounded-3xl p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">📨</span>
                <h4 className="text-base font-black text-white uppercase tracking-wider">
                  Outbox SMS &amp; WhatsApp Audit Logs
                </h4>
              </div>
              <button onClick={() => setShowOutboxModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-2.5 pr-1">
              {outboxLoading ? (
                <div className="p-8 text-center text-xs text-slate-400 animate-pulse">Loading dispatch outbox...</div>
              ) : outboxItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No dispatches logged in outbox yet.</div>
              ) : (
                outboxItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sky-400">{item.recipient}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] uppercase font-bold text-slate-300">
                          {item.channel}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                          ✓ {item.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 font-mono line-clamp-2">{item.message_body}</p>
                    </div>

                    <div className="text-right text-[10px] text-slate-500 font-mono shrink-0">
                      <div>Ref: {item.provider_reference || 'N/A'}</div>
                      <div>{item.created_at ? new Date(item.created_at).toLocaleTimeString() : ''}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
