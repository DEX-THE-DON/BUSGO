'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import NotificationsBell from '@/components/NotificationsBell';
import TopNavSearchBar from './TopNavSearchBar';
import {
  IconEmblem,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconLogOut,
  IconUser,
  IconMessageSquare,
  IconSettings,
  IconInboxTray,
  IconBell,
} from './FluxIcons';
import { FluxHeroBanner, FluxMetric } from './FluxWidgets';

export interface FluxNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  badgeColor?: string;
}

export interface FluxNavGroup {
  title: string;
  items: FluxNavItem[];
}

export interface FluxDashboardShellProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  navGroups: FluxNavGroup[];
  metrics: FluxMetric[];
  heroGreeting?: string;
  heroSubtitle?: string;
  primaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  searchPlaceholder?: string;
  children: React.ReactNode;
}

export default function FluxDashboardShell({
  activeTab,
  onTabChange,
  navGroups,
  metrics,
  heroGreeting,
  heroSubtitle,
  primaryAction,
  searchPlaceholder = 'Search anything...',
  children,
}: FluxDashboardShellProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (messagesRef.current && !messagesRef.current.contains(e.target as Node)) {
        setMessagesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const transitMessages = [
    { sender: 'Transit Operations', time: '2m ago', preview: 'Mombasa Highway Express bus KDA 451B departure on schedule.' },
    { sender: 'Fleet Dispatch', time: '18m ago', preview: 'Driver shift handover verified for Route #12 Kisumu line.' },
    { sender: 'Ticketing Support', time: '1h ago', preview: 'Online booking #BK-8829 seat reassignment confirmed.' },
  ];

  // Extract initials from user full_name
  const getInitials = (name?: string) => {
    if (!name) return 'AJ';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const initials = getInitials(user?.full_name);
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Admin';

  const availableTabs = useMemo(() => {
    return navGroups.flatMap((g) =>
      g.items.map((item) => ({
        id: item.id,
        label: item.label,
        groupTitle: g.title,
      }))
    );
  }, [navGroups]);

  const sidebarContent = (
    <aside
      className={`flex flex-col h-full bg-[#090d16] border-r border-[#171c2c] transition-all duration-300 select-none ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-20 items-center justify-between px-5 border-b border-[#171c2c]">
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <IconEmblem className="w-8 h-8 shrink-0 text-cyan-400" />
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                BusGo
              </span>
              <span className="text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                TRANSIT DASHBOARD
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex h-7 w-7 items-center justify-center rounded-full bg-[#141928] text-slate-400 hover:text-white hover:bg-[#1f273d] transition border border-[#222b42]"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <IconChevronRight className="w-3.5 h-3.5" /> : <IconChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {navGroups.map((group, gIdx) => (
          <div key={gIdx}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                {group.title}
              </p>
            )}
            <nav className="space-y-1">
              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onTabChange(item.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-[#1a2035] text-white shadow-sm border border-indigo-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-[#121626]'
                    } ${collapsed ? 'justify-center' : 'justify-between'}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={isActive ? 'text-indigo-400' : 'text-slate-400'}>
                        {item.icon}
                      </span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </div>

                    {!collapsed && item.badge !== undefined && (
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          item.badgeColor || 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* User Profile Footer */}
      <div className="p-4 border-t border-[#171c2c]">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-xs font-black text-white shrink-0 shadow-md">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{user?.full_name || 'Fleet Operator'}</p>
                <p className="text-[10px] text-slate-400 truncate">{roleLabel}</p>
              </div>
            )}
          </div>

          {!collapsed && (
            <button
              onClick={logout}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
              title="Log out"
            >
              <IconLogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 flex overflow-x-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block shrink-0 sticky top-0 h-screen z-30">
        {sidebarContent}
      </div>

      {/* Mobile Sidebar Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-40 h-20 bg-[#090d16]/95 backdrop-blur-md border-b border-[#171c2c] px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 max-w-xl">
            {/* Blue < Menu Button */}
            <button
              onClick={() => {
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setMobileOpen((m) => !m);
                } else {
                  setCollapsed((c) => !c);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition flex items-center gap-1.5 shrink-0"
              title="Toggle Menu"
            >
              <IconChevronLeft className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
              <span className="hidden xs:inline sm:inline">Menu</span>
            </button>

            {/* Interactive Search bar with Dashboard Tabs & Global Portals */}
            <TopNavSearchBar
              placeholder={searchPlaceholder}
              availableTabs={availableTabs}
              onTabSelect={(tabId) => onTabChange(tabId)}
              className="w-full min-w-0 flex-1"
            />
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Primary Action Button */}
            {primaryAction && (
              primaryAction.href ? (
                <Link
                  href={primaryAction.href}
                  className="hidden md:flex bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition items-center gap-1.5 shrink-0"
                >
                  {primaryAction.label}
                </Link>
              ) : (
                <button
                  onClick={primaryAction.onClick}
                  className="hidden md:flex bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition items-center gap-1.5 shrink-0"
                >
                  {primaryAction.label}
                </button>
              )
            )}

            {/* Notifications Bell with Coral Badge Dot */}
            <div className="relative shrink-0">
              <NotificationsBell
                externalOpen={notifOpen}
                onExternalToggle={() => {
                  setNotifOpen((o) => !o);
                  setMessagesOpen(false);
                  setUserMenuOpen(false);
                }}
              />
            </div>

            {/* Messages Button with Coral Badge Dot */}
            <div ref={messagesRef} className="relative shrink-0">
              <button
                onClick={() => {
                  setMessagesOpen((o) => !o);
                  setNotifOpen(false);
                  setUserMenuOpen(false);
                }}
                className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#141928] hover:bg-[#1e2540] text-slate-300 hover:text-white flex items-center justify-center transition border border-[#1e2540] shadow-sm"
                title="Messages"
              >
                <IconMessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                {/* Coral red badge dot */}
                <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#090d16]" />
              </button>

              {/* Messages Popover Dropdown */}
              {messagesOpen && (
                <div className="absolute right-0 mt-2.5 w-[calc(100vw-2rem)] max-w-sm sm:w-80 max-h-96 overflow-y-auto rounded-2xl border border-slate-800 bg-[#0e1322] shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-left">
                  <div className="sticky top-0 bg-[#0e1322]/95 backdrop-blur px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">Messages</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                        3 new
                      </span>
                    </div>
                    <button
                      onClick={() => setMessagesOpen(false)}
                      className="text-xs text-slate-400 hover:text-white transition"
                    >
                      Close
                    </button>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {transitMessages.map((msg, i) => (
                      <div
                        key={i}
                        className="px-4 py-3 hover:bg-slate-800/30 transition cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-200">{msg.sender}</p>
                          <span className="text-[10px] text-slate-500 font-mono">{msg.time}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{msg.preview}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Trigger & Dropdown */}
            <div ref={userMenuRef} className="relative shrink-0">
              <button
                onClick={() => {
                  setUserMenuOpen((o) => !o);
                  setNotifOpen(false);
                  setMessagesOpen(false);
                }}
                className="flex items-center gap-2 sm:gap-2.5 p-1 sm:px-2 py-1 rounded-xl hover:bg-slate-800/50 transition border border-transparent hover:border-slate-800 text-left cursor-pointer"
                title="User Profile Menu"
              >
                <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-md border border-white/20 shrink-0">
                  <span>{initials}</span>
                </div>
                <div className="hidden sm:block min-w-0">
                  <p className="text-xs sm:text-sm font-semibold text-white truncate max-w-[100px] lg:max-w-[130px]">
                    {user?.full_name || 'Passenger'}
                  </p>
                  <p className="text-[10px] text-slate-400 capitalize truncate">{roleLabel}</p>
                </div>
              </button>

              {/* User Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2.5 w-[calc(100vw-2rem)] max-w-xs sm:w-60 rounded-2xl border border-slate-800 bg-[#0e1322] shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-left">
                  {/* Top user header */}
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow shrink-0 overflow-hidden">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-white truncate">
                        {user?.full_name || 'Adam Joe'}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {user?.email || 'Email@gmail.com'}
                      </p>
                    </div>
                  </div>

                  <div className="h-px bg-slate-800/80 my-1.5" />

                  {/* Menu items matching screenshot */}
                  <div className="space-y-0.5 text-xs">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (typeof window !== 'undefined' && window.location.pathname === '/user') {
                          onTabChange('account');
                        } else {
                          router.push('/user?tab=account');
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/60 transition text-left cursor-pointer"
                    >
                      <IconUser className="w-4 h-4 text-slate-400" />
                      <span>View Profile</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setNotifOpen(true);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/60 transition"
                    >
                      <IconBell className="w-4 h-4 text-slate-400" />
                      <span>Notifications</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setMessagesOpen(true);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/60 transition"
                    >
                      <IconInboxTray className="w-4 h-4 text-slate-400" />
                      <span>Messages</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onTabChange('settings');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/60 transition"
                    >
                      <IconSettings className="w-4 h-4 text-slate-400" />
                      <span>Settings</span>
                    </button>

                    <div className="h-px bg-slate-800/80 my-1.5" />

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition"
                    >
                      <IconLogOut className="w-4 h-4 text-rose-400" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Workspace Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
          {/* Top Hero Banner */}
          <FluxHeroBanner
            userName={user?.full_name?.split(' ')[0]}
            greeting={heroGreeting}
            subtitle={heroSubtitle}
            metrics={metrics}
          />

          {/* Workspace Tab Content */}
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

