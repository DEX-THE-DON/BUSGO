'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchTrips, TripOption } from '@/services/api';
import { IconSearch } from './FluxIcons';

export interface SearchTabItem {
  id: string;
  label: string;
  groupTitle?: string;
}

export interface TopNavSearchBarProps {
  placeholder?: string;
  onSearchChange?: (val: string) => void;
  onTabSelect?: (tabId: string) => void;
  availableTabs?: SearchTabItem[];
  className?: string;
}

interface QuickPortal {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
}

const TRANSIT_PORTALS: QuickPortal[] = [
  {
    id: 'parcels',
    title: 'Mzigo Express Parcel Courier',
    subtitle: 'Doorstep pickup, intercity coach cargo & destination delivery',
    href: '/parcels',
    icon: '📦',
    badge: 'COURIER',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  {
    id: 'dispatcher',
    title: 'Stage Dispatcher & Walk-In POS',
    subtitle: '1-tap cash ticketing, departure manifest & Mshiko wa Stage',
    href: '/dispatcher',
    icon: '📋',
    badge: 'POS',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  {
    id: 'radar',
    title: 'Highway Radar & Blackspot Alerts',
    subtitle: 'National GIS live fleet map, Mai Mahiu & Salgaa safety geofencing',
    href: '/radar',
    icon: '📡',
    badge: 'SAFETY',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  },
  {
    id: 'onboard',
    title: 'Nganya Screen & Captive Wi-Fi',
    subtitle: 'In-bus speedometer, stop request bell & Manyanga DJ soundboard',
    href: '/onboard',
    icon: '🎵',
    badge: 'HUD',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
  {
    id: 'lost-found',
    title: 'Nipe Shugli — Highway Lost & Found',
    subtitle: 'Claim left-behind luggage, bags, electronics & national IDs',
    href: '/lost-found',
    icon: '🧳',
    badge: 'REGISTRY',
    badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
  {
    id: 'ussd',
    title: '*384*254# Offline USSD Simulator',
    subtitle: 'Feature phone booking & seat availability for rural transit',
    href: '/ussd',
    icon: '📟',
    badge: 'TELCO',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  {
    id: 'booking',
    title: 'Passenger Seat Booking & Changa',
    subtitle: 'Bei ya Mfuko, Harambee group split fare & seat map reservation',
    href: '/',
    icon: '💺',
    badge: 'BOOK',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  },
  {
    id: 'driver',
    title: 'Driver Operating Console',
    subtitle: 'Trip controls, QR passenger boarding scanner & Mzigo parcels',
    href: '/driver',
    icon: '🚌',
    badge: 'DRIVER',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  },
  {
    id: 'admin',
    title: 'SACCO & Fleet Admin Hub',
    subtitle: 'Fleet compliance, vehicle telematics, settlements & automated crons',
    href: '/admin',
    icon: '⚙️',
    badge: 'ADMIN',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  },
];

export default function TopNavSearchBar({
  placeholder = 'Search trips, routes, waybills, portals...',
  onSearchChange,
  onTabSelect,
  availableTabs = [],
  className = '',
}: TopNavSearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isMac, setIsMac] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect OS for shortcut badge
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    }
  }, []);

  // Fetch available trips for live search
  useEffect(() => {
    let mounted = true;
    fetchTrips()
      .then((data) => {
        if (mounted) setTrips(data.trips || []);
      })
      .catch((err) => console.warn('Could not pre-load trips for search bar:', err));
    return () => {
      mounted = false;
    };
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K or '/'
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === '/' && !isInput) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);
    if (!isOpen) setIsOpen(true);
    onSearchChange?.(val);
  };

  const cleanQuery = query.trim().toLowerCase();

  // 1. Matched Tabs
  const matchedTabs = useMemo(() => {
    if (!cleanQuery) return [];
    return availableTabs.filter((t) =>
      t.label.toLowerCase().includes(cleanQuery) ||
      t.id.toLowerCase().includes(cleanQuery) ||
      (t.groupTitle && t.groupTitle.toLowerCase().includes(cleanQuery))
    );
  }, [cleanQuery, availableTabs]);

  // 2. Matched Portals
  const matchedPortals = useMemo(() => {
    if (!cleanQuery) return TRANSIT_PORTALS.slice(0, 6);
    return TRANSIT_PORTALS.filter((p) =>
      p.title.toLowerCase().includes(cleanQuery) ||
      p.subtitle.toLowerCase().includes(cleanQuery) ||
      p.id.toLowerCase().includes(cleanQuery)
    );
  }, [cleanQuery]);

  // 3. Matched Trips
  const matchedTrips = useMemo(() => {
    if (!cleanQuery) return trips.slice(0, 4);
    return trips.filter((t) =>
      t.name.toLowerCase().includes(cleanQuery) ||
      t.route_name.toLowerCase().includes(cleanQuery) ||
      (t.plate_number && t.plate_number.toLowerCase().includes(cleanQuery)) ||
      (t.sacco_name && t.sacco_name.toLowerCase().includes(cleanQuery))
    );
  }, [cleanQuery, trips]);

  // 4. Detected Ticket / Waybill / Verification query
  const isTicketOrWaybillQuery = useMemo(() => {
    if (!cleanQuery) return false;
    return (
      cleanQuery.startsWith('wb-') ||
      cleanQuery.startsWith('mzg-') ||
      cleanQuery.startsWith('bg-') ||
      cleanQuery.startsWith('busgo') ||
      cleanQuery.startsWith('cash-') ||
      cleanQuery.startsWith('stg-') ||
      cleanQuery.startsWith('b2c') ||
      (cleanQuery.length >= 7 && /^\d+$/.test(cleanQuery))
    );
  }, [cleanQuery]);

  interface ActionableItem {
    type: 'tab' | 'portal' | 'trip' | 'ticket' | 'waybill';
    key: string;
    action: () => void;
  }

  const navigateToTrip = (targetTripId: number) => {
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      window.history.pushState({}, '', `/?trip=${targetTripId}`);
      window.dispatchEvent(new CustomEvent('busgo:select-trip', { detail: { tripId: targetTripId } }));
    } else {
      router.push(`/?trip=${targetTripId}`);
    }
    setIsOpen(false);
  };

  const actionableItems = useMemo<ActionableItem[]>(() => {
    const list: ActionableItem[] = [];

    if (isTicketOrWaybillQuery) {
      if (cleanQuery.startsWith('wb-') || cleanQuery.startsWith('mzg-')) {
        list.push({
          type: 'waybill',
          key: `waybill-parcels-${cleanQuery}`,
          action: () => {
            router.push(`/parcels?code=${encodeURIComponent(query.trim())}`);
            setIsOpen(false);
          },
        });
      } else {
        list.push({
          type: 'ticket',
          key: `ticket-user-${cleanQuery}`,
          action: () => {
            router.push(`/user?tab=tracker&ref=${encodeURIComponent(query.trim())}`);
            setIsOpen(false);
          },
        });
      }
      list.push({
        type: 'ticket',
        key: `ticket-driver-${cleanQuery}`,
        action: () => {
          router.push(`/driver`);
          setIsOpen(false);
        },
      });
    }

    matchedTabs.forEach((tab) => {
      list.push({
        type: 'tab',
        key: `tab-${tab.id}`,
        action: () => {
          onTabSelect?.(tab.id);
          setIsOpen(false);
        },
      });
    });

    matchedPortals.forEach((portal) => {
      list.push({
        type: 'portal',
        key: `portal-${portal.id}`,
        action: () => {
          router.push(portal.href);
          setIsOpen(false);
        },
      });
    });

    matchedTrips.forEach((trip) => {
      list.push({
        type: 'trip',
        key: `trip-${trip.id}`,
        action: () => {
          navigateToTrip(trip.id);
        },
      });
    });

    return list;
  }, [isTicketOrWaybillQuery, cleanQuery, query, matchedTabs, matchedPortals, matchedTrips, onTabSelect, router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, actionableItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + actionableItems.length) % Math.max(1, actionableItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (actionableItems[selectedIndex]) {
        actionableItems[selectedIndex].action();
      }
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQuery('');
    onSearchChange?.('');
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative w-full max-w-sm sm:max-w-md ${className}`}>
      {/* Search Input Box */}
      <div
        className={`relative flex items-center w-full rounded-xl bg-[#121624] border transition-all duration-200 shadow-inner ${
          isOpen
            ? 'border-cyan-500/80 shadow-cyan-500/10 ring-2 ring-cyan-500/20'
            : 'border-slate-800/80 hover:border-slate-700'
        }`}
      >
        <span className="pl-3.5 pr-2 flex items-center pointer-events-none text-slate-400">
          <IconSearch className="w-4 h-4 text-cyan-400/80" />
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full py-2 bg-transparent text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
        />

        <div className="flex items-center gap-1.5 pr-2.5">
          {query ? (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition text-[11px]"
              title="Clear search"
            >
              ✕
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-700/80 rounded shadow-sm select-none">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          )}
        </div>
      </div>

      {/* Floating Results Modal / Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 z-50 w-[calc(100vw-2rem)] sm:w-[520px] md:w-[600px] max-w-2xl bg-[#0c101c] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-black/80 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-[80vh] flex flex-col">
          {/* Header Indicator */}
          <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
              <span>⚡</span>
              {query ? `Search Results for "${query}"` : 'Quick Transit Navigation'}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              Use <kbd className="px-1 bg-slate-900 border border-slate-800 rounded">↑</kbd>{' '}
              <kbd className="px-1 bg-slate-900 border border-slate-800 rounded">↓</kbd> to navigate,{' '}
              <kbd className="px-1 bg-slate-900 border border-slate-800 rounded">↵</kbd> to select
            </span>
          </div>

          <div className="overflow-y-auto p-2 space-y-3 divide-y divide-slate-800/40">
            {/* Section 0: Detected Ticket or Waybill Code Verification */}
            {isTicketOrWaybillQuery && (
              <div className="pt-1">
                <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
                  <span>📦</span> Ticket &amp; Waybill Tracking
                </div>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (cleanQuery.startsWith('wb-') || cleanQuery.startsWith('mzg-')) {
                        router.push(`/parcels?code=${encodeURIComponent(query.trim())}`);
                      } else {
                        router.push(`/user?tab=tracker&ref=${encodeURIComponent(query.trim())}`);
                      }
                      setIsOpen(false);
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between ${
                      actionableItems[selectedIndex]?.type === 'ticket' || actionableItems[selectedIndex]?.type === 'waybill'
                        ? 'bg-cyan-500/20 border-cyan-500 text-white'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">🔍</span>
                      <div>
                        <div className="font-bold text-xs flex items-center gap-2">
                          <span>Track Ref #{query.trim()}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                            LIVE TRACKER
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Inspect journey milestones, delivery mode, GPS &amp; secret PIN status
                        </div>
                      </div>
                    </div>
                    <span className="text-cyan-400 text-xs font-mono">Jump &rarr;</span>
                  </button>
                </div>
              </div>
            )}

            {/* Section 1: Dashboard Tabs (if provided) */}
            {matchedTabs.length > 0 && (
              <div className="pt-2">
                <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <span>📑</span> Current Dashboard Views
                </div>
                <div className="space-y-1">
                  {matchedTabs.map((tab) => {
                    const itemKey = `tab-${tab.id}`;
                    const isSelected = actionableItems[selectedIndex]?.key === itemKey;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          onTabSelect?.(tab.id);
                          setIsOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl transition flex items-center justify-between text-xs ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-900/40'
                            : 'hover:bg-slate-900 text-slate-300'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-blue-400">❖</span>
                          <span>{tab.label}</span>
                          {tab.groupTitle && (
                            <span className="text-[10px] text-slate-500 font-normal">
                              in {tab.groupTitle}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-mono opacity-60">Switch View</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 2: Trips & Active Routes */}
            {matchedTrips.length > 0 && (
              <div className="pt-2">
                <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span>🚍</span> Available Highway Trips &amp; Routes
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{matchedTrips.length} active</span>
                </div>
                <div className="space-y-1.5">
                  {matchedTrips.map((trip) => {
                    const itemKey = `trip-${trip.id}`;
                    const isSelected = actionableItems[selectedIndex]?.key === itemKey;
                    return (
                      <button
                        key={trip.id}
                        type="button"
                        onClick={() => navigateToTrip(trip.id)}
                        className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between text-xs ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500 text-white'
                            : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center font-mono font-black text-amber-400 text-xs shrink-0">
                            #{trip.id}
                          </span>
                          <div>
                            <div className="font-bold flex items-center gap-2">
                              <span>{trip.name}</span>
                              {trip.sacco_name && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-slate-800 text-cyan-300">
                                  {trip.sacco_name}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span>{trip.route_name}</span>
                              <span>&bull;</span>
                              <span className="font-mono text-slate-300">{trip.plate_number || 'Fleet Bus'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono shrink-0">
                          <span className="text-emerald-400 font-bold block">
                            KES {trip.fixed_price || 350}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase">
                            {trip.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 3: Transit Portals & Quick Tools */}
            <div className="pt-2">
              <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-sky-400 flex items-center gap-1">
                <span>⚡</span> Transit Portals &amp; Operations
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedPortals.map((portal) => {
                  const itemKey = `portal-${portal.id}`;
                  const isSelected = actionableItems[selectedIndex]?.key === itemKey;
                  return (
                    <button
                      key={portal.id}
                      type="button"
                      onClick={() => {
                        router.push(portal.href);
                        setIsOpen(false);
                      }}
                      className={`text-left p-2 rounded-xl border transition flex items-start gap-2.5 ${
                        isSelected
                          ? 'bg-sky-500/20 border-sky-500 text-white'
                          : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <span className="text-lg p-1 rounded-lg bg-slate-900 border border-slate-800 shrink-0">
                        {portal.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-xs truncate text-white">
                            {portal.title}
                          </span>
                          {portal.badge && (
                            <span
                              className={`text-[8px] px-1 py-0.2 rounded font-bold uppercase border shrink-0 ${portal.badgeColor}`}
                            >
                              {portal.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                          {portal.subtitle}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom Footer Hint */}
          <div className="px-4 py-2 bg-[#090d16] border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              Tip: Type <span className="font-mono text-cyan-400">&quot;Nairobi&quot;</span>,{' '}
              <span className="font-mono text-amber-400">&quot;Parcels&quot;</span>, or waybill{' '}
              <span className="font-mono text-emerald-400">&quot;WB-&quot;</span>
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Close [ESC]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

