'use client';

import React from 'react';
import Link from 'next/link';
import UssdPhoneSimulator from '@/components/ussd/UssdPhoneSimulator';

function IconArrowLeft({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function IconPhoneCall({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function IconZap({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconAward({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="6" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  );
}

function IconMessageSquare({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

export default function UssdPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 flex flex-col justify-between">
      <div className="max-w-6xl mx-auto w-full">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-cyan-400 transition"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back to BUSGO Live
          </Link>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-mono text-emerald-400 font-bold">Telco Gateway: Active</span>
          </div>
        </div>

        {/* Hero Banner */}
        <div className="text-center mt-8 mb-6 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold mb-3">
            <IconPhoneCall className="w-3.5 h-3.5" />
            Kenya USSD Code: *384*254#
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Offline Commuter <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">Mulika Mwizi</span> Simulator
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Experience how millions of offline passengers book seats, check live bus plate assignments, and redeem Safari Points across Kenya without internet access or smartphones.
          </p>
        </div>

        {/* Feature Highlights Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <IconZap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Instant Reservation</div>
              <div className="text-xs text-slate-400 mt-0.5">Dial corridor routes, pick seat numbers, and trigger immediate M-Pesa STK prompts.</div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <IconAward className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Safari Points Loyalty</div>
              <div className="text-xs text-slate-400 mt-0.5">Check accumulated commuter points (1 pt per KES 10 spent) and tier status anytime.</div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <IconMessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">SMS Boarding Passes</div>
              <div className="text-xs text-slate-400 mt-0.5">Instant delivery of verifiable E-Tickets with assigned vehicle plate & QR boarding codes.</div>
            </div>
          </div>
        </div>

        {/* Main Phone Simulator Component */}
        <div className="bg-gradient-to-b from-slate-900/90 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl">
          <UssdPhoneSimulator />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-xs text-slate-500 font-mono">
        BUSGO Kenya Transit Ecosystem · Standard Africa’s Talking USSD Gateway Protocol
      </div>
    </div>
  );
}

