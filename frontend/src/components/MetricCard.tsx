'use client';

import React from 'react';
import { trendInfo } from '@/lib/format';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  /** previous-period value to render a ▲/▼ trend chip */
  previous?: number | null;
  /** emerald (positive/good) or rose (cost/bad) accent */
  accent?: 'emerald' | 'rose' | 'neutral';
  /** show the value in monospace with tabular figures */
  mono?: boolean;
}

/**
 * Fintech-style summary widget: a big number with a micro-label underneath
 * and an optional ▲/▼ trend indicator — the "Today's Summary" building block.
 */
export default function MetricCard({
  label,
  value,
  sub,
  previous,
  accent = 'emerald',
  mono = true,
}: MetricCardProps) {
  const trend = previous !== undefined && previous !== null ? trendInfo(Number(value.replace(/[^\d.\-]/g, '')), previous) : null;

  const valueColor =
    accent === 'emerald' ? 'text-emerald-400' : accent === 'rose' ? 'text-rose-400' : 'text-slate-100';

  return (
    <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-xl">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${valueColor} ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</p>
      {trend && (
        <p className={`mt-1 text-xs font-bold font-mono tabular-nums ${trend.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trend.arrow} {trend.pct > 0 ? '+' : ''}
          {trend.pct}%
        </p>
      )}
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
