'use client';

import React from 'react';
import { ChainLink } from '@/services/api';

interface ChainViewProps {
  seatNumber: number;
  links: ChainLink[];
  /** highlight the link that belongs to the current user, if any */
  myBookingId?: number | null;
  compact?: boolean;
}

/**
 * Visualizes the relay/transfer chain for one seat:
 *   A → B 🔗 B → C 🔗 C → D
 * Each link is one passenger's segment; adjacent links mean the seat is
 * handed over between passengers at the shared stop.
 */
export default function ChainView({ seatNumber, links, myBookingId, compact = false }: ChainViewProps) {
  if (links.length === 0) {
    return <p className="text-xs text-slate-500">Seat {seatNumber} is empty — no chain yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 mr-1">Seat {seatNumber}</span>
      {links.map((link, i) => {
        const mine = link.booking_id === myBookingId;
        return (
          <React.Fragment key={link.booking_id}>
            {i > 0 && <span className="text-emerald-500 font-black">🔗</span>}
            <div
              className={`rounded-lg px-2.5 py-1 text-xs border ${
                mine
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              {link.board_stop ?? `Stop ${link.board_stop_order}`} → {link.alight_stop ?? `Stop ${link.alight_stop_order}`}
              {!compact && <span className="block text-[10px] text-slate-400">{link.passenger_name}</span>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
