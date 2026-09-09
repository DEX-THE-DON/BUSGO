/**
 * BUSGO Conductor Voice & Audio Synthesis Engine
 * Provides authentic Swahili and English in-cab PA announcements and boarding chimes
 * using the Web Audio API and Web Speech API.
 */

export type VoiceLang = 'sw' | 'en' | 'bilingual';

export interface ConductorVoiceSettings {
  enabled: boolean;
  chimeEnabled: boolean;
  language: VoiceLang;
  volume: number; // 0 to 1
  rate: number; // 0.8 to 1.2
}

const SETTINGS_KEY = 'busgo_conductor_voice_settings';

const DEFAULT_SETTINGS: ConductorVoiceSettings = {
  enabled: true,
  chimeEnabled: true,
  language: 'bilingual',
  volume: 0.9,
  rate: 0.92,
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function loadVoiceSettings(): ConductorVoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export function saveVoiceSettings(settings: ConductorVoiceSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

/**
 * Plays a pleasant two-tone electronic transit bell chime (Ding-Dong)
 * using the Web Audio API without requiring any external audio files.
 */
export function playBusChime(volume = 0.8): Promise<void> {
  return new Promise((resolve) => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return resolve();

      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.01, volume * 0.4), now + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      gainNode.connect(ctx.destination);

      // Tone 1: 880 Hz (A5)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.28);
      osc1.connect(gainNode);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Tone 2: 587.33 Hz (D5) - traditional transit bell interval
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, now + 0.28);
      osc2.connect(gainNode);
      osc2.start(now + 0.28);
      osc2.stop(now + 0.85);

      osc2.onended = () => resolve();
    } catch {
      resolve();
    }
  });
}

function findBestVoice(langPrefix: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Exact match first (e.g. sw-KE or sw)
  const exact = voices.find(
    (v) => v.lang.toLowerCase() === langPrefix.toLowerCase() || v.lang.toLowerCase().startsWith(langPrefix.toLowerCase())
  );
  if (exact) return exact;

  // Fallback for English
  if (langPrefix === 'en') {
    const enVoice = voices.find((v) => v.lang.toLowerCase().includes('en-ke') || v.lang.toLowerCase().includes('en-gb') || v.lang.toLowerCase().includes('en-us'));
    if (enVoice) return enVoice;
  }

  return voices[0] || null;
}

/**
 * Speaks a single phrase using the Web Speech API.
 */
export function speakPhrase(
  text: string,
  lang: 'sw' | 'en' = 'sw',
  overrideSettings?: Partial<ConductorVoiceSettings>
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return resolve();
    }

    const settings = { ...loadVoiceSettings(), ...overrideSettings };
    if (!settings.enabled) return resolve();

    // Cancel any previous queued announcement
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = settings.volume;
    utterance.rate = settings.rate;
    utterance.pitch = 1.05;

    const voice = findBestVoice(lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = lang === 'sw' ? 'sw-KE' : 'en-KE';
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Unified PA Announcement dispatcher that automatically plays the transit chime
 * and delivers Swahili, English, or bilingual dual announcements.
 */
export async function makeConductorAnnouncement(
  swahiliText: string,
  englishText: string,
  customSettings?: Partial<ConductorVoiceSettings>
): Promise<void> {
  const settings = { ...loadVoiceSettings(), ...customSettings };
  if (!settings.enabled) return;

  if (settings.chimeEnabled) {
    await playBusChime(settings.volume);
    // Slight pause after chime
    await new Promise((r) => setTimeout(r, 220));
  }

  const lang = settings.language;

  if (lang === 'sw') {
    await speakPhrase(swahiliText, 'sw', settings);
  } else if (lang === 'en') {
    await speakPhrase(englishText, 'en', settings);
  } else {
    // Bilingual mode: Swahili first, brief pause, then English
    await speakPhrase(swahiliText, 'sw', settings);
    await new Promise((r) => setTimeout(r, 350));
    await speakPhrase(englishText, 'en', settings);
  }
}

// ---------------------------------------------------------------------------
// High-Level Corridor Announcement Workflows
// ---------------------------------------------------------------------------

/**
 * Announce approaching next stop.
 */
export async function announceNextStop(stopName: string): Promise<void> {
  const sw = `Kituo kinachofuata ni ${stopName}. Abiria wa ${stopName} tafadhali jitayarisheni.`;
  const en = `Next stop is ${stopName}. Passengers alighting at ${stopName} please prepare.`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Announce stage arrival.
 */
export async function announceStageArrival(stopName: string): Promise<void> {
  const sw = `Tumefika kituo cha ${stopName}. Karibuni na mshuke kwa usalama.`;
  const en = `We have arrived at ${stopName} station. Please alight safely.`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Announce ticket validation upon driver QR scan.
 */
export async function announceTicketVerified(seatNumber: number, passengerName?: string): Promise<void> {
  const nameGreeting = passengerName ? `${passengerName}, ` : '';
  const sw = `Tiketi nambari ${seatNumber} imehakikishwa. ${nameGreeting}karibu BUSGO, safari njema!`;
  const en = `Seat number ${seatNumber} verified. Welcome aboard, have a safe trip!`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Announce departure from stage/terminal.
 */
export async function announceDeparture(routeName: string, destination: string): Promise<void> {
  const sw = `Gari linaondoka sasa kuelekea ${destination}. Fungeni mikanda ya usalama, safari njema!`;
  const en = `Departing now for ${destination}. Please fasten your seatbelts, have a safe journey!`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Announce traffic delay or highway hazard.
 */
export async function announceHazardOrDelay(reason: string, delayMins?: number): Promise<void> {
  const delayStr = delayMins ? `kwa takriban dakika ${delayMins}` : '';
  const delayEn = delayMins ? `by approximately ${delayMins} minutes` : '';
  const sw = `Tahadhari kwa abiria wote: Kuna ucheleweshaji wa safari ${delayStr} kutokana na ${reason}. Pole kwa usumbufu.`;
  const en = `Passenger advisory: Expect a travel delay ${delayEn} due to ${reason}. We apologize for any inconvenience.`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Alighting reminder for individual passenger.
 */
export async function announcePassengerAlightingWarning(stopName: string): Promise<void> {
  const sw = `Tahadhari: Kituo chako cha kushuka ${stopName} kiko karibu. Jiandae kushuka.`;
  const en = `Attention: Your alighting stop ${stopName} is coming up shortly. Please get ready.`;
  await makeConductorAnnouncement(sw, en);
}

/**
 * Announce Highway Blackspot, Escarpment or Mountain Fog warning.
 */
export async function announceBlackspotCaution(cautionSw: string, cautionEn: string): Promise<void> {
  await makeConductorAnnouncement(cautionSw, cautionEn);
}


