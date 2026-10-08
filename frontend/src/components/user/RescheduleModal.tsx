'use client';

import React, { useState, useEffect } from 'react';
import {
  Booking,
  TripOption,
  fetchTrips,
  fetchBookedSeats,
  rescheduleBooking,
  RescheduleBookingResponse,
  errMsg,
} from '@/services/api';

interface RescheduleModalProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (res: RescheduleBookingResponse) => void;
}

export default function RescheduleModal({
  booking,
  isOpen,
  onClose,
  onSuccess,
}: RescheduleModalProps) {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [bookedSeats, setBookedSeats] = useState<number[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmTopup, setConfirmTopup] = useState(false);
  const [requiresTopupInfo, setRequiresTopupInfo] = useState<{
    amount: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !booking) return;
    setError('');
    setConfirmTopup(false);
    setRequiresTopupInfo(null);
    setSelectedSeat(null);
    setSelectedTripId(null);

    setLoadingTrips(true);
    fetchTrips()
      .then((res) => {
        // Filter out the current trip and cancelled/completed trips
        const eligible = (res.trips || []).filter(
          (t) =>
            t.id !== booking.trip_id &&
            t.status !== 'cancelled' &&
            t.status !== 'completed'
        );
        setTrips(eligible);
        if (eligible.length > 0) {
          setSelectedTripId(eligible[0].id);
        }
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoadingTrips(false));
  }, [isOpen, booking]);

  useEffect(() => {
    if (!selectedTripId || !booking) return;
    setLoadingSeats(true);
    setSelectedSeat(null);
    setRequiresTopupInfo(null);

    fetchBookedSeats(
      selectedTripId,
      booking.board_stop_order ?? 1,
      booking.alight_stop_order ?? 2
    )
      .then((res) => {
        setBookedSeats(res.booked_seats || []);
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoadingSeats(false));
  }, [selectedTripId, booking]);

  if (!isOpen || !booking) return null;

  const currentTripSelected = trips.find((t) => t.id === selectedTripId);
  const seatCapacity = currentTripSelected?.seat_capacity || 14;
  const availableSeats = Array.from({ length: seatCapacity }, (_, i) => i + 1).filter(
    (s) => !bookedSeats.includes(s)
  );

  const handleConfirm = async () => {
    if (!selectedTripId || !selectedSeat) {
      setError('Please select both a new trip and an available seat.');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const res = await rescheduleBooking(booking.id, {
        new_trip_id: selectedTripId,
        new_seat_number: selectedSeat,
        new_board_stop_order: booking.board_stop_order,
        new_alight_stop_order: booking.alight_stop_order,
        confirm_topup: confirmTopup,
      });

      if (res.requires_topup && !confirmTopup) {
        setRequiresTopupInfo({
          amount: res.topup_amount || 0,
          message: res.message || 'Fare top-up required to switch to this trip.',
        });
        setConfirmTopup(true);
        setSubmitting(false);
        return;
      }

      onSuccess(res);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0f1422] p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div>
            <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              Commuter Self-Service
            </span>
            <h2 className="text-xl font-bold text-white mt-1">Reschedule Your Ride</h2>
            <p className="text-xs text-slate-400">
              Transfer ticket <span className="font-mono text-cyan-300">#{booking.id}</span> (Seat #{booking.seat_number}) to another scheduled departure.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Current Ride Summary */}
        <div className="mb-5 rounded-xl border border-slate-800 bg-[#141a2c] p-4 text-xs">
          <p className="text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">Current Booking</p>
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div>
              <p className="text-white font-bold text-sm">{booking.route_name}</p>
              <p className="text-slate-400">{booking.board_stop ?? 'Origin'} → {booking.alight_stop ?? 'Destination'}</p>
            </div>
            <div className="text-right">
              <span className="inline-block px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                Seat #{booking.seat_number}
              </span>
              <p className="text-slate-500 text-[10px] mt-0.5">{booking.trip_name}</p>
            </div>
          </div>
        </div>

        {/* Step 1: Select Destination Trip */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            1. Select Replacement Departure
          </label>
          {loadingTrips ? (
            <div className="p-4 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl">
              Loading available scheduled trips…
            </div>
          ) : trips.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl">
              No alternative trips currently scheduled on this corridor.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {trips.map((t) => {
                const isSelected = t.id === selectedTripId;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTripId(t.id)}
                    className={`cursor-pointer rounded-xl p-3 border transition flex items-center justify-between text-xs ${
                      isSelected
                        ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                        : 'border-slate-800 bg-[#141a2c] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <p className="font-bold">{t.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {t.plate_number || 'Fleet Vehicle'} · {t.route_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-cyan-300">
                        {t.fixed_price ? `KES ${t.fixed_price}` : 'Corridor Fare'}
                      </span>
                      <p className="text-[10px] text-slate-500">
                        {t.scheduled_at ? new Date(t.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 2: Select New Seat */}
        {selectedTripId && (
          <div className="mb-5">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-slate-300">
                2. Choose New Seat
              </label>
              <span className="text-[11px] text-slate-400">
                {availableSeats.length} seats free on this segment
              </span>
            </div>

            {loadingSeats ? (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl">
                Checking seat availability…
              </div>
            ) : availableSeats.length === 0 ? (
              <div className="p-4 text-center text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                This vehicle is completely full for your route segment. Please select another departure.
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {Array.from({ length: seatCapacity }, (_, i) => i + 1).map((sNum) => {
                  const isBooked = bookedSeats.includes(sNum);
                  const isChosen = selectedSeat === sNum;
                  return (
                    <button
                      key={sNum}
                      disabled={isBooked}
                      onClick={() => setSelectedSeat(sNum)}
                      className={`h-11 rounded-lg text-xs font-mono font-bold flex flex-col items-center justify-center transition border ${
                        isBooked
                          ? 'border-slate-800/40 bg-slate-900/40 text-slate-600 cursor-not-allowed'
                          : isChosen
                          ? 'border-cyan-400 bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                          : 'border-slate-800 bg-[#161c30] text-slate-300 hover:border-cyan-500/40 hover:bg-slate-800'
                      }`}
                    >
                      <span>#{sNum}</span>
                      <span className="text-[9px] font-sans font-normal opacity-70">
                        {isBooked ? 'Taken' : 'Free'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Top-up Confirmation Notice */}
        {requiresTopupInfo && (
          <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
            <p className="font-bold text-amber-300">Fare Top-up Required</p>
            <p className="mt-1">{requiresTopupInfo.message}</p>
            <p className="mt-2 text-white font-mono font-bold">
              Top-up difference: KES {requiresTopupInfo.amount.toLocaleString()}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="confirmTopupCheck"
                checked={confirmTopup}
                onChange={(e) => setConfirmTopup(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded"
              />
              <label htmlFor="confirmTopupCheck" className="text-xs text-slate-300 cursor-pointer">
                I agree to pay the top-up difference to confirm this reschedule.
              </label>
            </div>
          </div>
        )}

        {/* Reschedule Financial Rules Alert */}
        <div className="mb-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] text-slate-400 space-y-1">
          <p className="text-cyan-300 font-semibold">Automatic Travel Credit Guarantee:</p>
          <p>• If new fare is equal: Immediate 0-cost transfer.</p>
          <p>• If new trip is cheaper: Fare difference is credited instantly as a 90-day Travel Voucher.</p>
          <p>• Original seat is immediately unlocked for corridor relay & waitlist passengers.</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !selectedTripId || !selectedSeat || (requiresTopupInfo !== null && !confirmTopup)}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition shadow-lg shadow-cyan-500/20"
          >
            {submitting ? 'Transferring Seat…' : confirmTopup ? 'Confirm Top-up & Reschedule' : 'Reschedule Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
