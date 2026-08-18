'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fetchTrips, fetchTripStops, fetchBookedSeats, bookSeatData, errMsg, TripOption, TripStop } from '@/services/api';

export default function BookingPage() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [tripId, setTripId] = useState<number>(0);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [boardStop, setBoardStop] = useState<number>(1);
  const [alightStop, setAlightStop] = useState<number>(4);
  const [bookedSeats, setBookedSeats] = useState<number[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Load available trips and preselect the first one.
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

  // Load stops + availability when the trip changes.
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
    return fetchBookedSeats(tripId, boardStop, alightStop)
      .then((data) => setBookedSeats(data.booked_seats))
      .catch((err: unknown) => setError(errMsg(err)));
  }, [tripId, boardStop, alightStop]);

  useEffect(() => {
    refreshSeats();
  }, [refreshSeats]);

  const handleBooking = async () => {
    if (!selectedSeat) return;
    try {
      const res = await bookSeatData({
        trip_id: tripId,
        seat_number: selectedSeat,
        board_stop_order: boardStop,
        alight_stop_order: alightStop,
      });
      setMessage(res.message);
      const updated = await fetchBookedSeats(tripId, boardStop, alightStop);
      setBookedSeats(updated.booked_seats);
      setSelectedSeat(null);
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-8 flex items-center justify-center">
      <div className="max-w-3xl w-full space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-800 p-4 rounded-3xl border border-slate-700">
          <div>
            <h1 className="text-3xl font-black text-emerald-400 mb-1">BUSGO</h1>
            <p className="text-sm text-slate-400">Dynamic Partial-Segment Transit System (Kenya Fleet)</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/user" className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-500 hover:text-emerald-300">
              User Dashboard
            </Link>
            <Link href="/driver" className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-500 hover:text-cyan-300">
              Driver Dashboard
            </Link>
            <Link href="/admin" className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-blue-500 hover:text-blue-300">
              Admin Dashboard
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-400">
              Sign In
            </Link>
          </div>
        </div>

        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
          {error && <p className="text-rose-400 text-xs font-bold mb-4">{error}</p>}

          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Select Trip</label>
            <select
              value={tripId}
              onChange={(e) => setTripId(Number(e.target.value))}
              className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium focus:outline-none focus:border-emerald-500"
            >
              {trips.length === 0 && <option value={0}>Loading trips…</option>}
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.route_name} ({t.plate_number ?? 'no vehicle'}, {t.seat_capacity ?? '?'} seats) · {t.status}
                </option>
              ))}
            </select>
            {currentTrip && (
              <p className="text-xs text-slate-400 mt-2">
                Route: <span className="text-emerald-300 font-semibold">{currentTrip.route_name}</span>
                {currentTrip.scheduled_at && (
                  <> · Departs: <span className="text-emerald-300 font-semibold">{new Date(currentTrip.scheduled_at).toLocaleString()}</span></>
                )}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Boarding Stop</label>
              <select
                value={boardStop}
                onChange={(e) => setBoardStop(Number(e.target.value))}
                className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium focus:outline-none focus:border-emerald-500"
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
                onChange={(e) => setAlightStop(Number(e.target.value))}
                className="w-full p-3 border border-slate-600 rounded-xl bg-slate-900 text-white font-medium focus:outline-none focus:border-emerald-500"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.stop_order}>
                    {s.stop_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {boardStop >= alightStop && (
            <p className="text-rose-400 text-xs font-bold mb-4">
              ⚠️ Alighting stop must be further down the route than boarding.
            </p>
          )}

          <h3 className="font-bold text-slate-300 mb-3">
            Seating Grid ({currentTrip?.seat_capacity ?? 14}-Seater)
          </h3>
          <div className="grid grid-cols-4 gap-3 mb-6">
            {Array.from({ length: currentTrip?.seat_capacity ?? 14 }, (_, i) => i + 1).map((seatNum) => {
              const isBooked = bookedSeats.includes(seatNum);
              const isSelected = selectedSeat === seatNum;

              let style = 'bg-emerald-600 hover:bg-emerald-500 text-white';
              if (isBooked) style = 'bg-rose-600 text-white cursor-not-allowed opacity-50';
              if (isSelected) style = 'bg-amber-500 text-slate-900 font-black ring-4 ring-amber-300';

              return (
                <button
                  key={seatNum}
                  disabled={isBooked || boardStop >= alightStop}
                  onClick={() => setSelectedSeat(seatNum)}
                  className={`p-4 rounded-xl font-bold transition-all ${style}`}
                >
                  {seatNum}
                </button>
              );
            })}
          </div>

          {selectedSeat && (
            <button
              onClick={handleBooking}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg transition-all"
            >
              Confirm & Pay for Seat #{selectedSeat}
            </button>
          )}

          {message && <p className="mt-4 text-center font-semibold text-emerald-400">{message}</p>}
        </div>
      </div>
    </main>
  );
}
