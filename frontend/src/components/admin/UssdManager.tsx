'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  simulateUssdRequest,
  fetchUssdSessions,
  fetchUssdLogs,
  UssdSessionRecord,
  UssdLogRecord,
} from '@/services/api';

export default function UssdManager() {
  const [phoneNumber, setPhoneNumber] = useState('254716314831');
  const [serviceCode, setServiceCode] = useState('*384#');
  const [sessionId, setSessionId] = useState(`sim_${Math.random().toString(36).substring(2, 9)}`);
  
  // Interactive session state
  const [isDialed, setIsDialed] = useState(false);
  const [screenText, setScreenText] = useState('DIAL *384# TO START');
  const [sessionStatus, setSessionStatus] = useState<'IDLE' | 'CON' | 'END'>('IDLE');
  const [inputBuffer, setInputBuffer] = useState('');
  const [historySteps, setHistorySteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  // Telemetry logs & sessions
  const [sessions, setSessions] = useState<UssdSessionRecord[]>([]);
  const [logs, setLogs] = useState<UssdLogRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'simulator' | 'logs' | 'sessions'>('simulator');
  const [refreshing, setRefreshing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadTelemetry = async () => {
    try {
      setRefreshing(true);
      const [sRes, lRes] = await Promise.all([
        fetchUssdSessions(30),
        fetchUssdLogs(50),
      ]);
      setSessions(sRes.sessions || []);
      setLogs(lRes.logs || []);
    } catch (e) {
      console.error('Failed to load USSD telemetry:', e);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTelemetry();
  }, []);

  const handleDial = async (customText?: string) => {
    try {
      setLoading(true);
      const newSession = `sim_${Date.now().toString(36)}`;
      setSessionId(newSession);
      setHistorySteps([]);
      setInputBuffer('');
      setIsDialed(true);

      const res = await simulateUssdRequest({
        sessionId: newSession,
        phoneNumber,
        text: customText ?? '',
        serviceCode,
      });

      setSessionStatus(res.status);
      setScreenText(res.message);
      setLastResponse(res.raw_response);
      loadTelemetry();
    } catch (err: any) {
      setScreenText(`Error dialing ${serviceCode}: ${err.message || 'Connection failed'}`);
      setSessionStatus('END');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSendInput = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isDialed || sessionStatus === 'END' || loading) return;

    const trimmed = inputBuffer.trim();
    if (!trimmed) return;

    const newSteps = [...historySteps, trimmed];
    setHistorySteps(newSteps);
    setInputBuffer('');

    try {
      setLoading(true);
      const fullText = newSteps.join('*');
      const res = await simulateUssdRequest({
        sessionId,
        phoneNumber,
        text: fullText,
        serviceCode,
      });

      setSessionStatus(res.status);
      setScreenText(res.message);
      setLastResponse(res.raw_response);
      loadTelemetry();
    } catch (err: any) {
      setScreenText(`Network timeout: ${err.message || 'Failed'}`);
      setSessionStatus('END');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleHangup = () => {
    setIsDialed(false);
    setSessionStatus('IDLE');
    setScreenText('DIAL *384# TO START');
    setInputBuffer('');
    setHistorySteps([]);
  };

  const handleKeypadPress = (val: string) => {
    if (!isDialed) {
      if (val === 'CALL') {
        handleDial();
      } else {
        setServiceCode((prev) => prev + val);
      }
      return;
    }

    if (val === 'END') {
      handleHangup();
      return;
    }

    if (val === 'CALL' || val === 'SEND') {
      handleSendInput();
      return;
    }

    if (sessionStatus === 'CON') {
      setInputBuffer((prev) => prev + val);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#13192b] to-slate-900 border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              GSM / 2G FEATURE PHONE ENGINE
            </span>
            <span className="text-xs text-slate-400">• Africa&apos;s Talking &amp; Safaricom USSD Gateway</span>
          </div>
          <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
            <span>USSD Interface (*384#)</span>
            <span className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">
              Non-Smartphone Passengers
            </span>
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Full end-to-end booking, ticket inspection, Mzigo parcel tracking, and Daraja STK Push triggers via feature phones (Nokia 3310, itel, etc.).
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'simulator'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📱 Phone Simulator
          </button>
          <button
            onClick={() => {
              setActiveTab('sessions');
              loadTelemetry();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'sessions'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📊 Active Sessions ({sessions.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('logs');
              loadTelemetry();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'logs'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📑 Inbound Hops ({logs.length})
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      {activeTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Virtual Feature Phone */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-[340px] rounded-[36px] bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 p-5 shadow-2xl border-4 border-slate-700/80 ring-1 ring-white/10">
              {/* Earpiece speaker & brand */}
              <div className="flex flex-col items-center mb-3">
                <div className="w-16 h-1.5 rounded-full bg-slate-700"></div>
                <div className="text-[10px] tracking-widest font-black text-slate-400 uppercase mt-1">BUSGO 3310</div>
              </div>

              {/* LCD Screen Frame */}
              <div className="rounded-2xl bg-[#091510] p-3 border-2 border-slate-700 shadow-inner">
                {/* LCD Carrier Bar */}
                <div className="flex justify-between items-center text-[10px] text-emerald-400 font-mono pb-1 border-b border-emerald-900/60 mb-2">
                  <span className="flex items-center gap-1">
                    <span>📶</span>
                    <span>Safaricom 2G</span>
                  </span>
                  <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>🔋 98%</span>
                </div>

                {/* LCD Screen Display Content */}
                <div className="h-56 overflow-y-auto bg-[#07130d] rounded-lg p-2.5 font-mono text-emerald-300 text-xs leading-relaxed whitespace-pre-wrap select-none border border-emerald-950">
                  {loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-emerald-400/80 animate-pulse">
                      <span className="text-lg">⏳</span>
                      <span className="mt-2 text-xs">Waiting for carrier network...</span>
                      <span className="text-[10px] text-emerald-600 mt-1">USSD *384# session active</span>
                    </div>
                  ) : (
                    <div>{screenText}</div>
                  )}
                </div>

                {/* Session Mode Indicator & Input prompt on LCD */}
                {sessionStatus === 'CON' && (
                  <form onSubmit={handleSendInput} className="mt-2 flex gap-1.5">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputBuffer}
                      onChange={(e) => setInputBuffer(e.target.value)}
                      placeholder="Enter choice..."
                      className="flex-1 bg-emerald-950/50 border border-emerald-800/80 rounded px-2 py-1 text-xs font-mono text-emerald-200 focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="submit"
                      disabled={loading || !inputBuffer.trim()}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs rounded transition disabled:opacity-50"
                    >
                      SEND
                    </button>
                  </form>
                )}

                {sessionStatus === 'END' && (
                  <div className="mt-2 text-center">
                    <button
                      onClick={handleHangup}
                      className="w-full py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs rounded border border-slate-700"
                    >
                      DISMISS / OK
                    </button>
                  </div>
                )}
              </div>

              {/* Navigation & Soft Keys */}
              <div className="mt-4 grid grid-cols-3 gap-2 px-1">
                <button
                  onClick={() => (sessionStatus === 'CON' ? handleSendInput() : handleDial())}
                  className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs shadow flex flex-col items-center justify-center transition"
                >
                  <span className="text-sm">📞</span>
                  <span className="text-[9px] mt-0.5">{isDialed ? 'SEND' : 'CALL'}</span>
                </button>
                <button
                  onClick={() => setInputBuffer((p) => p.slice(0, -1))}
                  className="py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 font-semibold text-xs shadow flex flex-col items-center justify-center transition"
                >
                  <span className="text-sm">⌫</span>
                  <span className="text-[9px] mt-0.5">CLEAR</span>
                </button>
                <button
                  onClick={handleHangup}
                  className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs shadow flex flex-col items-center justify-center transition"
                >
                  <span className="text-sm">🔴</span>
                  <span className="text-[9px] mt-0.5">END</span>
                </button>
              </div>

              {/* 3x4 Number Keypad */}
              <div className="mt-3 grid grid-cols-3 gap-2 px-1">
                {[
                  { n: '1', sub: '.,' },
                  { n: '2', sub: 'ABC' },
                  { n: '3', sub: 'DEF' },
                  { n: '4', sub: 'GHI' },
                  { n: '5', sub: 'JKL' },
                  { n: '6', sub: 'MNO' },
                  { n: '7', sub: 'PQRS' },
                  { n: '8', sub: 'TUV' },
                  { n: '9', sub: 'WXYZ' },
                  { n: '*', sub: ' ' },
                  { n: '0', sub: '+' },
                  { n: '#', sub: ' ' },
                ].map((k) => (
                  <button
                    key={k.n}
                    type="button"
                    onClick={() => handleKeypadPress(k.n)}
                    className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 shadow text-white flex flex-col items-center justify-center transition"
                  >
                    <span className="text-sm font-bold">{k.n}</span>
                    <span className="text-[8px] text-slate-400 font-mono tracking-widest">{k.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Simulator Controls & Quick Scenarios */}
          <div className="lg:col-span-7 space-y-5">
            {/* Caller Profile & Configuration Card */}
            <div className="p-5 rounded-2xl bg-[#121624] border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                <span>SIM Card &amp; Caller Profile</span>
                <span className="text-xs text-indigo-400 font-normal">Africa&apos;s Talking Compatible</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Passenger MSISDN (Phone)</label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="254716314831"
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">Service Code</label>
                  <input
                    type="text"
                    value={serviceCode}
                    onChange={(e) => setServiceCode(e.target.value)}
                    placeholder="*384#"
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  onClick={() => handleDial()}
                  disabled={loading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-1.5"
                >
                  <span>📞 Dial {serviceCode}</span>
                </button>
                <button
                  onClick={handleHangup}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition"
                >
                  Reset Session
                </button>
                <button
                  onClick={() => {
                    const testPhones = ['254716314831', '254722001122', '254733445566', '254799887766'];
                    const next = testPhones[(testPhones.indexOf(phoneNumber) + 1) % testPhones.length];
                    setPhoneNumber(next);
                  }}
                  className="px-3 py-2 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 text-xs rounded-lg transition"
                >
                  Switch Test Passenger
                </button>
              </div>
            </div>

            {/* Quick 1-Click USSD Dial Scenarios */}
            <div className="p-5 rounded-2xl bg-[#121624] border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                Quick Test Scenarios (1-Click Test)
              </h3>
              <p className="text-xs text-slate-400">
                Click any scenario below to immediately trigger the complete multi-hop sequence directly to the USSD state engine:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  onClick={() => handleDial('1*1*1*0*1*1')}
                  className="p-3 text-left rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 transition group"
                >
                  <div className="text-xs font-bold text-white group-hover:text-emerald-400">
                    🎟️ Full Booking + M-Pesa STK Push
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Route 1 → Trip 1 → Auto Seat → Confirm → Triggers Daraja STK Push to phone
                  </div>
                  <div className="text-[10px] font-mono text-emerald-400/80 mt-1.5">
                    Inputs: 1*1*1*0*1*1
                  </div>
                </button>

                <button
                  onClick={() => handleDial('2')}
                  className="p-3 text-left rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 transition group"
                >
                  <div className="text-xs font-bold text-white group-hover:text-cyan-400">
                    🎫 Check Passenger Ticket Status
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Searches active booking matching phone, shows seat #, bus plate &amp; boarding status
                  </div>
                  <div className="text-[10px] font-mono text-cyan-400/80 mt-1.5">
                    Inputs: 2
                  </div>
                </button>

                <button
                  onClick={() => handleDial('3*WB-MZG-4401X')}
                  className="p-3 text-left rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 transition group"
                >
                  <div className="text-xs font-bold text-white group-hover:text-amber-400">
                    📦 Track Mzigo Parcel Waybill
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Enters tracking code WB-MZG-4401X, returns live status &amp; claim PIN
                  </div>
                  <div className="text-[10px] font-mono text-amber-400/80 mt-1.5">
                    Inputs: 3*WB-MZG-4401X
                  </div>
                </button>

                <button
                  onClick={() => handleDial('4*1')}
                  className="p-3 text-left rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 transition group"
                >
                  <div className="text-xs font-bold text-white group-hover:text-purple-400">
                    📞 Sacco Support Contacts
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Pulls Super Metro customer care hotline, HQ &amp; emergency dispatch contacts
                  </div>
                  <div className="text-[10px] font-mono text-purple-400/80 mt-1.5">
                    Inputs: 4*1
                  </div>
                </button>

                <button
                  onClick={() => handleDial('5')}
                  className="p-3 text-left rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 transition group sm:col-span-2"
                >
                  <div className="text-xs font-bold text-white group-hover:text-emerald-400">
                    🇰🇪 Badili Lugha / Switch to Kiswahili
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Toggles interface between English and Kiswahili, persists preference for future USSD sessions
                  </div>
                  <div className="text-[10px] font-mono text-emerald-400/80 mt-1.5">
                    Inputs: 5
                  </div>
                </button>
              </div>
            </div>

            {/* Live Inspection / Gateway Specs */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-mono text-slate-400 space-y-1.5">
              <div className="text-slate-300 font-bold uppercase tracking-wider mb-1">
                Carrier Webhook Integration Specs
              </div>
              <div>• Webhook Endpoint: <span className="text-emerald-400">POST /api/ussd</span></div>
              <div>• Response Format: <span className="text-slate-200">text/plain (CON/END formatted)</span></div>
              <div>• Active Session ID: <span className="text-indigo-400">{sessionId}</span></div>
              <div>• Sequence Steps: <span className="text-amber-400">{historySteps.length > 0 ? historySteps.join(' → ') : '(Initial Dial)'}</span></div>
              {lastResponse && (
                <div className="pt-2 text-[11px] text-slate-300">
                  <span className="text-slate-500">Raw Telco Payload:</span>
                  <pre className="mt-1 p-2 rounded bg-black/40 border border-slate-800 text-emerald-400 text-[10px] whitespace-pre-wrap">
                    {lastResponse}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active Sessions Tab */}
      {activeTab === 'sessions' && (
        <div className="rounded-2xl bg-[#121624] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Live USSD Passenger Sessions</h3>
              <p className="text-xs text-slate-400">
                Track passengers currently navigating the feature phone menu tree.
              </p>
            </div>
            <button
              onClick={loadTelemetry}
              disabled={refreshing}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold rounded-lg border border-slate-700 transition"
            >
              {refreshing ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/60 uppercase font-mono text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Session ID</th>
                  <th className="py-2.5 px-3">Phone</th>
                  <th className="py-2.5 px-3">Language</th>
                  <th className="py-2.5 px-3">Current Menu</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No USSD sessions recorded yet. Dial *384# on the simulator!
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-indigo-400 font-semibold">{s.session_id}</td>
                      <td className="py-2.5 px-3 text-white">{s.phone_number}</td>
                      <td className="py-2.5 px-3 uppercase text-emerald-400">{s.language}</td>
                      <td className="py-2.5 px-3 text-slate-300">{s.current_menu}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            s.is_active
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {s.is_active ? 'ACTIVE' : 'COMPLETED'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                        {s.updated_at ? new Date(s.updated_at).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inbound Hops Tab */}
      {activeTab === 'logs' && (
        <div className="rounded-2xl bg-[#121624] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Inbound USSD Hops &amp; Audit Logs</h3>
              <p className="text-xs text-slate-400">
                Detailed hop-by-hop telemetry received from Africa&apos;s Talking / Safaricom gateway.
              </p>
            </div>
            <button
              onClick={loadTelemetry}
              disabled={refreshing}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold rounded-lg border border-slate-700 transition"
            >
              {refreshing ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/60 uppercase font-mono text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Phone</th>
                  <th className="py-2.5 px-3">Menu State</th>
                  <th className="py-2.5 px-3">User Input</th>
                  <th className="py-2.5 px-3">Response Payload Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No inbound USSD logs recorded yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                        {l.created_at ? new Date(l.created_at).toLocaleTimeString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-white">{l.phone_number}</td>
                      <td className="py-2.5 px-3 text-indigo-400 font-semibold">{l.menu_state}</td>
                      <td className="py-2.5 px-3 text-amber-400 font-bold">
                        {l.input_text !== '' ? l.input_text : '(Dial)'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 text-[11px] truncate max-w-xs">
                        {l.response_text}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

