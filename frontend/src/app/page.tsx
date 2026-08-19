'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import SeatGrid, { SeatState } from '@/components/SeatGrid';
import ChainView from '@/components/ChainView';
import NotificationsBell from '@/components/NotificationsBell';
import {
  fetchTrips,
  fetchTripStops,
  fetchSeatMap,
  fetchTripChains,
  bookSeatData,
  payMpesa,
  payDarajaStk,
  createSeatInterest,
  errMsg,
  getToken,
  TripOption,
  TripStop,
  ChainLink,
} from '@/services/api';

export default function BookingPage() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [tripId, setTripId] = useState<number>(0);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(4);
  const [seatStates, setSeatStates] = useState<Record<number, SeatState>>({});
  const [chains, setChains] = useState<{ seat_number: number; links: ChainLink[] }[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Payment modal state
  const [pendingBooking, setPendingBooking] = useState<{ booking_id: number; seat: number } | null>(null);
  const [phone, setPhone] = useState<string>('2547');
  const [isPaying, setIsPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const authenticated = Boolean(getToken());

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetchTrips()
        .then((data) => {
          setTrips(data.trips);
          if (data.trips.length > 0) setTripId(data.trips[0].id);
        })
        .catch((err: unknown) => setError(errMsg(err)));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const currentTrip = trips.find((t) => t.id === tripId);
  const isDirect = currentTrip?.route_type === 'direct';
  const seatCapacity = currentTrip?.seat_capacity ?? 0;

  // Load stops when the trip changes.
  useEffect(() => {
    if (!tripId) return;
    fetchTripStops(tripId)
      .then((data) => {
        setStops(data.stops);
        if (data.stops.length > 0) {
          setBoardStop(data.stops[0].stop_order);
          setAlightStop(data.stops[data.stops.length - 1].stop_order);
        }
      })
      .catch((err: unknown) => setError(errMsg(err)));
  }, [tripId]);

  const refreshSeats = useCallback(() => {
    if (!tripId || boardStop >= alightStop) return;
    return Promise.all([fetchSeatMap(tripId, boardStop, alightStop), fetchTripChains(tripId)])
      .then(([map, chainsRes]) => {
        const states: Record<number, SeatState> = {};
        map.seats.forEach((s) => (states[s.seat_number] = s.state));
        setSeatStates(states);
        setChains(chainsRes.chains);
      })
      .catch((err: unknown) => setError(errMsg(err)));
  }, [tripId, boardStop, alightStop]);

  useEffect(() => {
    refreshSeats();
  }, [refreshSeats]);

  const handleBook = async () => {
    if (!selectedSeat) return;
    if (!authenticated) {
      setMessage('Please log in to book a seat.');
      return;
    }
    setError('');
    setMessage('');
    try {
      const res = await bookSeatData({
        trip_id: tripId,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
      });
      setPendingBooking({ booking_id: res.booking_id, seat: selectedSeat });
      setPaid(false);
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  };

  const confirmPayment = async () => {
    if (!pendingBooking || isPaying) return;
    setIsPaying(true);
    setError('');
    try {
      // Try the real Daraja STK push first; fall back to the simulator.
      try {
        await payDarajaStk({ booking_id: pendingBooking.booking_id, phone_number: phone, amount: 500 });
      } catch (err) {
        if (String(errMsg(err)).toLowerCase().includes('not configured')) {
          await payMpesa({ phone_number: phone, amount: 500, booking_id: pendingBooking.booking_id });
        } else {
          throw err;
        }
      }
      setPaid(true);
      setMessage(`Seat #${pendingBooking.seat} confirmed. You'll receive an STK prompt on ${phone}.`);
      setPendingBooking(null);
      refreshSeats();
      setSelectedSeat(null);
    } catch (err: unknown) {
      setMessage(errMsg(err) || 'Payment failed');
    } finally {
      setIsPaying(false);
    }
  };

  const handleWaitlist = async () => {
    if (!authenticated) {
      setMessage('Please log in to join the waitlist.');
      return;
    }
    try {
      await createSeatInterest({
        trip_id: tripId,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
        seat_number: selectedSeat,
      });
      setMessage(
        selectedSeat
          ? `We'll notify you when seat #${selectedSeat} frees up for your segment.`
          : `We'll notify you when any seat frees up for your segment.`,
      );
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  };

  const selectedChain = chains.find((c) => c.seat_number === selectedSeat);

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-800 p-4 rounded-3xl border border-slate-700">
          <div>
            <h1 className="text-3xl font-black text-emerald-400 mb-1">BUSGO</h1>
            <p className="text-sm text-slate-400">Relay Seat Booking · Kenya Fleet (Matatu / Bus / Coach / EV)</p>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            {authenticated ? (
              <Link
                href="/user"
                className="rounded-full border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-500 hover:text-emerald-300"
              >
                My Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950"
              >
                Log in to book
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl">
          <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Select Trip</label>
          <select
            value={tripId}
            onChange={(e) => setTripId(Number(e.target.value))}
            className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium mb-4 focus:outline-none focus:border-emerald-500"
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.route_name} ({t.route_type === 'direct' ? 'Direct' : 'Stopwise'})
                {t.is_electric ? ' ⚡EV' : ''} · {t.plate_number ?? 'no vehicle'}
              </option>
            ))}
          </select>

          {currentTrip && (
            <p className="text-sm text-slate-300 mb-4">
              <span className="text-emerald-300 font-semibold">{currentTrip.route_name}</span>
              {currentTrip.scheduled_at && (
                <>
                  {' '}
                  · Departs:{' '}
                  <span className="text-emerald-300 font-semibold">
                    {new Date(currentTrip.scheduled_at).toLocaleString()}
                  </span>
                </>
              )}
              {currentTrip.is_electric && (
                <span className="ml-2 text-xs font-bold bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full">
                  ⚡ Electric
                </span>
              )}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Boarding Stop</label>
              <select
                value={boardStop}
                disabled={isDirect}
                onChange={(e) => setBoardStop(Number(e.target.value))}
                className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    {s.stop_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Alighting Stop</label>
              <select
                value={alightStop}
                disabled={isDirect}
                onChange={(e) => setAlightStop(Number(e.target.value))}
                className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    {s.stop_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isDirect && (
            <p className="text-xs text-slate-500 mb-4">🚏 Direct route — origin → destination, no intermediate stops.</p>
          )}
          {boardStop >= alightStop && (
            <p className="text-rose-400 text-xs font-bold mb-4">
              ⚠️ Alighting stop must be further down the route than boarding.
            </p>
          )}

          <h3 className="font-bold text-slate-300 mb-3">
            Seating Grid ({currentTrip?.vehicle_type ?? 'bus'} · {seatCapacity}-seater)
          </h3>
          <SeatGrid
            seatCapacity={seatCapacity}
            seatLayout={currentTrip?.seat_layout}
            seatStates={seatStates}
            selectedSeat={selectedSeat}
            onSelect={setSelectedSeat}
            disabled={boardStop >= alightStop}
          />


          {selectedChain && (
            <div className="mt-5 rounded-2xl bg-slate-900 border border-slate-700 p-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                🔗 Seat #{selectedSeat} relay chain
              </p>
              <ChainView seatNumber={selectedSeat ?? 0} links={selectedChain.links} />
              {selectedChain.links.length > 1 && (
                <p className="text-xs text-emerald-400/80 mt-2">
                  This seat is handed between passengers along the route — you'll be notified when it frees up at your
                  stop.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {selectedSeat && !pendingBooking && (
              <button
                onClick={handleBook}
                disabled={boardStop >= alightStop}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg transition-all disabled:opacity-40"
              >
                Book Seat #{selectedSeat} & Pay
              </button>
            )}
            <button
              onClick={handleWaitlist}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl transition-all"
            >
              {selectedSeat ? `Notify me when seat #${selectedSeat} frees` : 'Join waitlist for this segment'}
            </button>
          </div>

          {message && <p className="mt-4 text-center font-semibold text-emerald-400">{message}</p>}
        </div>
      </div>

      {pendingBooking && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full">
            <h3 className="text-xl font-bold text-emerald-400 mb-2">M-Pesa Checkout — Seat #{pendingBooking.seat}</h3>
            <p className="text-slate-400 text-xs mb-4">
              Enter your Safaricom number to receive an STK push for KSh 500.
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
                onClick={() => setPendingBooking(null)}
                disabled={isPaying}
                className="w-1/2 py-3 bg-slate-800 hover:bg-slate-700 font-bold rounded-xl text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmPayment}
                disabled={isPaying}
                className="w-1/2 py-3 bg-emerald-500 hover:bg-emerald-400 font-bold rounded-xl text-slate-950 disabled:opacity-60"
              >
                {isPaying ? 'Sending push…' : paid ? 'Confirmed ✓' : 'Pay KSh 500'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

