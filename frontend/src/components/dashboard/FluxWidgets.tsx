'use client';

import React, { useState } from 'react';
import { IconZap, IconTrendingUp } from './FluxIcons';

export interface FluxMetric {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export interface FluxHeroBannerProps {
  userName?: string;
  greeting?: string;
  subtitle?: string;
  metrics: FluxMetric[];
}

export function FluxHeroBanner({
  userName,
  greeting,
  subtitle = "Here's what's happening with your product today.",
  metrics,
}: FluxHeroBannerProps) {
  const getGreeting = () => {
    if (greeting) return greeting;
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = userName || 'Aigars';

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#6254f3] via-[#5d71f7] to-[#04a9e5] p-6 sm:p-8 text-white shadow-2xl shadow-indigo-500/10">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 rounded-full bg-purple-900/30 blur-3xl" />

      {/* Header section */}
      <div className="relative z-10 mb-6">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white drop-shadow-sm">
          {getGreeting()}, {displayName}
        </h1>
        <p className="mt-1.5 text-sm sm:text-base font-normal text-white/80 max-w-2xl">
          {subtitle}
        </p>
      </div>

      {/* 4 Glassmorphism Metric Cards */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.slice(0, 4).map((m, idx) => (
          <div
            key={idx}
            className="group rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5 backdrop-blur-md transition-all duration-300 hover:bg-white/[0.16] hover:border-white/30 hover:scale-[1.01]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-white/85">
              <span className="text-white/70">
                {m.icon || <IconZap className="w-3.5 h-3.5" />}
              </span>
              <span>{m.label}</span>
            </div>

            <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white font-mono">
              {m.value}
            </div>

            {m.change && (
              <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                <IconTrendingUp className="w-3 h-3 text-cyan-200" />
                <span>{m.change}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FluxChartCard({
  title = 'Revenue Growth',
  subtitle = 'Monthly recurring revenue trend',
  data,
}: {
  title?: string;
  subtitle?: string;
  data?: { labels: string[]; values: number[] };
}) {
  const [mode, setMode] = useState<'MRR' | 'ARR'>('MRR');

  // Default curve coordinates matching the screenshot's smooth uphill curve
  const labels = data?.labels || ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'];
  const yLabels = mode === 'MRR' ? ['$60K', '$45K', '$30K', '$15K', '$0K'] : ['$720K', '$540K', '$360K', '$180K', '$0K'];

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-base font-bold text-white tracking-wide">{title}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#0a0d16] p-1 border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setMode('MRR')}
            className={`rounded-md px-3 py-1 transition ${
              mode === 'MRR' ? 'bg-[#1e253c] text-white font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            MRR
          </button>
          <button
            onClick={() => setMode('ARR')}
            className={`rounded-md px-3 py-1 transition ${
              mode === 'ARR' ? 'bg-[#1e253c] text-white font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ARR
          </button>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="relative w-full h-64 sm:h-72">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 700 240" preserveAspectRatio="none">
          <defs>
            <linearGradient id="flux-chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#6366f1" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="50%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="45" y1="20" x2="690" y2="20" stroke="#1f293d" strokeDasharray="3 3" />
          <line x1="45" y1="65" x2="690" y2="65" stroke="#1f293d" strokeDasharray="3 3" />
          <line x1="45" y1="110" x2="690" y2="110" stroke="#1f293d" strokeDasharray="3 3" />
          <line x1="45" y1="155" x2="690" y2="155" stroke="#1f293d" strokeDasharray="3 3" />
          <line x1="45" y1="200" x2="690" y2="200" stroke="#1f293d" />

          {/* Area fill */}
          <path
            d="M 50 145 C 150 142, 220 135, 320 128 C 420 120, 520 100, 680 75 L 680 200 L 50 200 Z"
            fill="url(#flux-chart-grad)"
          />

          {/* Glowing Line */}
          <path
            d="M 50 145 C 150 142, 220 135, 320 128 C 420 120, 520 100, 680 75"
            fill="none"
            stroke="url(#line-grad)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Glowing data points */}
          <circle cx="50" cy="145" r="4" fill="#818cf8" stroke="#121624" strokeWidth="2" />
          <circle cx="320" cy="128" r="4" fill="#a78bfa" stroke="#121624" strokeWidth="2" />
          <circle cx="680" cy="75" r="5" fill="#38bdf8" stroke="#121624" strokeWidth="2" className="animate-pulse" />
        </svg>

        {/* Y Axis Labels */}
        <div className="absolute left-0 top-0 bottom-8 flex flex-col justify-between text-[11px] font-mono text-slate-500 pointer-events-none">
          {yLabels.map((lbl, i) => (
            <span key={i}>{lbl}</span>
          ))}
        </div>

        {/* X Axis Labels */}
        <div className="absolute left-10 right-2 bottom-0 flex justify-between text-[11px] font-mono text-slate-500 pointer-events-none">
          {labels.map((lbl, i) => (
            <span key={i}>{lbl}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FluxProgressWidget({
  title = 'Sprint 24',
  subtitle = '5 days remaining',
  linkText = 'View board ↗',
  onLinkClick,
  segments = [
    { label: 'Completed', count: 14, color: 'bg-cyan-400', pct: 65 },
    { label: 'In Progress', count: 5, color: 'bg-amber-400', pct: 25 },
    { label: 'To Do', count: 2, color: 'bg-slate-600', pct: 10 },
  ],
}: {
  title?: string;
  subtitle?: string;
  linkText?: string;
  onLinkClick?: () => void;
  segments?: { label: string; count: number; color: string; pct: number }[];
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-5 sm:p-6 shadow-xl">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-white tracking-wide">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        {linkText && (
          <button
            onClick={onLinkClick}
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
          >
            {linkText}
          </button>
        )}
      </div>

      {/* Multi-segment progress bar */}
      <div className="mt-5 h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden flex">
        {segments.map((s, idx) => (
          <div
            key={idx}
            style={{ width: `${s.pct}%` }}
            className={`h-full ${s.color} transition-all duration-500`}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-300">
        {segments.map((s, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            <span>
              {s.label} <span className="text-slate-400 font-mono">({s.count})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ActivityItem {
  id: string | number;
  initials: string;
  name: string;
  action: string;
  time: string;
  avatarColor?: string; // e.g. 'bg-blue-500/20 text-blue-400 border-blue-500/30'
}

export function FluxActivityWidget({
  title = 'Team Activity',
  subtitle = 'Latest from your team',
  linkText = 'View all ↗',
  onLinkClick,
  items,
}: {
  title?: string;
  subtitle?: string;
  linkText?: string;
  onLinkClick?: () => void;
  items?: ActivityItem[];
}) {
  const defaultItems: ActivityItem[] = [
    {
      id: 1,
      initials: 'SC',
      name: 'Sarah C.',
      action: 'merged PR #284',
      time: '3m',
      avatarColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    },
    {
      id: 2,
      initials: 'AM',
      name: 'Alex M.',
      action: 'deployed to production',
      time: '12m',
      avatarColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    },
    {
      id: 3,
      initials: 'PK',
      name: 'Priya K.',
      action: 'opened issue #92',
      time: '28m',
      avatarColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      id: 4,
      initials: 'ML',
      name: 'Marcus L.',
      action: 'reviewed PR #281',
      time: '45m',
      avatarColor: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    },
    {
      id: 5,
      initials: 'JT',
      name: 'Jen T.',
      action: 'closed issue #88',
      time: '1h',
      avatarColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    },
  ];

  const list = items || defaultItems;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#121624] p-5 sm:p-6 shadow-xl">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-white tracking-wide">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        {linkText && (
          <button
            onClick={onLinkClick}
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
          >
            {linkText}
          </button>
        )}
      </div>

      <div className="mt-5 space-y-3.5">
        {list.map((act) => (
          <div key={act.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border font-bold text-[11px] ${
                  act.avatarColor || 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                }`}
              >
                {act.initials}
              </span>
              <p className="text-slate-300">
                <span className="font-semibold text-white">{act.name}</span>{' '}
                <span className="text-slate-400">{act.action}</span>
              </p>
            </div>
            <span className="font-mono text-slate-500 shrink-0 text-[11px]">{act.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

