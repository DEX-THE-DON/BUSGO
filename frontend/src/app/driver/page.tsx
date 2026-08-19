'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import RequireRole from '@/components/RequireRole';
import SeatGrid, { SeatState } from '@/components/SeatGrid';
import ChainView from '@/components/ChainView';
import NotificationsBell from '@/components/NotificationsBell';
import { useAuth } from '@/context/AuthContext';
import {
  fetchTripStops,
  fetchSeatMap,
  fetchTripChains,
  bookSeatData,
  payMpesa,
  fetchDriverTrips,
  fetchManifest,
  updateTripStatus,
  setCurrentStop,
  TripRow,
  ManifestEntry,
  TripStop,
  ChainLink,
  errMsg,
} from '@/services/api';

const TRIP_STATUSES = ['scheduled', 'boarding', 'in_transit', 'completed'];

export default function DriverPage() {
  const { user, logout } = useAuth();

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [tripId, setTripId] = useState<number>(0);
  const [tripStatus, setTripStatus] = useState<string>('scheduled');
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(4);
  const [seatStates, setSeatStates] = useState<Record<number, SeatState>>({});
  const [chains, setChains] = useState<{ seat_number: number; links: ChainLink[] }[]>([]);
  const [currentStop, setCurrentStopVal] = useState<number | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [showMpesaModal, setShowMpesaModal] = useState<boolean>(false);
  const [isPaying, setIsPaying] = useState<boolean>(false);

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  // Load the driver's assigned trips (or all trips, for admins).
  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchDriverTrips()
        .then((data) => {
          setTrips(data.trips);
          if (data.trips.length > 0) setTripId(data.trips[0].id);
        })
        .catch((err: unknown) => setError(errMsg(err)));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const loadTrip = useCallback(
    (id: number) => {
      if (!id) return;
      Promise.all([
        fetchTripStops(id),
        fetchManifest(id),
        fetchSeatMap(id, boardStop, alightStop),
        fetchTripChains(id),
      ])
        .then(([stopsRes, manifestRes, mapRes, chainsRes]) => {
          setStops(stopsRes.stops);
          setManifest(manifestRes.manifest);
          const states: Record<number, SeatState> = {};
          mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
          setSeatStates(states);
          setChains(chainsRes.chains);
          setError('');
        })
        .catch((err: unknown) => setError(errMsg(err)));
    },
    [boardStop, alightStop],
  );

  // When the selected trip changes, load its stops / manifest / seats.
  useEffect(() => {
    loadTrip(tripId);
  }, [tripId, loadTrip]);

  const currentTrip = trips.find((t) => t.id === tripId);
  const isDirect = currentTrip?.route_type === 'direct';
  const selectedChain = chains.find((c) => c.seat_number === selectedSeat);

  // Refresh seat states when board/alight segment changes.
  useEffect(() => {
    if (boardStop < alightStop && tripId) {
      fetchSeatMap(tripId, boardStop, alightStop)
        .then((mapRes) => {
          const states: Record<number, SeatState> = {};
          mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
          setSeatStates(states);
        })
        .catch((err: unknown) => setError(errMsg(err)));
    }
  }, [boardStop, alightStop, tripId]);

  // WebSocket listener for live seat updates on the selected trip.
  useEffect(() => {
    if (!tripId) return;
    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/trip/${tripId}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'seat_booked' && data.trip_id === tripId) {
          fetchSeatMap(tripId, boardStop, alightStop)
            .then((mapRes) => {
              const states: Record<number, SeatState> = {};
              mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
              setSeatStates(states);
            });
          fetchTripChains(tripId).then((res) => setChains(res.chains));
          fetchManifest(tripId).then((res) => setManifest(res.manifest));
        }
        if (data.event === 'trip_status' && data.trip_id === tripId) {
          setTripStatus(data.status);
          showNotice(`Trip status updated: ${data.status}`);
        }
        if (data.event === 'seat_freed' && data.trip_id === tripId) {
          showNotice(`Seat #${data.seat_number} freed at ${data.stop_name ?? `stop ${data.stop_order}`}`);
          fetchSeatMap(tripId, boardStop, alightStop)
            .then((mapRes) => {
              const states: Record<number, SeatState> = {};
              mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
              setSeatStates(states);
            });
          fetchTripChains(tripId).then((res) => setChains(res.chains));
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      ws.close();
    };
  }, [tripId, boardStop, alightStop]);

  const handleChangeStatus = async (next: string) => {
    if (!tripId || next === tripStatus) return;
    try {
      await updateTripStatus(tripId, next);
      setTripStatus(next);
      showNotice(`Trip #${tripId} is now ${next}.`);
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleCurrentStop = async (stopOrder: number) => {
    if (!tripId || stopOrder === currentStop) return;
    try {
      const res = await setCurrentStop(tripId, stopOrder);
      setCurrentStopVal(stopOrder);
      showNotice(
        `Bus is at stop #${stopOrder} — ${res.released_seats} seat(s) released.` +
          (res.released_seats > 0 ? ' Next passengers have been notified.' : ''),
      );
      const chainsRes = await fetchTripChains(tripId);
      setChains(chainsRes.chains);
    } catch (err: unknown) {
      setError(errMsg(err));
    }
  };

  const handleBookingTrigger = () => {
    if (!selectedSeat) return;
    setShowMpesaModal(true);
  };

  const confirmMpesaPayment = async () => {
    if (!selectedSeat || isPaying) return;
    setIsPaying(true);
    setMessage('');
    try {
      // 1. Create the booking FIRST, then pay for the returned booking_id.
      const bookingRes = await bookSeatData({
        trip_id: tripId,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
      });
      const bookingId = bookingRes.booking_id;

      // 2. Simulated M-Pesa STK push for that exact booking.
      const paymentRes = await fetch('http://127.0.0.1:8000/api/pay/mpesa-stk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, amount: 500, booking_id: bookingId }),
      });
      const paymentData = await paymentRes.json();
      if (!paymentRes.ok) {
        throw new Error(paymentData.detail || `Payment failed (HTTP ${paymentRes.status})`);
      }

      setMessage(`${paymentData.message} | Booking #${bookingId} confirmed.`);
      setShowMpesaModal(false);
      setSelectedSeat(null);

      const mapRes = await fetchSeatMap(tripId, boardStop, alightStop);
      const states: Record<number, SeatState> = {};
      mapRes.seats.forEach((s) => (states[s.seat_number] = s.state));
      setSeatStates(states);
      const manifestRes = await fetchManifest(tripId);
      setManifest(manifestRes.manifest);
      const chainsRes = await fetchTripChains(tripId);
      setChains(chainsRes.chains);
    } catch (err: unknown) {
      setMessage(errMsg(err) || 'Booking/payment failed');
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <RequireRole roles={['driver', 'admin']}>
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex justify-between items-center">
            <div>
              <span className="bg-cyan-500/10 text-cyan-300 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Driver Dashboard
              </span>
              <h1 className="text-3xl font-black mt-2">Trips &amp; Manifest</h1>
              <p className="text-slate-400 text-sm">{user?.full_name} — BUSGO Fleet</p>
            </div>
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <Link href="/" className="text-sm text-slate-400 hover:text-emerald-300 font-semibold">
                Home
              </Link>
              <button
                onClick={logout}
                className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl font-bold text-slate-300"
              >
                Logout
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {notice && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold rounded-xl px-4 py-3">
              {notice}
            </div>
          )}

          {trips.length === 0 ? (
            <div className="bg-slate-900 p-10 rounded-2xl border border-slate-800 text-center">
              <p className="text-slate-400 mb-3">No trips assigned to you yet.</p>
              <Link href="/admin" className="text-emerald-400 font-bold hover:underline">
                Ask an admin to assign you a trip →
              </Link>
            </div>
          ) : (
            <>
              {/* Trip selector + status */}
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="flex-1 min-w-[260px]">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Assigned Trips</label>
                    <select
                      value={tripId}
                      onChange={(e) => setTripId(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.id} · {t.name} — {t.route_name} ({t.plate_number ?? 'no vehicle'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Trip Status</label>
                    <div className="flex flex-wrap gap-2">
                      {TRIP_STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleChangeStatus(s)}
                          disabled={s === tripStatus}
                          className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition ${
                            s === tripStatus
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Current status:{' '}
                  <span className="text-cyan-300 font-bold capitalize">{currentTrip?.status ?? tripStatus}</span>
                </p>
                {/* Relay control: report which stop the bus is at */}
                {!isDirect && stops.length > 0 && (
                  <div className="mt-5 border-t border-slate-800 pt-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                      🚍 Bus is now at stop (releases seats + notifies the next passenger in the chain)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {stops.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleCurrentStop(s.stop_order)}
                          disabled={s.stop_order === currentStop}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                            s.stop_order === currentStop
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {s.stop_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Manifest */}
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Passenger Manifest — {manifest.length} booking{manifest.length === 1 ? '' : 's'}
                </h3>
                {manifest.length === 0 ? (
                  <p className="text-slate-500 text-sm">No passengers booked yet on this trip.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-400 uppercase text-xs">
                          <th className="pb-3">Seat</th>
                          <th className="pb-3">Passenger</th>
                          <th className="pb-3">Phone</th>
                          <th className="pb-3">Boarding</th>
                          <th className="pb-3">Alighting</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.map((m) => (
                          <tr key={m.seat_number} className="border-t border-slate-800">
                            <td className="py-3 font-black text-cyan-300">#{m.seat_number}</td>
                            <td className="py-3 font-semibold">{m.full_name ?? 'Walk-up / Unregistered'}</td>
                            <td className="py-3 text-slate-300">{m.phone ?? '—'}</td>
                            <td className="py-3 text-slate-300">{m.board_stop ?? `Stop ${m.board_stop_order}`}</td>
                            <td className="py-3 text-slate-300">{m.alight_stop ?? `Stop ${m.alight_stop_order}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Walk-up seat booking */}
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Book Walk-up Passenger — {currentTrip?.name}
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Boarding Stop</label>
                    <select
                      value={boardStop}
                      onChange={(e) => setBoardStop(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {stops.map((s) => (
                        <option key={s.id} value={s.stop_order}>{s.stop_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Alighting Stop</label>
                    <select
                      value={alightStop}
                      onChange={(e) => setAlightStop(Number(e.target.value))}
                      className="w-full p-3 border border-slate-700 rounded-xl bg-slate-950 text-white font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {stops.map((s) => (
                        <option key={s.id} value={s.stop_order}>{s.stop_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {boardStop >= alightStop && (
                  <p className="text-rose-400 text-xs font-bold mb-4">⚠️ Alighting stop must be further down the route than boarding.</p>
                )}

                <h4 className="font-bold text-slate-300 mb-3">
                  Seating Grid ({currentTrip?.route_type === 'direct' ? 'Direct' : 'Stopwise'} · {currentTrip?.seat_capacity ?? 14}-seater
                  {currentTrip?.is_electric ? ' · ⚡ Electric' : ''})
                </h4>
                <SeatGrid
                  seatCapacity={currentTrip?.seat_capacity ?? 14}
                  seatLayout={currentTrip?.seat_layout}
                  seatStates={seatStates}
                  selectedSeat={selectedSeat}
                  onSelect={setSelectedSeat}
                  disabled={boardStop >= alightStop}
                />

                {selectedChain && (
                  <div className="mt-4 rounded-2xl bg-slate-950 border border-slate-700 p-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      🔗 Seat #{selectedSeat} relay chain
                    </p>
                    <ChainView seatNumber={selectedSeat ?? 0} links={selectedChain.links} />
                  </div>
                )}

                {selectedSeat && (
                  <button
                    onClick={handleBookingTrigger}
                    className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg transition-all"
                  >
                    Proceed to M-Pesa Checkout (Seat #{selectedSeat})
                  </button>
                )}

                {message && <p className="mt-4 text-center font-semibold text-emerald-400 text-sm">{message}</p>}

                {showMpesaModal && (
                  <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-md w-full">
                      <h3 className="text-xl font-bold text-emerald-400 mb-2">M-Pesa Express Checkout</h3>
                      <p className="text-slate-400 text-xs mb-4">
                        Enter the passenger&apos;s Safaricom number for an STK Push for seat #{selectedSeat}.
                      </p>
                      <input
                        type="text"
                        placeholder="2547XXXXXXXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full p-3 border border-slate-700 bg-slate-950 rounded-xl text-white mb-4 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowMpesaModal(false)}
                          disabled={isPaying}
                          className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-slate-300 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmMpesaPayment}
                          disabled={isPaying}
                          className="w-1/2 py-3 bg-emerald-500 hover:bg-emerald-400 font-bold rounded-xl text-slate-950 disabled:opacity-60"
                        >
                          {isPaying ? 'Processing…' : 'Pay KES 500'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </RequireRole>
  );
}