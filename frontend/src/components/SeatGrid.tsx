'use client';

import React from 'react';

export type SeatState = 'free' | 'partial' | 'full';

interface SeatGridProps {
  seatCapacity: number;
  seatLayout?: { columns: number; rows: number[][] } | null;
  /** state per seat number (from /seat-map). Overrides bookedSeats. */
  seatStates?: Record<number, SeatState>;
  /** fallback: just the booked seat numbers (legacy /booked-seats). */
  bookedSeats?: number[];
  selectedSeat?: number | null;
  onSelect?: (seat: number) => void;
  disabled?: boolean;
  showLegend?: boolean;
}

/**
 * Bus/matatu seat grid that adapts to the vehicle type (14 / 33 / 51 / EV).
 *  - green  = free for your whole segment
 *  - amber  = free, but the seat frees up mid-segment (relay!)
 *  - red    = occupied for your segment
 */
export default function SeatGrid({
  seatCapacity,
  seatLayout,
  seatStates,
  bookedSeats = [],
  selectedSeat,
  onSelect,
  disabled = false,
  showLegend = true,
}: SeatGridProps) {
  const rows = seatLayout?.rows ?? [];
  const columns = seatLayout?.columns ?? 4;

  const stateOf = (seat: number): SeatState => {
    if (seatStates && seat in seatStates) return seatStates[seat];
    return bookedSeats.includes(seat) ? 'full' : 'free';
  };

  const seatButton = (seat: number) => {
    const state = stateOf(seat);
    const isSelected = selectedSeat === seat;

    let style = 'bg-emerald-600 hover:bg-emerald-500 text-white shadow';
    if (state === 'full') style = 'bg-rose-600 text-white cursor-not-allowed opacity-45';
    if (state === 'partial') style = 'bg-amber-500 hover:bg-amber-400 text-slate-900 shadow';
    if (isSelected) style = 'bg-amber-300 text-slate-900 font-black ring-4 ring-amber-200';

    const title =
      state === 'full'
        ? `Seat ${seat} is occupied for your segment`
        : state === 'partial'
          ? `Seat ${seat} frees up before your alighting stop`
          : `Seat ${seat} is free`;

    return (
      <button
        key={seat}
        type="button"
        title={title}
        disabled={disabled || state === 'full'}
        onClick={() => onSelect?.(seat)}
        className={`rounded-lg p-2.5 text-sm font-bold font-mono tabular-nums transition-all ${style}`}
      >
        {seat}
      </button>
    );
  };

  return (
    <div>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex justify-center gap-2">
              {row.map((seat) => seatButton(seat))}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(columns, 4)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: seatCapacity }, (_, i) => i + 1).map((seat) => seatButton(seat))}
        </div>
      )}

      {showLegend && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-emerald-600" /> Free for your segment
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-amber-500" /> Frees up before you alight
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-rose-600" /> Occupied
          </span>
        </div>
      )}
    </div>
  );
}
