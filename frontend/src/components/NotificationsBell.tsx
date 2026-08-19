'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getToken, wsBaseUrl } from '@/services/api';
import {
  fetchNotifications,
  markAllNotificationsRead,
  AppNotification,
} from '@/services/api';

/**
 * Notification bell with a dropdown. Listens on the authenticated
 * /ws/notifications channel and refreshes the list on live events
 * (seat_freed, booking_confirmed, payment_update, ...).
 */
export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
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
    load();
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
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      ws.close();
    };
  }, []);

  const handleMarkAll = async () => {
    await markAllNotificationsRead();
    load();
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-lg"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl z-50">
          <div className="sticky top-0 bg-slate-900/95 backdrop-blur px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-black text-slate-200">Notifications</span>
            <button onClick={handleMarkAll} className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold">
              Mark all read
            </button>
          </div>

          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {items.map((n) => (
                <li key={n.id} className={`px-4 py-3 ${n.read ? 'opacity-60' : ''}`}>
                  <p className="text-sm font-bold text-slate-100">
                    {n.read ? '' : <span className="text-emerald-400 mr-1">●</span>}
                    {n.title}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{n.body}</p>
                  {n.created_at && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      {new Date(n.created_at).toLocaleString()}
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
