'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { playBusChime } from '@/lib/conductorVoice';
import { fetchTrips, TripOption } from '@/services/api';

export default function NganyaOnboardPage() {
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number>(1);
  const [currentSpeed, setCurrentSpeed] = useState<number>(76);
  const [nextStop, setNextStop] = useState<string>('Limuru Escarpment');
  const [kmRemaining, setKmRemaining] = useState<number>(38);
  const [etaMins, setEtaMins] = useState<number>(28);
  const [bellRang, setBellRang] = useState(false);
  const [activeTrack, setActiveTrack] = useState<string>('Nairobi Hot 96 Matatu Megamix (DJ Demakufu Vol. 14)');
  const [isPlayingMix, setIsPlayingMix] = useState(false);

  // Audio Context for DJ Soundboard
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    fetchTrips()
      .then((res) => {
        setTrips(res.trips);
        if (res.trips.length > 0) setSelectedTripId(res.trips[0].id);
      })
      .catch(() => {});
  }, []);

  // Simulate subtle highway cruising speed variations
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSpeed((prev) => {
        const delta = (Math.random() - 0.48) * 3;
        const next = Math.round(Math.min(84, Math.max(68, prev + delta)));
        return next;
      });
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Sound FX synthesizers
  const playAirhorn = () => {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      [0, 0.18, 0.36].forEach((delay, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(idx === 1 ? 520 : 440, now + delay);
        gain.gain.setValueAtTime(0.3, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.16);
      });
    } catch {}
  };

  const playLaserSiren = () => {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1400, now + i * 0.12);
        osc.frequency.exponentialRampToValueAtTime(300, now + i * 0.12 + 0.1);
        gain.gain.setValueAtTime(0.25, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.1);
      }
    } catch {}
  };

  const playTurboWhistle = () => {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(2400, now + 0.3);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.6);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch {}
  };

  const playBassDrop = () => {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.8);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    } catch {}
  };

  const handleStopRequest = () => {
    playBusChime();
    setBellRang(true);
    setTimeout(() => setBellRang(false), 5000);
  };

  const currentTrip = trips.find((t) => t.id === selectedTripId);

  return (
    <main className="min-h-screen bg-[#05060b] text-slate-100 p-4 sm:p-8 relative overflow-hidden">
      {/* Neon Glow Accents */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-fuchsia-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-32 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="max-w-5xl mx-auto mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎵</span>
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-cyan-400 to-amber-300">
                Nganya Onboard Wi-Fi &bull; Entertainment Portal
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live In-Bus Passenger Screen &bull; NTSA Speed HUD &bull; Kenyan DJ Soundboard &bull; Alighting Chime
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              &larr; Booking Home
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Speedometer & Live Telematics HUD */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-cyan-500/40 shadow-2xl shadow-cyan-950/40 relative overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Speed Gauge */}
            <div className="text-center md:border-r border-slate-800 md:pr-6">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                Cruising Velocity
              </span>
              <div className="flex items-baseline justify-center gap-1">
                <span
                  className={`font-mono font-black text-6xl leading-none transition-colors ${
                    currentSpeed > 80 ? 'text-rose-400 animate-pulse' : 'text-cyan-300'
                  }`}
                >
                  {currentSpeed}
                </span>
                <span className="text-sm font-bold text-slate-400">KM/H</span>
              </div>
              <div className="mt-3">
                {currentSpeed > 80 ? (
                  <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-black uppercase tracking-wider">
                    ⚠️ NTSA 80 km/h Speed Limit Exceeded
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wider">
                    ✓ Within NTSA Speed Governor Limits
                  </span>
                )}
              </div>
            </div>

            {/* Corridor Position & Next Stop */}
            <div className="text-center md:text-left space-y-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                  Active Vehicle
                </span>
                <h3 className="text-base font-black text-white">
                  {currentTrip?.plate_number || 'KDD 482X'} &bull; {currentTrip?.name || 'Corridor Express'}
                </h3>
              </div>

              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                  Next Alighting Stage
                </span>
                <h4 className="text-lg font-black text-white flex items-center justify-center md:justify-start gap-2">
                  <span>📍</span> {nextStop}
                </h4>
              </div>

              <div className="flex items-center justify-center md:justify-start gap-4 text-xs text-slate-300 pt-1">
                <span>~{kmRemaining} km remaining</span>
                <span>&bull;</span>
                <span className="font-mono text-cyan-300 font-bold">ETA ~{etaMins} mins</span>
              </div>
            </div>

            {/* Digital Passenger Bell */}
            <div className="text-center md:pl-6 flex flex-col items-center justify-center">
              <button
                type="button"
                onClick={handleStopRequest}
                className="w-full max-w-xs py-4 px-6 rounded-3xl bg-gradient-to-r from-rose-600 via-red-500 to-amber-500 hover:from-rose-500 hover:to-amber-400 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-rose-950/60 active:scale-95 transition flex items-center justify-center gap-2"
              >
                <span className="text-xl">🔔</span>
                <span>Stop Hapo Dere!</span>
              </button>
              <span className="text-[10px] text-slate-400 mt-2 block">
                Tap to ring conductor cab chime for your stage
              </span>

              {bellRang && (
                <div className="mt-3 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold animate-bounce">
                  🔔 Kengere imegongwa! Alighting requested.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Kenyan Matatu DJ Soundboard */}
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-fuchsia-500/40 shadow-2xl shadow-fuchsia-950/40">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-fuchsia-300 flex items-center gap-2">
                <span>🎛️ Manyanga DJ Soundboard</span>
              </h3>
              <p className="text-xs text-slate-400">
                Interactive audio synthesizer for authentic Kenyan Matatu sound effects
              </p>
            </div>
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-bold">
              Web Audio Synthesizer
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <button
              type="button"
              onClick={playAirhorn}
              className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/50 hover:bg-amber-900/50 text-amber-300 font-black text-xs uppercase tracking-wider transition active:scale-95 flex flex-col items-center gap-1.5 shadow-md shadow-amber-950/30"
            >
              <span className="text-2xl">📢</span>
              <span>Airhorn (Poo-Poo!)</span>
            </button>

            <button
              type="button"
              onClick={playLaserSiren}
              className="p-4 rounded-2xl bg-fuchsia-950/40 border border-fuchsia-500/50 hover:bg-fuchsia-900/50 text-fuchsia-300 font-black text-xs uppercase tracking-wider transition active:scale-95 flex flex-col items-center gap-1.5 shadow-md shadow-fuchsia-950/30"
            >
              <span className="text-2xl">🚨</span>
              <span>Laser Siren</span>
            </button>

            <button
              type="button"
              onClick={playTurboWhistle}
              className="p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/50 hover:bg-cyan-900/50 text-cyan-300 font-black text-xs uppercase tracking-wider transition active:scale-95 flex flex-col items-center gap-1.5 shadow-md shadow-cyan-950/30"
            >
              <span className="text-2xl">💨</span>
              <span>Turbo Valve</span>
            </button>

            <button
              type="button"
              onClick={() => playBusChime()}
              className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 hover:bg-emerald-900/50 text-emerald-300 font-black text-xs uppercase tracking-wider transition active:scale-95 flex flex-col items-center gap-1.5 shadow-md shadow-emerald-950/30"
            >
              <span className="text-2xl">🔔</span>
              <span>Bus Bell Chime</span>
            </button>

            <button
              type="button"
              onClick={playBassDrop}
              className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/50 hover:bg-purple-900/50 text-purple-300 font-black text-xs uppercase tracking-wider transition active:scale-95 flex flex-col items-center gap-1.5 shadow-md shadow-purple-950/30"
            >
              <span className="text-2xl">💥</span>
              <span>Subwoofer Drop</span>
            </button>
          </div>
        </div>

        {/* Curated Kenyan Mixtape Player */}
        <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                <span>📻 Matatu FM &bull; Stream Kenyan Mixtapes</span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Now Playing: <strong className="text-cyan-300">{activeTrack}</strong>
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsPlayingMix(!isPlayingMix)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 ${
                isPlayingMix
                  ? 'bg-fuchsia-500 text-slate-950 shadow-lg shadow-fuchsia-500/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-white'
              }`}
            >
              <span>{isPlayingMix ? '⏸️ Pause Stream' : '▶️ Play Stream'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              'Nairobi Hot 96 Matatu Megamix (DJ Demakufu Vol. 14)',
              'Great North Road Reggae Vibes (DJ Kalonje Mix)',
              'Thika Road Gengetone Banger Explosion 2026',
            ].map((mix) => (
              <button
                key={mix}
                type="button"
                onClick={() => {
                  setActiveTrack(mix);
                  setIsPlayingMix(true);
                }}
                className={`p-3 rounded-2xl border text-left transition ${
                  activeTrack === mix
                    ? 'bg-fuchsia-950/30 border-fuchsia-500/60 text-white shadow-md'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="text-[10px] font-bold text-fuchsia-400 uppercase block">Curated Mix</span>
                <span className="text-xs font-bold line-clamp-2 mt-0.5">{mix}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
