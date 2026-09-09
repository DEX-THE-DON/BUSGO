'use client';

import React, { useState, useEffect } from 'react';
import {
  ConductorVoiceSettings,
  loadVoiceSettings,
  saveVoiceSettings,
  playBusChime,
  announceNextStop,
  announceDeparture,
  announceHazardOrDelay,
  announceBlackspotCaution,
  VoiceLang,
} from '@/lib/conductorVoice';

interface ConductorAudioPanelProps {
  currentStopName?: string;
  nextStopName?: string;
  destinationName?: string;
  routeName?: string;
  className?: string;
}

export default function ConductorAudioPanel({
  currentStopName = 'Nairobi Stage',
  nextStopName = 'Limuru',
  destinationName = 'Nakuru',
  routeName = 'Nairobi - Nakuru Express',
  className = '',
}: ConductorAudioPanelProps) {
  const [settings, setSettings] = useState<ConductorVoiceSettings>(loadVoiceSettings());
  const [isAnnouncing, setIsAnnouncing] = useState(false);
  const [activeMessage, setActiveMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadVoiceSettings());
  }, []);

  const updateSetting = <K extends keyof ConductorVoiceSettings>(
    key: K,
    val: ConductorVoiceSettings[K]
  ) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    saveVoiceSettings(updated);
  };

  const handleTestChime = async () => {
    await playBusChime(settings.volume);
    setActiveMessage('🔔 Ding-Dong chime played');
    setTimeout(() => setActiveMessage(null), 2500);
  };

  const handleAnnounceNextStop = async () => {
    if (isAnnouncing) return;
    setIsAnnouncing(true);
    setActiveMessage(`📢 Announcing next stop: ${nextStopName}`);
    try {
      await announceNextStop(nextStopName);
    } finally {
      setIsAnnouncing(false);
      setTimeout(() => setActiveMessage(null), 3000);
    }
  };

  const handleAnnounceDeparture = async () => {
    if (isAnnouncing) return;
    setIsAnnouncing(true);
    setActiveMessage(`🚌 Announcing departure for ${destinationName}`);
    try {
      await announceDeparture(routeName, destinationName);
    } finally {
      setIsAnnouncing(false);
      setTimeout(() => setActiveMessage(null), 3000);
    }
  };

  const handleAnnounceDelay = async () => {
    if (isAnnouncing) return;
    setIsAnnouncing(true);
    setActiveMessage('⚠️ Announcing traffic delay');
    try {
      await announceHazardOrDelay('msongamano mkubwa wa magari barabarani', 25);
    } finally {
      setIsAnnouncing(false);
      setTimeout(() => setActiveMessage(null), 3000);
    }
  };

  const handleAnnounceBlackspot = async () => {
    if (isAnnouncing) return;
    setIsAnnouncing(true);
    setActiveMessage('🚨 Announcing Mai Mahiu Escarpment Blackspot Caution');
    try {
      await announceBlackspotCaution(
        'Tahadhari: Unaingia eneo la Mai Mahiu Escarpment. Punguza mwendo na weka taa za ukungu.',
        'Caution: Entering Mai Mahiu Escarpment bends. Reduce speed and engage fog lights.'
      );
    } finally {
      setIsAnnouncing(false);
      setTimeout(() => setActiveMessage(null), 3500);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-cyan-500/20 bg-slate-900/80 backdrop-blur-xl p-4 shadow-xl space-y-3 ${className}`}
    >
      {/* Header with Switch */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-sm">
            🔊
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-2">
              Conductor In-Cab Voice PA
              {settings.enabled ? (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ACTIVE
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-slate-800 text-slate-400">
                  MUTED
                </span>
              )}
            </h3>
            <p className="text-[10px] text-slate-400">
              Kenyan Swahili &amp; English corridor stage announcements
            </p>
          </div>
        </div>

        {/* Master ON/OFF Switch */}
        <button
          type="button"
          onClick={() => updateSetting('enabled', !settings.enabled)}
          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
            settings.enabled
              ? 'bg-cyan-400 text-black shadow-md shadow-cyan-500/20'
              : 'bg-white/5 text-slate-400 hover:text-white'
          }`}
        >
          {settings.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* Language & Sound Options */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 mb-1">
            Language / Lugha
          </label>
          <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
            {(['sw', 'en', 'bilingual'] as VoiceLang[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => updateSetting('language', lang)}
                className={`py-1 text-[10px] font-bold rounded-lg transition ${
                  settings.language === lang
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lang === 'sw' ? 'Swahili' : lang === 'en' ? 'English' : 'Bilingual'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
            <span>PA Volume</span>
            <span>{Math.round(settings.volume * 100)}%</span>
          </div>
          <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-white/5">
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(e) => updateSetting('volume', parseFloat(e.target.value))}
              className="w-full accent-cyan-400 h-1.5 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Quick Announcement Trigger Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
        <button
          type="button"
          onClick={handleTestChime}
          className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[11px] font-semibold text-slate-200 transition flex items-center justify-center gap-1.5"
          title="Play dual-tone transit chime bell"
        >
          <span>🔔</span> Chime Bell
        </button>

        <button
          type="button"
          onClick={handleAnnounceNextStop}
          disabled={!settings.enabled || isAnnouncing}
          className="px-2.5 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 rounded-xl text-[11px] font-bold text-cyan-300 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          title={`Announce next stop: ${nextStopName}`}
        >
          <span>📢</span> Next Stop
        </button>

        <button
          type="button"
          onClick={handleAnnounceDeparture}
          disabled={!settings.enabled || isAnnouncing}
          className="px-2.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-xl text-[11px] font-bold text-emerald-300 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          title="Announce trip departure"
        >
          <span>🚌</span> Departure
        </button>

        <button
          type="button"
          onClick={handleAnnounceDelay}
          disabled={!settings.enabled || isAnnouncing}
          className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-xl text-[11px] font-bold text-amber-300 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          title="Announce highway traffic jam or delay"
        >
          <span>⚠️</span> Traffic Delay
        </button>

        <button
          type="button"
          onClick={handleAnnounceBlackspot}
          disabled={!settings.enabled || isAnnouncing}
          className="px-2.5 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-xl text-[11px] font-bold text-rose-300 transition flex items-center justify-center gap-1.5 disabled:opacity-50 col-span-2 sm:col-span-1"
          title="Announce Mai Mahiu / Salgaa Highway Blackspot caution"
        >
          <span>🚨</span> Blackspot
        </button>
      </div>

      {/* Live Voice Status Feedback */}
      {activeMessage && (
        <div className="p-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-[11px] flex items-center gap-2 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span>{activeMessage}</span>
        </div>
      )}
    </div>
  );
}

