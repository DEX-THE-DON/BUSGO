'use client';

import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);

  useEffect(() => {
    // 1. Service Worker Registration
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('[PWA] ServiceWorker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] ServiceWorker registration failed:', err);
          });
      });
    }

    // 2. Install Prompt Listener
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // 3. Online/Offline Listener
    if (typeof window !== 'undefined') {
      setIsOffline(!window.navigator.onLine);
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      console.log('[PWA] User accepted installation prompt');
      setShowInstallBanner(false);
    }
    setDeferredPrompt(null);
  };

  return (
    <>
      {/* Global Offline Dead-Zone Banner */}
      {isOffline && (
        <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-600/90 text-white backdrop-blur-md px-4 py-2 text-center text-xs font-bold tracking-wide shadow-lg flex items-center justify-center gap-2 border-b border-amber-400/40">
          <span>⚡ HIGHWAY DEAD ZONE (OFFLINE)</span>
          <span className="opacity-80 font-normal">
            — Passenger tickets & driver offline cache remain active
          </span>
        </div>
      )}

      {/* Floating Install App Chip */}
      {showInstallBanner && (
        <div className="fixed bottom-6 right-6 z-[9990] flex items-center gap-3 bg-slate-900/95 border border-cyan-500/40 text-white p-3 rounded-2xl shadow-2xl backdrop-blur-md animate-fadeIn">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-lg">
            🚌
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-cyan-300">
              Install BUSGO App
            </div>
            <div className="text-[11px] text-slate-400">
              Fast offline boarding & transit tracking
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={handleInstallClick}
              className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs transition shadow-md"
            >
              Install
            </button>
            <button
              onClick={() => setShowInstallBanner(false)}
              className="p-1 text-slate-500 hover:text-slate-300 text-xs transition"
              aria-label="Dismiss install banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}

