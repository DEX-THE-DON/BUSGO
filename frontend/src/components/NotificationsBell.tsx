'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getToken, wsBaseUrl } from '@/services/api';
import {
  fetchNotifications,
  markAllNotificationsRead,
  AppNotification,
} from '@/services/api';
import { IconBell } from '@/components/dashboard/FluxIcons';

export interface NotificationsBellProps {
  externalOpen?: boolean;
  onExternalToggle?: () => void;
}

/**
 * Notification bell with a dropdown. Listens on the authenticated
 * /ws/notifications channel and refreshes the list on live events
 * (seat_freed, booking_confirmed, payment_update, ...).
 */
export default function NotificationsBell({
  externalOpen,
  onExternalToggle,
}: NotificationsBellProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const toggleOpen = () => {
    if (onExternalToggle) {
      onExternalToggle();
    } else {
      setInternalOpen((o) => !o);
    }
  };

  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetchNotifications(20);
      setItems(res.notifications);
      setUnread(res.unread);
    } catch {
      /* backend offline — ignore */
    }
  };

  useEffect(() => {
    let active = true;
    fetchNotifications(20)
      .then((res) => {
        if (active) {
          setItems(res.notifications);
          setUnread(res.unread);
        }
      })
      .catch(() => {});

    const ws = new WebSocket(
      `${wsBaseUrl()}/ws/notifications?token=${encodeURIComponent(getToken() ?? '')}`,
    );
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'notification') {
          load();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        if (externalOpen !== undefined && onExternalToggle && externalOpen) {
          onExternalToggle();
        } else {
          setInternalOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      active = false;
      ws.close();
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [externalOpen, onExternalToggle]);

  const handleMarkAll = async () => {
    await markAllNotificationsRead();
    load();
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={toggleOpen}
        className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#141928] hover:bg-[#1e2540] text-slate-300 hover:text-white flex items-center justify-center transition border border-[#1e2540] shadow-sm"
        title="Notifications"
      >
        <IconBell className="w-4 h-4 sm:w-5 sm:h-5" />
        {/* Coral / red badge dot matching reference screenshot */}
        <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#090d16]" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-[calc(100vw-2rem)] max-w-sm sm:w-80 max-h-96 overflow-y-auto rounded-2xl border border-slate-800 bg-[#0e1322] shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="sticky top-0 bg-[#0e1322]/95 backdrop-blur px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Notifications</span>
              {unread > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                  {unread} new
                </span>
              )}
            </div>
            <button
              onClick={handleMarkAll}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
            >
              Mark all read
            </button>
          </div>

          {items.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-400">All caught up!</p>
              <p>No new transit notifications at this moment.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 hover:bg-slate-800/30 transition ${
                    n.read ? 'opacity-60' : 'bg-indigo-950/20'
                  }`}
                >
                  <p className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
                    {n.title}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
                  {n.created_at && (
                    <p className="text-[9px] text-slate-500 mt-1 font-mono">
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
