'use client';

import React, { useState } from 'react';
import { reportIncident } from '@/services/api';
import { announceHazardOrDelay } from '@/lib/conductorVoice';

interface DriverIncidentReportModalProps {
  tripId: number;
  tripName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const CATEGORIES = [
  { id: 'traffic_jam', label: 'Traffic Jam / Gridlock', emoji: '🚗', sw: 'msongamano mkubwa wa magari', defaultMins: 25, sev: 'medium' },
  { id: 'police_inspection', label: 'NTSA / Police Checkpoint', emoji: '👮', sw: 'ukaguzi wa polisi barabarani', defaultMins: 15, sev: 'low' },
  { id: 'mechanical_breakdown', label: 'Mechanical Breakdown', emoji: '🔧', sw: 'hitilafu ya kimitambo', defaultMins: 45, sev: 'high' },
  { id: 'accident', label: 'Road Accident Ahead', emoji: '💥', sw: 'ajali ya barabarani', defaultMins: 35, sev: 'high' },
  { id: 'road_hazard', label: 'Road Obstacle / Hazard', emoji: '⚠️', sw: 'vizuizi barabarani', defaultMins: 20, sev: 'medium' },
  { id: 'sos', label: 'Emergency SOS Alert', emoji: '🚨', sw: 'hali ya dharura', defaultMins: 60, sev: 'critical_sos' },
];

export default function DriverIncidentReportModal({
  tripId,
  tripName,
  isOpen,
  onClose,
  onSuccess,
}: DriverIncidentReportModalProps) {
  const [selectedCat, setSelectedCat] = useState(CATEGORIES[0]);
  const [delayMins, setDelayMins] = useState(25);
  const [locationName, setLocationName] = useState('Limuru Escarpment');
  const [description, setDescription] = useState('');
  const [announcePa, setAnnouncePa] = useState(true);
  const [broadcastSms, setBroadcastSms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationName.trim()) {
      setError('Please specify current highway stage or landmark.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await reportIncident({
        trip_id: tripId,
        category: selectedCat.id,
        severity: selectedCat.sev,
        estimated_delay_mins: delayMins,
        location_name: locationName.trim(),
        description: description.trim() || `${selectedCat.label} near ${locationName.trim()}`,
        broadcast_delay: broadcastSms,
      });

      if (res.ok) {
        setSuccessMsg(res.message);

        // Voice announcement via in-cab conductor audio
        if (announcePa) {
          announceHazardOrDelay(selectedCat.sw, delayMins).catch(() => {});
        }

        setTimeout(() => {
          if (onSuccess) onSuccess();
          onClose();
        }, 1200);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit incident alert');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in fade-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚨</span>
            <div>
              <h3 className="text-base font-black text-white">Driver Hazard & Highway SOS</h3>
              <p className="text-xs text-slate-400">Trip: {tripName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm font-mono px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl text-rose-300 text-xs font-bold">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs font-bold">
            ✓ {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category Selector Cards */}
          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">
              Select Hazard / Situation:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCat.id === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCat(cat);
                      setDelayMins(cat.defaultMins);
                    }}
                    className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      isSelected
                        ? cat.id === 'sos'
                          ? 'border-rose-500 bg-rose-500/20 ring-2 ring-rose-500/50'
                          : 'border-cyan-400 bg-cyan-500/15 ring-2 ring-cyan-400/50'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xl mb-1">{cat.emoji}</span>
                    <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {cat.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Estimated Delay & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                Estimated Delay (Mins):
              </label>
              <div className="flex items-center gap-2">
                {[10, 20, 35, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDelayMins(m)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold border transition ${
                      delayMins === m
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-black'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    +{m}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                Current Location / Landmark:
              </label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Limuru Escarpment Flyover"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                required
              />
            </div>
          </div>

          {/* Description / Dispatcher Notes */}
          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Driver Situation Notes (Optional):
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Overturned lorry blocking right lane; traffic slowly moving"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Automations Toggles */}
          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2.5">
            <label className="flex items-center justify-between text-xs cursor-pointer">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <span>📢</span>
                Bilingual In-Cab PA Announcement (Swahili & English)
              </span>
              <input
                type="checkbox"
                checked={announcePa}
                onChange={(e) => setAnnouncePa(e.target.checked)}
                className="accent-cyan-400 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-xs cursor-pointer border-t border-slate-800/80 pt-2">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <span>📲</span>
                SMS Advisory Broadcast to all Booked Passengers
              </span>
              <input
                type="checkbox"
                checked={broadcastSms}
                onChange={(e) => setBroadcastSms(e.target.checked)}
                className="accent-emerald-400 w-4 h-4 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition shadow-lg ${
                selectedCat.id === 'sos'
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/40 animate-pulse'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950'
              }`}
            >
              {isSubmitting ? 'Transmitting Alert...' : 'Broadcast Alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

