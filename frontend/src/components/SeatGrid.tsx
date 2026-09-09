'use client';

import React, { useState } from 'react';
import type { SeatLayout } from '@busgo/types';

export type SeatState = 'free' | 'partial' | 'full';

export interface SeatGridProps {
  seatCapacity: number;
  seatLayout?: SeatLayout | null;
  /** state per seat number (from /seat-map). Overrides bookedSeats. */
  seatStates?: Record<number, SeatState>;
  /** fallback: just the booked seat numbers (legacy /booked-seats). */
  bookedSeats?: number[];
  selectedSeat?: number | null;
  onSelect?: (seat: number) => void;
  disabled?: boolean;
  showLegend?: boolean;
  vehicleType?: string | null;
  plateNumber?: string | null;
  isElectric?: boolean;
}

// ---------------------------------------------------------------------------
// Blueprints matching authentic Kenyan PSV engineering drawings:
// 1. 14-seater Matatu (Toyota HiAce / Shark) - media_1788809371646.jpg
// 2. 31-seater Electric Bus (BasiGo / Roam) - media_1788809371641.jpg
// 3. 35-seater Nganya Minibus (Isuzu FRR / NQR) - media_1788809371645.jpg
// ---------------------------------------------------------------------------

const BLUEPRINT_MATATU_14: { type: string; title: string; rows: number[][] } = {
  type: 'matatu_14',
  title: 'Kenyan 14-Seater Matatu (HiAce / Shark)',
  rows: [
    [1, 2, 0, 0],     // Front cabin: Seats 1, 2 (Driver on right)
    [0, 5, 4, 3],     // Row 2: Door on left, Seats 5, 4, 3
    [8, 0, 7, 6],     // Row 3: Seat 8 (window), Aisle (0), Seats 7, 6
    [11, 0, 10, 9],   // Row 4: Seat 11 (window), Aisle (0), Seats 10, 9
    [14, 13, 0, 12],  // Row 5: Rear bench - Seats 14, 13, 12
  ],
};

const BLUEPRINT_ELECTRIC_31: { type: string; title: string; rows: number[][] } = {
  type: 'electric_31',
  title: 'Electric Transit Bus (31-Seater Zero-Emission)',
  rows: [
    [1, 2, 0, 4, 5],       // Front row behind door/driver
    [3, 0, 0, 0, 6],       // Front blocks: 3 on left, 6 on right
    [10, 9, 0, 8, 7],      // Middle row 1 (2+2)
    [11, 12, 0, 13, 14],   // Middle row 2 (2+2)
    [18, 17, 0, 16, 15],   // Middle row 3 (2+2)
    [19, 20, 0, 21, 22],   // Middle row 4 (2+2)
    [26, 25, 0, 24, 23],   // Middle row 5 (2+2)
    [27, 28, 29, 30, 31],  // Back bench (5 across)
  ],
};

const BLUEPRINT_NGANYA_35: { type: string; title: string; rows: number[][] } = {
  type: 'nganya_35',
  title: 'Nairobi Nganya Minibus (35-Seater Isuzu)',
  rows: [
    [2, 1, 0, 0, 0, 0],       // Front cabin: 2, 1 (Driver on far right)
    [7, 6, 0, 5, 4, 3],       // Row 1: Left 7, 6; Right 5, 4, 3
    [0, 0, 0, 10, 9, 8],      // Row 2: Left is Door (cols 0, 1); Right 10, 9, 8
    [15, 14, 0, 13, 12, 11],  // Row 3: Left 15, 14; Right 13, 12, 11
    [20, 19, 0, 18, 17, 16],  // Row 4: Left 20, 19; Right 18, 17, 16
    [25, 24, 0, 23, 22, 21],  // Row 5: Left 25, 24; Right 23, 22, 21
    [30, 29, 0, 28, 27, 26],  // Row 6: Left 30, 29; Right 28, 27, 26
    [35, 34, 33, 32, 31, 0],  // Row 7: Back bench - 35, 34, 33, 32, 31
  ],
};

export default function SeatGrid({
  seatCapacity,
  seatLayout,
  seatStates,
  bookedSeats = [],
  selectedSeat,
  onSelect,
  disabled = false,
  showLegend = true,
  vehicleType,
  plateNumber,
  isElectric,
}: SeatGridProps) {
  const [hoveredSeat, setHoveredSeat] = useState<number | null>(null);

  // 1. Resolve vehicle model & matching blueprint
  const vType = (vehicleType || seatLayout?.type || '').toLowerCase();
  const isEv = isElectric || vType.includes('ev') || vType.includes('electric');

  let activeBlueprint = BLUEPRINT_MATATU_14;
  if (isEv || seatCapacity === 31 || vType.includes('31') || vType.includes('ev_bus')) {
    activeBlueprint = BLUEPRINT_ELECTRIC_31;
  } else if (seatCapacity === 35 || seatCapacity === 33 || vType.includes('35') || vType.includes('33') || vType.includes('nganya')) {
    activeBlueprint = BLUEPRINT_NGANYA_35;
  } else if (seatCapacity === 14 || vType.includes('14') || vType.includes('matatu')) {
    activeBlueprint = BLUEPRINT_MATATU_14;
  }

  // Use custom rows if provided in seatLayout, else active blueprint
  const gridRows = (seatLayout?.rows && seatLayout.rows.length > 0) ? seatLayout.rows : activeBlueprint.rows;

  const stateOf = (seat: number): SeatState => {
    if (seatStates && seat in seatStates) return seatStates[seat];
    return bookedSeats.includes(seat) ? 'full' : 'free';
  };

  const getSeatPositionInfo = (seat: number) => {
    if (seat <= 2) return 'Front Cabin';
    if (seat >= seatCapacity - 4) return 'Rear Bench';
    return 'Main Cabin';
  };

  return (
    <div className="relative w-full max-w-lg mx-auto select-none">
      {/* Background Synthwave Aura */}
      <div className="absolute -inset-1 bg-gradient-to-b from-[#f72d7a]/20 via-[#00f3ff]/15 to-[#f72d7a]/20 rounded-[36px] blur-xl opacity-60 pointer-events-none" />

      {/* Main Bus/Matatu Glassmorphic Body Container */}
      <div className="relative bg-[#0e0818]/90 backdrop-blur-2xl border border-white/10 rounded-[32px] shadow-[0_0_50px_rgba(0,0,0,0.85)] p-4 sm:p-6 overflow-hidden">
        
        {/* Aerodynamic Windshield & Front Cowl */}
        <div className="relative mb-5 pt-3 pb-4 px-4 bg-gradient-to-b from-cyan-500/15 via-slate-900/40 to-transparent border-t-2 border-cyan-400/50 rounded-t-[28px]">
          {/* Neon Headlight Glow Beams (Left & Right) */}
          <div className="absolute -top-1 left-4 w-12 h-3 bg-cyan-400/80 rounded-full blur-[6px] shadow-[0_0_16px_#00f3ff]" />
          <div className="absolute -top-1 right-4 w-12 h-3 bg-cyan-400/80 rounded-full blur-[6px] shadow-[0_0_16px_#00f3ff]" />

          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-300 font-mono tracking-wider uppercase">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              {isEv ? '⚡ EV ZERO-EMISSION' : 'KENYA PSV CORRIDOR'}
            </span>
            <span className="font-mono text-slate-400 bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-full text-[10px]">
              {plateNumber || (isEv ? 'KCE 999B' : seatCapacity === 35 ? 'KDB 777D' : 'KDA 123A')}
            </span>
          </div>

          <div className="text-center mt-1.5">
            <h3 className="text-xs sm:text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-pink-400 to-amber-300 uppercase tracking-widest">
              {seatLayout?.name || activeBlueprint.title}
            </h3>
            <p className="text-[10px] text-slate-400">
              Front Windshield · {seatCapacity} Capacity Passenger Deck
            </p>
          </div>
        </div>

        {/* Cockpit & Entry Hatch Area (RHD: Door Left, Driver Right) */}
        <div className="grid grid-cols-2 gap-3 mb-6 px-1">
          {/* Passenger Entrance Door (Left Hand Side) */}
          <div className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center font-black text-sm border border-amber-400/40">
              🚪
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black tracking-wider uppercase text-amber-400">
                PASSENGER DOOR
              </span>
              <span className="text-[9px] text-slate-400 font-mono flex items-center gap-1">
                <span className="text-amber-300">↓</span> Main Boarding Entry
              </span>
            </div>
          </div>

          {/* Driver Cockpit Pod (Right Hand Side - Kenya RHD) */}
          <div className="flex items-center justify-end gap-2.5 p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
            <div className="flex flex-col text-right">
              <span className="text-[10px] font-black tracking-wider uppercase text-cyan-400">
                DRIVER CABIN
              </span>
              <span className="text-[9px] text-slate-400 font-mono">
                Right-Hand Drive (RHD)
              </span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 flex items-center justify-center font-black text-sm border border-cyan-400/40 shadow-[0_0_12px_rgba(0,243,255,0.3)]">
              🛞
            </div>
          </div>
        </div>

        {/* Central Passenger Seating Corridor Deck */}
        <div className="relative py-2 px-1">
          {/* Subtle Illuminated Center Aisle Runner */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-8 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-400/40 via-transparent to-transparent" />

          <div className="space-y-3">
            {gridRows.map((row, rIdx) => {
              const isBackRow = rIdx === gridRows.length - 1;

              return (
                <div
                  key={`row-${rIdx}`}
                  className={`flex justify-center items-center gap-2 sm:gap-2.5 ${
                    isBackRow ? 'pt-2 border-t border-white/5' : ''
                  }`}
                >
                  {row.map((seat, cIdx) => {
                    // Empty Aisle slot or door space
                    if (seat === 0) {
                      return (
                        <div
                          key={`empty-${rIdx}-${cIdx}`}
                          className="w-10 h-11 sm:w-12 sm:h-13 flex items-center justify-center pointer-events-none"
                        >
                          <span className="w-1 h-1 rounded-full bg-cyan-500/20" />
                        </div>
                      );
                    }

                    const state = stateOf(seat);
                    const isSelected = selectedSeat === seat;
                    const isOccupied = state === 'full';
                    const isPartial = state === 'partial';

                    // Synthwave Aesthetic Seat Button States
                    let seatVisual = '';
                    if (isSelected) {
                      // Hot Pink Cyberpulse (Matching Login/Signup Active Glow)
                      seatVisual =
                        'bg-gradient-to-b from-[#f72d7a] to-[#d61b64] text-white border-2 border-pink-300 shadow-[0_0_25px_rgba(247,45,122,0.9)] scale-105 ring-4 ring-pink-400/40 animate-pulse';
                    } else if (isOccupied) {
                      // Dark Muted Slate with subtle lock outline
                      seatVisual =
                        'bg-slate-950/70 border border-slate-800 text-slate-600 opacity-40 cursor-not-allowed';
                    } else if (isPartial) {
                      // Electric Amber (Relay Corridor Handoff)
                      seatVisual =
                        'bg-gradient-to-b from-amber-950/70 via-slate-900 to-amber-950/80 border border-amber-500/80 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)] hover:border-amber-400 hover:scale-105';
                    } else {
                      // Available: Neon Cyan / Emerald Glass
                      seatVisual =
                        'bg-gradient-to-b from-slate-900/90 via-cyan-950/40 to-slate-900 border border-cyan-500/40 text-cyan-300 shadow-[0_0_12px_rgba(0,243,255,0.12)] hover:border-cyan-300 hover:text-white hover:shadow-[0_0_20px_rgba(0,243,255,0.5)] hover:scale-105 active:scale-95';
                    }

                    return (
                      <button
                        key={`seat-${seat}`}
                        type="button"
                        disabled={disabled || isOccupied}
                        onClick={() => onSelect?.(seat)}
                        onMouseEnter={() => setHoveredSeat(seat)}
                        onMouseLeave={() => setHoveredSeat(null)}
                        className={`group relative w-10 h-11 sm:w-12 sm:h-13 rounded-xl flex flex-col items-center justify-between p-1 transition-all duration-200 ${seatVisual}`}
                        title={`Seat #${seat} (${state}) · ${getSeatPositionInfo(seat)}`}
                      >
                        {/* 3D Headrest Outline Top Tab */}
                        <div
                          className={`w-5 h-1.5 rounded-t-sm transition-colors ${
                            isSelected
                              ? 'bg-white/80'
                              : isOccupied
                              ? 'bg-slate-800'
                              : isPartial
                              ? 'bg-amber-400/60'
                              : 'bg-cyan-400/60 group-hover:bg-cyan-300'
                          }`}
                        />

                        {/* Bold Monospace Seat Number */}
                        <span className="font-mono font-black text-xs sm:text-sm tracking-tight">
                          {seat}
                        </span>

                        {/* Seat Cushion Footing Indicator */}
                        <div
                          className={`w-6 h-0.5 rounded-full ${
                            isSelected
                              ? 'bg-white/60'
                              : isOccupied
                              ? 'bg-slate-800'
                              : isPartial
                              ? 'bg-amber-500/40'
                              : 'bg-cyan-500/40'
                          }`}
                        />

                        {/* Occupied Padlock Badge */}
                        {isOccupied && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-900 border border-slate-700 text-[8px] flex items-center justify-center text-slate-500">
                            ✕
                          </span>
                        )}

                        {/* Selected Heartbeat Star */}
                        {isSelected && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-pink-400 text-slate-950 font-black text-[9px] flex items-center justify-center shadow-lg">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rear of Vehicle & Emergency Exit */}
        <div className="mt-6 pt-4 border-t border-white/10 flex flex-col items-center">
          <div className="w-full flex items-center justify-between px-2 text-[10px] text-slate-400">
            {/* Neon Tail Lights (Red / Synthwave Rose) */}
            <div className="w-8 h-2 rounded-full bg-rose-500/80 shadow-[0_0_12px_#f72d7a]" />
            
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span>🚨 EMERGENCY EXIT</span>
            </span>

            <div className="w-8 h-2 rounded-full bg-rose-500/80 shadow-[0_0_12px_#f72d7a]" />
          </div>

          {/* Dynamic Active Seat Tooltip Banner */}
          <div className="mt-3 w-full p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#f72d7a] shadow-[0_0_8px_#f72d7a]" />
              <span className="text-xs font-bold text-slate-300">
                {selectedSeat
                  ? `Selected Seat #${selectedSeat} (${getSeatPositionInfo(selectedSeat)})`
                  : hoveredSeat
                  ? `Hovering Seat #${hoveredSeat} (${getSeatPositionInfo(hoveredSeat)})`
                  : 'Click any available seat along the corridor to reserve'}
              </span>
            </div>
            <span className="text-[11px] font-mono font-bold text-cyan-300">
              {selectedSeat ? 'LOCKED FOR CHECKOUT' : `${seatCapacity} SEATS TOTAL`}
            </span>
          </div>
        </div>

        {/* Synthwave Interactive Legend (matching .auth-demo-chips style) */}
        {showLegend && (
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f3ff]" />
              Available
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/15 border border-pink-500/40 text-pink-300 text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#f72d7a] shadow-[0_0_8px_#f72d7a]" />
              Selected
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
              Relay Hand-off
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-400 text-[11px] font-bold opacity-60">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              Occupied
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

