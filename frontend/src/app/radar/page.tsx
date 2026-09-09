'use client';

import React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const NationalFleetRadar = dynamic(() => import('@/components/radar/NationalFleetRadar'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] rounded-2xl border border-slate-800 bg-[#090d16] flex flex-col items-center justify-center p-8 text-center shadow-xl">
      <div className="w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mb-4" />
      <p className="text-sm font-bold text-slate-200">Connecting to National Transit GIS Radar...</p>
      <p className="text-xs text-slate-500 mt-1">Streaming Kenyan highway GPS nodes & telemetry</p>
    </div>
  ),
});

export default function RadarPage() {
  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-rose-500">
                BUSGO
              </span>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/40">
                RADAR GIS
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs font-semibold">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 transition-colors border border-slate-800"
            >
              Passenger Booking
            </Link>
            <Link
              href="/driver"
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 transition-colors border border-slate-800"
            >
              Driver Console
            </Link>
            <Link
              href="/admin"
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black transition-colors shadow-md shadow-cyan-500/20"
            >
              SACCO Fleet Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">
        <NationalFleetRadar />
      </main>
    </div>
  );
}

