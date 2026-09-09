'use client';

import React, { useState, useRef } from 'react';

// Self-contained zero-dependency SVG icon components
function IconPhone({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function IconPhoneCall({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function IconPhoneOff({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.129a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.28 3H5z" />
    </svg>
  );
}

function IconRotateCcw({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2a5 5 0 01-10 0V10z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l4-4m-4 4l4 4" />
    </svg>
  );
}

function IconVolume2({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" />
    </svg>
  );
}

function IconVolumeX({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zm12 9l-6-6m0 6l6-6" />
    </svg>
  );
}

function IconMessageSquare({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function IconCheckCircle2({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconAward({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="6" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  );
}

interface UssdPhoneSimulatorProps {
  initialPhoneNumber?: string;
  onBookingSuccess?: () => void;
}

export default function UssdPhoneSimulator({
  initialPhoneNumber = '+254712345678',
  onBookingSuccess,
}: UssdPhoneSimulatorProps) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber);
  const [dialInput, setDialInput] = useState('*384*254#');
  const [inCall, setInCall] = useState(false);
  const [ussdResponse, setUssdResponse] = useState<string | null>(null);
  const [ussdInput, setUssdInput] = useState('');
  const [historyTrail, setHistoryTrail] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [smsInbox, setSmsInbox] = useState<{ id: string; sender: string; text: string; time: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'phone' | 'messages'>('phone');
  const [unreadSms, setUnreadSms] = useState(0);

  const sessionIdRef = useRef(`sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize Web Audio Context for keypad click & DTMF tones
  const getAudioContext = () => {
    if (!audioCtxRef.current && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playTone = (freq1: number, freq2: number, duration = 0.09) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(freq1, now);
      osc2.frequency.setValueAtTime(freq2, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration);
      osc2.stop(now + duration);
    } catch {
      // Ignore audio failure
    }
  };

  // Play Nokia iconic SMS tone
  const playSmsTone = () => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [
        { f: 880, d: 0.1, delay: 0 },
        { f: 880, d: 0.1, delay: 0.12 },
        { f: 880, d: 0.1, delay: 0.24 },
        { f: 587, d: 0.2, delay: 0.40 },
        { f: 587, d: 0.2, delay: 0.65 },
      ];
      notes.forEach((n) => {
        setTimeout(() => {
          playTone(n.f, n.f * 1.5, n.d);
        }, n.delay * 1000);
      });
    } catch {
      // Ignore
    }
  };

  const DTMF_FREQS: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
  };

  const handleKeypadPress = (key: string) => {
    if (DTMF_FREQS[key]) {
      playTone(DTMF_FREQS[key][0], DTMF_FREQS[key][1]);
    }
    if (!inCall) {
      setDialInput((prev) => prev + key);
    } else {
      setUssdInput((prev) => prev + key);
    }
  };

  const handleBackspace = () => {
    playTone(400, 500, 0.05);
    if (!inCall) {
      setDialInput((prev) => prev.slice(0, -1));
    } else {
      setUssdInput((prev) => prev.slice(0, -1));
    }
  };

  const startUssdSession = async (codeToDial = dialInput) => {
    if (!codeToDial) return;
    setIsLoading(true);
    setInCall(true);
    setHistoryTrail([]);
    sessionIdRef.current = `sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    try {
      const res = await fetch('http://127.0.0.1:8000/api/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          serviceCode: '*384*254#',
          phoneNumber: phoneNumber,
          text: '',
        }),
      });
      const data = await res.text();
      setUssdResponse(data);
      setUssdInput('');
    } catch {
      setUssdResponse('END Unable to connect to BUSGO USSD Gateway.\nCheck network and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const sendUssdReply = async () => {
    if (!ussdInput.trim()) return;
    setIsLoading(true);
    const newTrail = [...historyTrail, ussdInput.trim()];
    setHistoryTrail(newTrail);
    const compositeText = newTrail.join('*');

    try {
      const res = await fetch('http://127.0.0.1:8000/api/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          serviceCode: '*384*254#',
          phoneNumber: phoneNumber,
          text: compositeText,
        }),
      });
      const data = await res.text();
      setUssdResponse(data);
      setUssdInput('');

      // Check if this resulted in a booking SMS dispatch
      if (data.includes('CONFIRMED') || data.includes('E-TICKET') || data.includes('Safari Njema')) {
        playSmsTone();
        const smsId = `sms-${Date.now()}`;
        const newMsg = {
          id: smsId,
          sender: 'BUSGO_ALERT',
          text: data.replace('END ', ''),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setSmsInbox((prev) => [newMsg, ...prev]);
        setUnreadSms((prev) => prev + 1);
        if (onBookingSuccess) onBookingSuccess();
      }
    } catch {
      setUssdResponse('END Connection timed out. Dial *384*254# to retry.');
    } finally {
      setIsLoading(false);
    }
  };

  const endCall = () => {
    playTone(350, 440, 0.15);
    setInCall(false);
    setUssdResponse(null);
    setUssdInput('');
    setHistoryTrail([]);
  };

  const isTerminalScreen = ussdResponse?.startsWith('END') || false;

  return (
    <div className="flex flex-col xl:flex-row items-center justify-center gap-8 p-4 max-w-5xl mx-auto">
      {/* Phone Hardware Container */}
      <div className="relative w-80 sm:w-88 bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950 rounded-[48px] p-6 shadow-2xl border-4 border-zinc-700/80 ring-1 ring-white/10">
        {/* Earpiece Grill */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-1.5 bg-zinc-950 rounded-full border border-zinc-700/50 shadow-inner flex items-center justify-center gap-1">
            <span className="w-1 h-1 bg-zinc-700 rounded-full" />
            <span className="w-1 h-1 bg-zinc-700 rounded-full" />
            <span className="w-1 h-1 bg-zinc-700 rounded-full" />
          </div>
        </div>

        {/* Brand Stamp */}
        <div className="text-center mb-2">
          <span className="font-mono text-xs tracking-widest text-zinc-400 font-bold uppercase">
            BUSGO • MULIKA MWIZI
          </span>
        </div>

        {/* LCD Screen Bezel */}
        <div className="relative bg-zinc-950 p-2.5 rounded-2xl border-2 border-zinc-700/80 shadow-[inset_0_2px_10px_rgba(0,0,0,0.8)] mb-5">
          {/* LCD Screen Glass */}
          <div className="bg-[#9bb34b] text-zinc-900 p-3 rounded-xl min-h-[220px] font-mono shadow-[inset_0_0_12px_rgba(0,0,0,0.25)] flex flex-col justify-between select-none overflow-hidden relative border border-[#839b38]">
            {/* Status Bar */}
            <div className="flex justify-between items-center text-[10px] font-bold pb-1 border-b border-zinc-800/30">
              <span className="flex items-center gap-1">📶 Safaricom 4G</span>
              <span className="cursor-pointer flex items-center gap-1 font-semibold" onClick={() => setActiveTab(activeTab === 'phone' ? 'messages' : 'phone')}>
                {unreadSms > 0 && <span className="animate-pulse text-red-950">✉️({unreadSms})</span>}
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>🔋 85%</span>
            </div>

            {/* Screen Body */}
            <div className="py-2 flex-1 flex flex-col justify-center">
              {activeTab === 'messages' ? (
                <div className="h-full flex flex-col justify-between text-xs">
                  <div className="font-bold border-b border-zinc-800/30 pb-1 flex justify-between items-center">
                    <span>SMS INBOX ({smsInbox.length})</span>
                    <button
                      onClick={() => { setActiveTab('phone'); setUnreadSms(0); }}
                      className="text-[10px] underline font-bold"
                    >
                      Back
                    </button>
                  </div>
                  {smsInbox.length === 0 ? (
                    <div className="text-center text-zinc-700 my-auto text-[11px] italic">
                      No text messages received yet.
                    </div>
                  ) : (
                    <div className="overflow-y-auto max-h-[140px] space-y-2 pr-1 text-[11px] leading-tight">
                      {smsInbox.map((msg) => (
                        <div key={msg.id} className="bg-[#8fa741] p-1.5 rounded border border-[#7a9032]">
                          <div className="flex justify-between font-bold text-[10px]">
                            <span>{msg.sender}</span>
                            <span>{msg.time}</span>
                          </div>
                          <div className="mt-0.5 whitespace-pre-wrap">{msg.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : !inCall ? (
                <div className="flex flex-col justify-center items-center h-full text-center">
                  <div className="text-[11px] text-zinc-700 font-semibold mb-1">ENTER CODE:</div>
                  <div className="text-lg font-black tracking-widest bg-[#8fa741]/50 px-3 py-1 rounded border border-[#7a9032] min-h-[32px] w-full break-all text-center">
                    {dialInput || <span className="opacity-40 animate-pulse">_</span>}
                  </div>
                  <div className="mt-3 text-[10px] text-zinc-700 leading-tight">
                    Dial <strong className="underline">*384*254#</strong> to access BUSGO offline express.
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col justify-between text-[11px] leading-snug">
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                      <div className="animate-spin text-lg mb-1">⏳</div>
                      <div className="font-bold">USSD Requesting...</div>
                      <div className="text-[10px] text-zinc-700">Connecting to Telco gateway</div>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-y-auto max-h-[135px] whitespace-pre-wrap font-bold pr-1">
                        {ussdResponse?.replace(/^(CON|END)\s*/, '')}
                      </div>

                      {!isTerminalScreen && (
                        <div className="mt-2 pt-1 border-t border-zinc-800/30 flex items-center gap-1">
                          <span className="font-black text-xs">&gt;</span>
                          <input
                            type="text"
                            value={ussdInput}
                            onChange={(e) => setUssdInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendUssdReply()}
                            placeholder="Type reply..."
                            className="w-full bg-[#8fa741] text-zinc-950 font-mono font-bold text-xs px-1.5 py-0.5 rounded border border-[#7a9032] outline-none placeholder:text-zinc-700"
                            autoFocus
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Screen Softkeys Footer */}
            <div className="flex justify-between items-center text-[10px] font-extrabold pt-1 border-t border-zinc-800/30">
              {inCall ? (
                <>
                  {!isTerminalScreen ? (
                    <button
                      onClick={sendUssdReply}
                      disabled={isLoading || !ussdInput}
                      className="uppercase hover:underline disabled:opacity-40 font-black"
                    >
                      [Send]
                    </button>
                  ) : (
                    <button onClick={endCall} className="uppercase hover:underline font-black">
                      [Exit]
                    </button>
                  )}
                  <button onClick={endCall} className="uppercase hover:underline font-black">
                    [Cancel]
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => startUssdSession()} className="uppercase hover:underline font-black">
                    [Dial]
                  </button>
                  <button onClick={handleBackspace} className="uppercase hover:underline font-black">
                    [Clear]
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls: Call / Navigation / End */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Green Call Button */}
          <button
            onClick={() => {
              playTone(440, 550, 0.1);
              if (!inCall) startUssdSession();
            }}
            className="flex items-center justify-center p-3 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white rounded-2xl shadow-lg border-b-4 border-emerald-900 active:translate-y-1 transition-all"
            title="Dial USSD"
          >
            <IconPhoneCall className="w-5 h-5 text-emerald-100" />
          </button>

          {/* Center Navigation / Clear */}
          <button
            onClick={handleBackspace}
            className="flex flex-col items-center justify-center p-2.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-zinc-300 rounded-2xl shadow-lg border-b-4 border-zinc-950 active:translate-y-1 transition-all"
            title="Backspace / Clear"
          >
            <span className="text-[10px] font-mono font-bold uppercase">Clear</span>
            <IconRotateCcw className="w-3.5 h-3.5 text-zinc-400 mt-0.5" />
          </button>

          {/* Red End Button */}
          <button
            onClick={endCall}
            className="flex items-center justify-center p-3 bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white rounded-2xl shadow-lg border-b-4 border-rose-950 active:translate-y-1 transition-all"
            title="End Session"
          >
            <IconPhoneOff className="w-5 h-5 text-rose-100" />
          </button>
        </div>

        {/* 12-Key Numeric Tactile Keypad */}
        <div className="grid grid-cols-3 gap-2.5 mb-2">
          {[
            { k: '1', l: '.,' },
            { k: '2', l: 'ABC' },
            { k: '3', l: 'DEF' },
            { k: '4', l: 'GHI' },
            { k: '5', l: 'JKL' },
            { k: '6', l: 'MNO' },
            { k: '7', l: 'PQRS' },
            { k: '8', l: 'TUV' },
            { k: '9', l: 'WXYZ' },
            { k: '*', l: '+' },
            { k: '0', l: '␣' },
            { k: '#', l: '⇧' },
          ].map((btn) => (
            <button
              key={btn.k}
              onClick={() => handleKeypadPress(btn.k)}
              className="group flex flex-col items-center justify-center py-2 px-1 bg-gradient-to-b from-zinc-700 to-zinc-800 hover:from-zinc-600 hover:to-zinc-700 active:from-zinc-900 active:to-zinc-900 text-zinc-100 rounded-xl shadow-md border-b-2 border-zinc-950 active:translate-y-0.5 transition-all"
            >
              <span className="text-base font-extrabold leading-none">{btn.k}</span>
              <span className="text-[8px] font-mono text-zinc-400 group-hover:text-zinc-200 mt-0.5 tracking-tighter">
                {btn.l}
              </span>
            </button>
          ))}
        </div>

        {/* Microphone Hole */}
        <div className="flex justify-center mt-3">
          <div className="w-1.5 h-1.5 bg-zinc-950 rounded-full border border-zinc-700/50 shadow-inner" />
        </div>
      </div>

      {/* Simulator Control & Information Sidebar */}
      <div className="flex-1 w-full max-w-md bg-zinc-900/90 border border-zinc-800 rounded-3xl p-6 shadow-xl space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <IconPhone className="w-5 h-5 text-emerald-400" />
              Kenyan USSD Gateway Simulator
            </h2>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              title={soundEnabled ? 'Mute Keypad Audio' : 'Enable Keypad Audio'}
            >
              {soundEnabled ? <IconVolume2 className="w-4 h-4 text-emerald-400" /> : <IconVolumeX className="w-4 h-4 text-zinc-500" />}
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Standard Africa’s Talking / Telco protocol. Enables millions of Kenyan commuters with non-smartphone feature phones (&quot;Mulika Mwizi&quot;) to reserve seats, redeem Safari Points, and receive instant SMS e-tickets.
          </p>
        </div>

        {/* SIM Phone Number Selector */}
        <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80 space-y-1.5">
          <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
            <span>Simulated Commuter SIM:</span>
            <span className="text-[10px] text-emerald-400 font-mono">Safaricom Active</span>
          </label>
          <input
            type="text"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-100 focus:border-emerald-500 focus:outline-none"
            placeholder="+254712345678"
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setPhoneNumber('+254712345678')}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
            >
              +254712345678
            </button>
            <button
              onClick={() => setPhoneNumber('+254799887766')}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
            >
              +254799887766
            </button>
          </div>
        </div>

        {/* Quick Dial Shortcuts */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-300">Quick USSD Commands:</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setDialInput('*384*254#');
                startUssdSession('*384*254#');
              }}
              className="p-2.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/40 text-left transition-all group"
            >
              <div className="text-xs font-mono font-bold text-emerald-300 group-hover:text-emerald-200">*384*254#</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Main Booking Portal</div>
            </button>

            <button
              onClick={() => {
                setDialInput('*384*254*3#');
                startUssdSession('*384*254*3#');
              }}
              className="p-2.5 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/40 text-left transition-all group"
            >
              <div className="text-xs font-mono font-bold text-amber-300 group-hover:text-amber-200 flex items-center gap-1">
                <IconAward className="w-3 h-3 text-amber-400" />
                Safari Points
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Check loyalty balance</div>
            </button>
          </div>
        </div>

        {/* Received SMS Tickets Inbox */}
        <div className="bg-zinc-950/60 p-3.5 rounded-2xl border border-zinc-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <IconMessageSquare className="w-3.5 h-3.5 text-cyan-400" />
              Incoming SMS E-Tickets ({smsInbox.length})
            </span>
            {smsInbox.length > 0 && (
              <button
                onClick={() => setSmsInbox([])}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              >
                Clear
              </button>
            )}
          </div>

          {smsInbox.length === 0 ? (
            <div className="text-center py-4 text-xs text-zinc-500 italic">
              Complete a booking on the phone dialer to receive real-time SMS ticket notifications with verification codes.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {smsInbox.map((msg) => (
                <div key={msg.id} className="p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs">
                  <div className="flex items-center justify-between text-cyan-400 font-mono text-[10px] mb-1">
                    <span className="font-bold flex items-center gap-1">
                      <IconCheckCircle2 className="w-3 h-3 text-emerald-400" />
                      From: {msg.sender}
                    </span>
                    <span>{msg.time}</span>
                  </div>
                  <div className="text-zinc-200 text-[11px] whitespace-pre-wrap font-sans leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

