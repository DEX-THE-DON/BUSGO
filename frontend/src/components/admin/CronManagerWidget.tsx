'use client';

import React, { useState, useEffect } from 'react';
import { CronStats, fetchCronStats, triggerCronSweep, errMsg } from '@/services/api';

export default function CronManagerWidget() {
  const [stats, setStats] = useState<CronStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningSweep, setRunningSweep] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const data = await fetchCronStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  useEffect(() => {
    loadStats();
    const timer = setInterval(loadStats, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleTriggerSweep = async () => {
    setRunningSweep(true);
    setMessage(null);
    setError(null);
    try {
      const res = await triggerCronSweep();
      setStats(res.stats);
      const sweeper = res.results?.pending_sweeper?.swept_count || 0;
      const wl = res.results?.waitlist_sweeper?.expired_count || 0;
      const tc = res.results?.trip_completer?.completed_count || 0;
      const rem = res.results?.departure_reminders?.reminded_count || 0;
      setMessage(
        `✓ Manual sweep executed successfully! Swept ${sweeper} expired booking(s), expired ${wl} waitlist claim(s), completed ${tc} trip(s), sent ${rem} reminder(s).`
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setRunningSweep(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#121624] p-6 shadow-xl relative overflow-hidden">
      {/* Glow highlight */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-xl">⏱️</span>
            <h3 className="text-lg font-bold text-white tracking-wide">Automations & Background Cron Engine</h3>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              RUNNING (60s Cadence)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Automates 5-min pending seat reservation expiry, corridor relay waitlist queues, terminal trip completions & departure dispatch alerts.
          </p>
        </div>

        <button
          onClick={handleTriggerSweep}
          disabled={runningSweep}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {runningSweep ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span>Executing Sweepers...</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>Run Sweeper Suite Now</span>
            </>
          )}
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}
      {error && (
        <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
        <div className="rounded-xl border border-slate-800 bg-[#0d101d] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Swept Unpaid Seats</span>
            <span className="text-amber-400 text-xs">🪑</span>
          </div>
          <p className="text-2xl font-black font-mono text-white mt-1">
            {stats?.total_swept_bookings ?? 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">&gt; 5-min timeout cancellations</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d101d] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Expired Waitlists</span>
            <span className="text-sky-400 text-xs">⏳</span>
          </div>
          <p className="text-2xl font-black font-mono text-white mt-1">
            {stats?.total_expired_waitlists ?? 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">5-min claims re-queued</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d101d] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Arrived Trips Done</span>
            <span className="text-emerald-400 text-xs">🏁</span>
          </div>
          <p className="text-2xl font-black font-mono text-white mt-1">
            {stats?.total_completed_trips ?? 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">Terminal stop reached</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0d101d] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sweeper Cycles</span>
            <span className="text-purple-400 text-xs">🔄</span>
          </div>
          <p className="text-2xl font-black font-mono text-white mt-1">
            {stats?.runs_count ?? 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            Last: {stats?.last_run ? new Date(stats.last_run).toLocaleTimeString() : 'Awaiting 1st tick'}
          </p>
        </div>
      </div>

      {/* Operational Rules Summary */}
      <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-400">
        <div className="flex items-start gap-2 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/50">
          <span className="text-indigo-400 font-bold">1.</span>
          <span><strong>5-Min Payment Lock:</strong> Reserved seats release automatically to corridor relay if Daraja STK is not completed.</span>
        </div>
        <div className="flex items-start gap-2 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/50">
          <span className="text-indigo-400 font-bold">2.</span>
          <span><strong>Next-In-Line Waitlist:</strong> When an offer window passes 5 mins, the slot shifts to the next waitlisted passenger.</span>
        </div>
        <div className="flex items-start gap-2 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/50">
          <span className="text-indigo-400 font-bold">3.</span>
          <span><strong>Terminal Arrival Auto-Complete:</strong> Vehicle GPS / driver stop updates automatically mark trips 'completed' at the final terminus.</span>
        </div>
      </div>
    </div>
  );
}

