'use client';

import React, { useState } from 'react';
import {
  buildEscPosTicketBytes,
  connectBluetoothThermalPrinter,
  sendEscPosToPrinter,
  downloadRawEscPosFile,
  isWebBluetoothSupported,
} from '@/lib/escpos';
import QRCodeSVG from '../QRCodeSVG';

export interface TicketData {
  bookingId: number;
  tripId: number;
  passengerName: string;
  passengerPhone?: string | null;
  seatNumber: number;
  routeName: string;
  boardStop: string;
  alightStop: string;
  departureTime?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  fareAmount?: number | null;
  hasLuggage?: boolean;
  luggageCount?: number;
  luggageFee?: number;
  receiptNumber?: string | null;
  paymentStatus?: string;
  qrData?: string;
  saccoName?: string | null;
}

interface PrintableTicketModalProps {
  ticket: TicketData;
  isOpen: boolean;
  onClose: () => void;
  defaultFormat?: 'a4' | 'thermal';
}

export default function PrintableTicketModal({
  ticket,
  isOpen,
  onClose,
  defaultFormat = 'a4',
}: PrintableTicketModalProps) {
  const [format, setFormat] = useState<'a4' | 'thermal'>(defaultFormat);
  const [rollWidth, setRollWidth] = useState<58 | 80>(58);
  const [copied, setCopied] = useState(false);
  const [btStatus, setBtStatus] = useState<'idle' | 'connecting' | 'printing' | 'success' | 'error'>('idle');
  const [btDeviceName, setBtDeviceName] = useState<string | null>(null);
  const [btError, setBtError] = useState<string>('');

  if (!isOpen) return null;

  const qrString = ticket.qrData || `BUSGO:${ticket.bookingId}:${ticket.tripId}:${ticket.seatNumber}`;
  const totalPaid = (ticket.fareAmount || 0) + (ticket.luggageFee || 0);
  const formattedDate = ticket.departureTime
    ? new Date(ticket.departureTime).toLocaleString('en-KE', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('en-KE', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

  const handlePrint = () => {
    window.print();
  };

  const handleBluetoothPrint = async () => {
    setBtError('');
    setBtStatus('connecting');
    try {
      const devName = await connectBluetoothThermalPrinter();
      setBtDeviceName(devName);
      setBtStatus('printing');
      const bytes = buildEscPosTicketBytes(ticket, rollWidth);
      await sendEscPosToPrinter(bytes);
      setBtStatus('success');
      setTimeout(() => setBtStatus('idle'), 3500);
    } catch (err: any) {
      setBtStatus('error');
      setBtError(err?.message || 'Bluetooth printing failed. Ensure printer is on and in pairing range.');
    }
  };

  const handleDownloadBin = () => {
    const bytes = buildEscPosTicketBytes(ticket, rollWidth);
    downloadRawEscPosFile(bytes, `ticket_BG${ticket.bookingId}_${rollWidth}mm.bin`);
  };

  const generateAsciiReceipt = () => {
    const saccoHeader = (ticket.saccoName || 'BUSGO TRANSIT').toUpperCase();
    return `
========================================
            BUSGO TRANSIT
         OFFICIAL BOARDING PASS
       CUSTOMER CARE: 0716 314 831
             ${saccoHeader}
          OFFICIAL BOARDING PASS
        CUSTOMER CARE: 0716 314 831
========================================
TICKET NO : BG-${ticket.bookingId}-S${ticket.seatNumber.toString().padStart(2, '0')}
ISSUED AT : ${formattedDate}
OPERATOR  : ${ticket.saccoName || 'BusGo Network Co-op'}
PASSENGER : ${ticket.passengerName}
CONTACT   : ${ticket.passengerPhone || 'N/A'}
----------------------------------------
ROUTE     : ${ticket.routeName}
BOARDING  : ${ticket.boardStop}
DROP-OFF  : ${ticket.alightStop}
SEAT NO   : #${ticket.seatNumber}
VEHICLE   : ${ticket.vehiclePlate || 'FLEET UNIT'} (${ticket.vehicleModel || 'Standard PSV'})
----------------------------------------
BASE FARE : KES ${(ticket.fareAmount || 0).toLocaleString()}
LUGGAGE   : ${ticket.hasLuggage ? `${ticket.luggageCount} Bag(s) (KES ${(ticket.luggageFee || 0).toLocaleString()})` : 'None'}
----------------------------------------
TOTAL PAID: KES ${totalPaid.toLocaleString()}
M-PESA REF: ${ticket.receiptNumber || 'OFFICIAL CASH'}
STATUS    : ${(ticket.paymentStatus || 'CONFIRMED').toUpperCase()}
========================================
OPTICAL VERIFICATION CODE:
${qrString}
========================================
KEEP THIS RECEIPT FOR POLICE & SACCO INSPECTION
SAFARI NJEMA - TRAVEL SAFELY WITH BUSGO!
========================================
`.trim();
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(generateAsciiReceipt());
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      /* clipboard write failed */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto no-print-overlay">
      <div className="relative w-full max-w-3xl bg-[#0f1422] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-8 no-print">
        {/* Header Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800/80 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎫</span>
            <div>
              <h3 className="text-base font-black text-white tracking-wide">Transit E-Ticket & Receipt</h3>
              <p className="text-xs text-slate-400">Booking #{ticket.bookingId} • Seat #{ticket.seatNumber}</p>
            </div>
          </div>

          {/* Format Switcher */}
          <div className="flex items-center rounded-xl bg-slate-950 p-1 border border-slate-800">
            <button
              onClick={() => setFormat('a4')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                format === 'a4'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>📄 A4 PDF</span>
            </button>
            <button
              onClick={() => setFormat('thermal')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                format === 'thermal'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🧾 Thermal Slip</span>
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm transition"
          >
            ✕
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-slate-950/60 border-b border-slate-800/60">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {format === 'thermal' ? (
              <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">Roll:</span>
                <button
                  type="button"
                  onClick={() => setRollWidth(58)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                    rollWidth === 58 ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  58mm
                </button>
                <button
                  type="button"
                  onClick={() => setRollWidth(80)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                    rollWidth === 80 ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  80mm
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Ready for instant printing or PDF download</span>
              </div>
            )}
            {btDeviceName && (
              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {btDeviceName}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold transition shadow"
            >
              <span>{copied ? '✓' : '📋'}</span>
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>

            {format === 'thermal' && (
              <>
                <button
                  onClick={handleDownloadBin}
                  title="Download raw ESC/POS binary file for terminal spooler"
                  className="px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-mono transition"
                >
                  ⬇ .bin
                </button>

                <button
                  onClick={handleBluetoothPrint}
                  disabled={btStatus === 'connecting' || btStatus === 'printing'}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-bold text-xs shadow-lg transition cursor-pointer ${
                    btStatus === 'success'
                      ? 'bg-emerald-600 text-white'
                      : btStatus === 'error'
                      ? 'bg-rose-600 text-white'
                      : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-900/30'
                  }`}
                >
                  <span>{btStatus === 'connecting' ? '📡' : btStatus === 'printing' ? '⏳' : btStatus === 'success' ? '✓' : '📱'}</span>
                  <span>
                    {btStatus === 'connecting'
                      ? 'Pairing BT...'
                      : btStatus === 'printing'
                      ? 'Printing Slip...'
                      : btStatus === 'success'
                      ? 'Printed!'
                      : 'Bluetooth POS Print'}
                  </span>
                </button>
              </>
            )}

            <a
              href={`/api/bookings/${ticket.bookingId}/boarding-pass.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              download={`BUSGO-BoardingPass-${ticket.bookingId}.pdf`}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-lg shadow-blue-900/30 transition cursor-pointer"
              title="Download official vector PDF boarding pass"
            >
              <span>⬇ Official PDF</span>
            </a>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-900/30 transition cursor-pointer"
            >
              <span>🖨️</span>
              <span>{format === 'a4' ? 'Print / Save PDF' : 'Browser Print'}</span>
            </button>
          </div>
        </div>

        {btError && (
          <div className="bg-rose-500/10 border-b border-rose-500/30 text-rose-400 text-xs px-6 py-2 flex justify-between items-center">
            <span>{btError}</span>
            <button onClick={() => setBtError('')} className="underline hover:text-white">✕</button>
          </div>
        )}

        {/* Preview Container */}
        <div className="p-6 max-h-[70vh] overflow-y-auto bg-[#070a12] flex justify-center">
          {format === 'a4' ? (
            /* ===============================================================
               A4 / Standard Boarding Pass Preview
               =============================================================== */
            <div className="w-full max-w-2xl bg-white text-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-200 font-sans select-text a4-print-document">
              {/* Header Branding */}
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black text-xl shadow">
                    BG
                  </div>
                  <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-950">BUSGO TRANSIT</h1>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Official Passenger E-Boarding Pass</p>
                    <h1 className="text-2xl font-black tracking-tight text-slate-950">
                      {ticket.saccoName ? ticket.saccoName : 'BUSGO TRANSIT'}
                    </h1>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      {ticket.saccoName ? 'Authorized PSV Operator · BusGo Network' : 'Official Passenger E-Boarding Pass'}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                    PAID & CONFIRMED
                  </span>
                  <p className="text-[11px] font-mono text-slate-500 mt-1">REF: {ticket.receiptNumber || 'CASH-STK'}</p>
                </div>
              </div>

              {/* Journey Strip */}
              <div className="grid grid-cols-3 gap-4 my-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Boarding Station</p>
                  <p className="text-base font-black text-slate-900 mt-0.5">{ticket.boardStop}</p>
                  <p className="text-xs text-slate-600 mt-1">Stage Departure Point</p>
                </div>

                <div className="flex flex-col items-center justify-center">
                  <span className="text-xs font-mono text-slate-400">CORRIDOR HOP</span>
                  <div className="w-full flex items-center gap-1 my-1">
                    <div className="h-0.5 flex-1 bg-slate-300" />
                    <span className="text-emerald-600 text-sm">➔</span>
                    <div className="h-0.5 flex-1 bg-slate-300" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-600">{ticket.routeName}</span>
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Destination</p>
                  <p className="text-base font-black text-slate-900 mt-0.5">{ticket.alightStop}</p>
                  <p className="text-xs text-slate-600 mt-1">Final Alighting Terminus</p>
                </div>
              </div>

              {/* Seat & Passenger Matrix */}
              <div className="grid grid-cols-4 gap-4 p-4 border border-slate-200 rounded-xl mb-6">
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Seat Assignment</p>
                  <p className="text-2xl font-black text-emerald-600">#{ticket.seatNumber}</p>
                  <p className="text-[10px] text-slate-500">Reserved Window/Aisle</p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Passenger Name</p>
                  <p className="text-sm font-black text-slate-900 mt-1 truncate">{ticket.passengerName}</p>
                  <p className="text-xs font-mono text-slate-500">{ticket.passengerPhone || 'No Phone'}</p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Vehicle / Unit</p>
                  <p className="text-sm font-black font-mono text-slate-900 mt-1">{ticket.vehiclePlate || 'Assigned At Stage'}</p>
                  <p className="text-[10px] text-slate-500 truncate">{ticket.vehicleModel || 'PSV Minibus'}</p>
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Date & Time</p>
                  <p className="text-xs font-bold text-slate-900 mt-1">{formattedDate}</p>
                  <p className="text-[10px] text-emerald-700 font-semibold">Report 15m early</p>
                </div>
              </div>

              {/* Fare & Luggage Accounting Breakdown */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-950 text-white rounded-xl mb-6">
                <div className="space-y-1">
                  <div className="text-xs text-slate-400">
                    Base Passenger Fare: <span className="font-mono text-white font-bold">KES {(ticket.fareAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Accompanied Mzigo Cargo:{' '}
                    <span className="font-mono text-white font-bold">
                      {ticket.hasLuggage ? `${ticket.luggageCount} Bag(s) (+KES ${(ticket.luggageFee || 0).toLocaleString()})` : 'None (KES 0)'}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Total Fare Collected</p>
                  <p className="text-xl font-black font-mono text-white">KES {totalPaid.toLocaleString()}</p>
                </div>
              </div>

              {/* Security Optical QR & Barcode Section */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pt-4 border-t border-dashed border-slate-300">
                <div className="flex items-center gap-4">
                  {/* High-contrast printable SVG QR Code */}
                  <div className="p-1 border-2 border-slate-900 rounded-xl bg-white shadow-sm flex items-center justify-center">
                    <QRCodeSVG value={qrString} size={84} />
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-900 uppercase">Boarding Conductor Validation</p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5 break-all max-w-xs">{qrString}</p>
                    <p className="text-[10px] text-emerald-700 font-bold mt-1">Present this QR code to the driver or stage scanner.</p>
                  </div>
                </div>

                <div className="text-right text-[10px] text-slate-400 space-y-0.5">
                  <p className="font-bold text-slate-600">CONDITIONS OF CARRIAGE:</p>
                  <p>1. Ticket non-transferable without prior notice.</p>
                  <p>2. Luggage over 15kg subject to cargo charges.</p>
                  <p>3. Passenger must retain ticket until destination.</p>
                  <p className="font-mono text-slate-500 pt-1">SYS: BUSGO-PROD-V1</p>
                </div>
              </div>
            </div>
          ) : (
            /* ===============================================================
               58mm / 80mm Handheld Stage Thermal POS Receipt Preview
               =============================================================== */
            <div className={`bg-white text-black p-4 rounded shadow-2xl border border-slate-300 font-mono text-[11px] leading-tight ${rollWidth === 80 ? 'w-[360px]' : 'w-[280px]'} select-text thermal-receipt-document`}>
              <div className="text-center">
                <p className="text-sm font-black tracking-tighter">*** BUSGO TRANSIT ***</p>
                <p className="text-[10px]">P.O. BOX 10444 - NAIROBI</p>
                <p className="text-[10px]">CUSTOMER CARE: 0716 314 831</p>
                <p className="text-[10px]">STAGE PASSENGER RECEIPT</p>
                <p className="my-1 border-b border-black border-dashed" />
              </div>

              <div className="space-y-0.5 my-2">
                <div className="flex justify-between"><span>DATE:</span><span>{formattedDate}</span></div>
                <div className="flex justify-between"><span>TKT NO:</span><span className="font-bold">BG-{ticket.bookingId}</span></div>
                <div className="flex justify-between"><span>PASSENGER:</span><span className="font-bold truncate max-w-[130px]">{ticket.passengerName}</span></div>
                <div className="flex justify-between"><span>PHONE:</span><span>{ticket.passengerPhone || 'WALK-UP'}</span></div>
              </div>

              <p className="my-1 border-b border-black border-dashed" />

              <div className="space-y-0.5 my-2">
                <div className="flex justify-between"><span>ROUTE:</span><span className="font-bold">{ticket.routeName}</span></div>
                <div className="flex justify-between"><span>BOARD AT:</span><span>{ticket.boardStop}</span></div>
                <div className="flex justify-between"><span>DROP OFF:</span><span>{ticket.alightStop}</span></div>
                <div className="flex justify-between text-xs font-black"><span>SEAT NO:</span><span>#{ticket.seatNumber}</span></div>
                <div className="flex justify-between"><span>VEHICLE:</span><span className="font-bold">{ticket.vehiclePlate || 'TBD'}</span></div>
              </div>

              <p className="my-1 border-b border-black border-dashed" />

              <div className="space-y-0.5 my-2">
                <div className="flex justify-between"><span>BASE FARE:</span><span>KES {(ticket.fareAmount || 0).toFixed(2)}</span></div>
                {ticket.hasLuggage && (
                  <div className="flex justify-between"><span>MZIGO ({ticket.luggageCount} BAG):</span><span>KES {(ticket.luggageFee || 0).toFixed(2)}</span></div>
                )}
                <p className="my-1 border-b border-black" />
                <div className="flex justify-between font-black text-xs">
                  <span>TOTAL PAID:</span>
                  <span>KES {totalPaid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>PAY METHOD:</span>
                  <span>M-PESA ({ticket.receiptNumber || 'OFFICIAL'})</span>
                </div>
              </div>

              <p className="my-1 border-b border-black border-dashed" />

              <div className="text-center my-3">
                <p className="text-[10px] font-bold">SCAN TO BOARD</p>
                <div className="inline-block p-1 border border-black my-1">
                  <QRCodeSVG value={qrString} size={80} />
                </div>
                <p className="text-[9px] font-mono break-all">{qrString}</p>
              </div>

              <div className="text-center text-[9px] mt-2">
                <p>RETAIN RECEIPT ON BOARD</p>
                <p>SAFARI NJEMA / TRAVEL SAFE!</p>
                <p className="mt-1">================================</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

