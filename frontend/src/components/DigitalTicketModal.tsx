'use client';

import React, { useState, useEffect } from 'react';
import QRCodeSVG from './QRCodeSVG';
import { IconEmblem, IconTicket } from './dashboard/FluxIcons';
import { dispatchBookingTicket, fetchBookingDispatchPreview, fetchBoardingPassMetadata } from '@/services/api';
import PrintableTicketModal, { TicketData } from './user/PrintableTicketModal';

export interface TicketBookingData {
  id: number;
  trip_id: number;
  seat_number: number;
  board_stop_order: number;
  alight_stop_order: number;
  status: string;
  payment_status: string;
  trip_name?: string;
  route_name?: string;
  board_stop?: string;
  alight_stop?: string;
  vehicle_plate?: string;
  vehicle_model?: string;
  driver_name?: string;
  departure_time?: string;
  created_at?: string;
  sacco_name?: string;
}

export interface DigitalTicketModalProps {
  booking: TicketBookingData | null;
  passengerName?: string;
  onClose: () => void;
}

export default function DigitalTicketModal({
  booking,
  passengerName = 'Passenger',
  onClose,
}: DigitalTicketModalProps) {
  const [targetPhone, setTargetPhone] = useState('0716314831');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState('');
  const [dispatchError, setDispatchError] = useState('');
  const [waLink, setWaLink] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [signedQrToken, setSignedQrToken] = useState<string>('');

  useEffect(() => {
    if (!booking?.id) return;
    fetchBookingDispatchPreview(booking.id)
      .then((res) => {
        if (res?.preview?.wa_link) setWaLink(res.preview.wa_link);
      })
      .catch(() => {});

    fetchBoardingPassMetadata(booking.id)
      .then((meta) => {
        if (meta?.qr_token) setSignedQrToken(meta.qr_token);
      })
      .catch(() => {});
  }, [booking?.id]);

  if (!booking) return null;

  const ticketCode = signedQrToken || `BUSGO:${booking.id}:${booking.trip_id}:${booking.seat_number}`;
  const displayRef = `BG-${booking.id.toString().padStart(4, '0')}-${booking.seat_number}`;
  const isBoarded = booking.status === 'boarded';
  const isPaid = booking.payment_status === 'paid';

  const handlePrint = () => {
    window.print();
  };

  const handleDispatch = async (channels: string[]) => {
    if (!booking || isDispatching) return;
    setIsDispatching(true);
    setDispatchMsg('');
    setDispatchError('');
    try {
      const res = await dispatchBookingTicket(booking.id, {
        channels,
        override_phone: targetPhone,
      });
      if (res?.wa_link) {
        setWaLink(res.wa_link);
      }
      const chLabel = channels.map((c) => c.toUpperCase()).join(' & ');
      setDispatchMsg(`✓ Dispatched via ${chLabel} to ${res.recipient}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dispatch failed.';
      setDispatchError(msg);
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      {/* Backdrop dismiss */}
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#0b101e] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden z-10 my-8 print:border-none print:shadow-none print:bg-white print:text-black">
        {/* Top Gradient Header */}
        <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <IconEmblem className="w-8 h-8 shrink-0 text-white" />
            <div>
              <h2 className="text-base font-black tracking-tight flex items-center gap-1.5">
                BusGo Transit
              </h2>
              <p className="text-[10px] font-bold tracking-widest uppercase opacity-90">
                Official E-Boarding Pass
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold bg-white/20 backdrop-blur px-2.5 py-1 rounded-full border border-white/30">
              {displayRef}
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition print:hidden"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Boarding Pass Body */}
        <div className="p-6 space-y-6">
          {/* Route Stop Indicator */}
          <div className="bg-[#12182b] rounded-2xl p-4 border border-slate-800 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                Boarding Station
              </span>
              <p className="text-base font-black text-white truncate">
                {booking.board_stop ?? `Stop #${booking.board_stop_order}`}
              </p>
              <p className="text-xs text-slate-400 truncate mt-0.5">{booking.route_name ?? 'Transit Route'}</p>
            </div>

            <div className="flex flex-col items-center shrink-0 px-2">
              <div className="h-0.5 w-12 bg-gradient-to-r from-cyan-400 to-indigo-500 relative">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 shadow" />
              </div>
              <span className="text-[9px] font-mono text-slate-400 mt-1">DIRECT</span>
            </div>

            <div className="min-w-0 text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                Alighting Station
              </span>
              <p className="text-base font-black text-white truncate">
                {booking.alight_stop ?? `Stop #${booking.alight_stop_order}`}
              </p>
              <p className="text-xs text-slate-400 truncate mt-0.5">{booking.trip_name ?? 'Trip'}</p>
            </div>
          </div>

          {/* Seat & Passenger Specs */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-[#12182b] p-3 rounded-xl border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Seat Number</p>
              <p className="text-2xl font-black font-mono text-cyan-300 mt-1">#{booking.seat_number}</p>
            </div>

            <div className="bg-[#12182b] p-3 rounded-xl border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Boarding Status</p>
              <span
                className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${
                  isBoarded
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}
              >
                {isBoarded ? '✓ Boarded' : 'Ready to Board'}
              </span>
            </div>

            <div className="bg-[#12182b] p-3 rounded-xl border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Payment</p>
              <span
                className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${
                  isPaid
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {booking.payment_status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Passenger & Vehicle Details Table */}
          <div className="border-t border-b border-dashed border-slate-800 py-3.5 grid grid-cols-2 gap-y-3 text-xs">
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold">Passenger Name</p>
              <p className="font-bold text-slate-200 mt-0.5">{passengerName}</p>
            </div>
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold">Vehicle Reg Plate</p>
              <p className="font-mono font-bold text-slate-200 mt-0.5">
                {booking.vehicle_plate ?? 'Assigned at Depot'}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold">Departure Time</p>
              <p className="text-slate-200 mt-0.5">
                {booking.departure_time
                  ? new Date(booking.departure_time).toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'On Schedule'}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold">Assigned Driver</p>
              <p className="text-slate-200 mt-0.5">{booking.driver_name ?? 'Transit Captain'}</p>
            </div>
          </div>

          {/* Passenger SMS & WhatsApp Dispatch Card */}
          <div className="bg-[#12182b] p-4 rounded-2xl border border-slate-800 space-y-3 print:hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">📲</span>
                <p className="text-xs font-bold text-white tracking-wide">
                  Instant Boarding Pass Dispatch
                </p>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/60">
                SMS & WhatsApp Live
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                  🇰🇪
                </span>
                <input
                  type="text"
                  value={targetPhone}
                  onChange={(e) => setTargetPhone(e.target.value)}
                  placeholder="0716314831"
                  className="w-full bg-[#070a14] border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 transition"
                />
              </div>

              {/* 1-Click WhatsApp Deep-Link */}
              <a
                href={waLink || `https://wa.me/254716314831?text=${encodeURIComponent(`BUSGO Transit Boarding Pass for Seat #${booking.seat_number}. Ref: ${displayRef}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition shrink-0"
                title="Open directly in WhatsApp Web or Mobile App"
              >
                <span>WhatsApp</span>
                <span className="text-[10px]">↗</span>
              </a>

              {/* Automated Backend Dispatch */}
              <button
                onClick={() => handleDispatch(['whatsapp', 'sms'])}
                disabled={isDispatching}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-blue-600/20 transition shrink-0"
              >
                {isDispatching ? (
                  <span className="animate-spin text-xs">⏳</span>
                ) : (
                  <span>Send SMS</span>
                )}
              </button>
            </div>

            {dispatchMsg && (
              <p className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/40">
                {dispatchMsg}
              </p>
            )}

            {dispatchError && (
              <p className="text-[11px] font-semibold text-rose-400 bg-rose-950/40 p-2 rounded-lg border border-rose-800/40">
                {dispatchError}
              </p>
            )}
          </div>

          {/* QR Code Centerpiece */}
          <div className="flex flex-col items-center justify-center p-4 bg-[#070a14] rounded-2xl border border-slate-800 text-center space-y-2.5">
            <QRCodeSVG value={ticketCode} size={170} />
            <p className="text-xs font-mono tracking-wider text-slate-400">{ticketCode}</p>
            <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
              Show this QR code to the driver upon boarding. Fast verification via optical scan.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-[#090d19] px-6 py-4 border-t border-slate-800 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <IconTicket className="w-4 h-4 text-cyan-400" />
            <span>Digital Boarding Token</span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`/api/bookings/${booking.id}/boarding-pass.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              download={`BUSGO-BoardingPass-${booking.id}.pdf`}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black transition flex items-center gap-1.5 shadow-lg shadow-blue-900/30 cursor-pointer"
              title="Download official high-resolution vector PDF boarding pass"
            >
              <span>⬇ Download PDF</span>
            </a>
            <button
              onClick={() => setShowPrintModal(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black transition flex items-center gap-1.5 shadow-lg shadow-emerald-900/30 cursor-pointer"
            >
              <span>🖨️ Thermal POS Slip</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
            >
              Done
            </button>
          </div>
        </div>

        {/* Full-Page PDF & 58mm Thermal Print Modal */}
        <PrintableTicketModal
          isOpen={showPrintModal}
          onClose={() => setShowPrintModal(false)}
          ticket={{
            bookingId: booking.id,
            tripId: booking.trip_id,
            passengerName,
            passengerPhone: targetPhone,
            seatNumber: booking.seat_number,
            routeName: booking.route_name || 'Kenyan Highway Service',
            boardStop: booking.board_stop || `Stop #${booking.board_stop_order}`,
            alightStop: booking.alight_stop || `Stop #${booking.alight_stop_order}`,
            departureTime: booking.departure_time,
            vehiclePlate: booking.vehicle_plate,
            vehicleModel: booking.vehicle_model,
            paymentStatus: booking.payment_status,
            saccoName: booking.sacco_name,
            qrData: ticketCode,
          }}
        />
      </div>
    </div>
  );
}

