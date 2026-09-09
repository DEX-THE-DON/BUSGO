'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';

export interface DriverCameraScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
  isOpen: boolean;
  activeTripName?: string;
}

export default function DriverCameraScanner({
  onScan,
  onClose,
  isOpen,
  activeTripName,
}: DriverCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameId = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  // Play audio chime upon successful scan using Web Audio API
  const playSuccessChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Arpeggio chime: 880Hz -> 1320Hz
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // AudioContext blocked by policy or unsupported
    }
  }, []);

  // Stop camera media stream
  const stopCamera = useCallback(() => {
    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Start camera stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMsg('');
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setHasCamera(false);
        setErrorMsg('Camera access is not supported in this browser. Please enter the ticket code manually.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setHasCamera(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS Safari
        await videoRef.current.play();
      }

      // Check if torch/flashlight is supported
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as { torch?: boolean } | undefined;
      setHasTorch(Boolean(capabilities?.torch));

      setIsScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied.';
      setHasCamera(false);
      setErrorMsg(`Unable to access camera: ${msg}. You can still verify tickets using the manual code input.`);
    }
  }, [facingMode, stopCamera]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      const newTorch = !torchOn;
      // applyConstraints with advanced torch option
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: newTorch }],
      });
      setTorchOn(newTorch);
    } catch {
      // Torch failed
    }
  };

  // Flip camera between front and back
  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Main optical scanning loop
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // Scan frame processing loop
  useEffect(() => {
    if (!isOpen || !isScanning) return;

    let scanTimer: NodeJS.Timeout | null = null;

    const scanFrame = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animFrameId.current = requestAnimationFrame(scanFrame);
        return;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        animFrameId.current = requestAnimationFrame(scanFrame);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let foundCode: string | null = null;

      // 1. Try native BarcodeDetector API if available
      const BarcodeDetectorClass = (window as unknown as {
        BarcodeDetector?: new (options?: { formats: string[] }) => {
          detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
        };
      }).BarcodeDetector;

      if (BarcodeDetectorClass) {
        try {
          const detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
          const barcodes = await detector.detect(canvas);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            foundCode = barcodes[0].rawValue.trim();
          }
        } catch {
          // BarcodeDetector fallback
        }
      }

      // 2. Universal cross-browser fallback: jsQR
      if (!foundCode) {
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (qrCode && qrCode.data) {
            foundCode = qrCode.data.trim();
          }
        } catch {
          // Frame read failed
        }
      }

      // If valid ticket code detected
      if (foundCode && foundCode !== lastScannedCode) {
        setLastScannedCode(foundCode);
        playSuccessChime();

        // Trigger mobile haptic pulse
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([100, 50, 100]);
        }

        // Brief freeze to show success HUD
        setIsScanning(false);
        onScan(foundCode);

        // Resume scanning after 1.8 seconds for consecutive passenger boarding
        scanTimer = setTimeout(() => {
          setIsScanning(true);
          setLastScannedCode(null);
        }, 1800);
        return;
      }

      animFrameId.current = requestAnimationFrame(scanFrame);
    };

    animFrameId.current = requestAnimationFrame(scanFrame);

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      if (scanTimer) clearTimeout(scanTimer);
    };
  }, [isOpen, isScanning, lastScannedCode, onScan, playSuccessChime]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-md bg-[#090d18] border border-cyan-500/40 rounded-3xl shadow-2xl shadow-cyan-500/10 overflow-hidden z-10 my-6">
        {/* Top Header */}
        <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              📷
            </div>
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                Optical Ticket Scanner
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </h3>
              <p className="text-[10px] text-slate-400 truncate max-w-[200px]">
                {activeTripName || 'Scan Passenger E-Tickets'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasTorch && (
              <button
                onClick={toggleTorch}
                className={`p-2 rounded-xl text-xs font-bold transition ${
                  torchOn ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Toggle Flashlight"
              >
                🔦
              </button>
            )}
            <button
              onClick={toggleCamera}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition"
              title="Flip Camera"
            >
              🔄
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/30 hover:text-rose-300 text-slate-400 text-xs font-bold transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewfinder Video Area */}
        <div className="relative aspect-square bg-black overflow-hidden flex items-center justify-center">
          {/* Hidden processing canvas */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Video Stream */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* Synthwave Targeting Viewfinder Overlay */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8">
            {/* Viewfinder Box */}
            <div className="relative w-64 h-64 border-2 border-cyan-400/40 rounded-3xl overflow-hidden shadow-[0_0_20px_rgba(6,182,212,0.25)]">
              {/* Corner Brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-cyan-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-cyan-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-cyan-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-cyan-400 rounded-br-xl" />

              {/* Animated Laser Scanning Line */}
              {isScanning && (
                <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee] animate-pulse transition-all duration-75 [animation:scan_line_sweep_2s_ease-in-out_infinite]" />
              )}

              {/* Scan Success Freeze Overlay */}
              {!isScanning && (
                <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4 animate-in zoom-in-95 duration-150">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-2xl text-emerald-300 mb-2 shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                    ✓
                  </div>
                  <p className="text-xs font-black text-white uppercase tracking-wider">
                    Ticket Detected
                  </p>
                  <p className="text-[11px] font-mono text-emerald-300 truncate max-w-[200px] mt-0.5">
                    {lastScannedCode}
                  </p>
                </div>
              )}
            </div>

            {/* Viewfinder Instructions */}
            <p className="text-[11px] font-bold text-cyan-300/80 bg-slate-950/70 backdrop-blur px-3 py-1.5 rounded-full border border-cyan-500/30 mt-4 text-center">
              Align passenger QR ticket within targeting reticle
            </p>
          </div>

          {/* Camera Error / No Camera Fallback */}
          {errorMsg && (
            <div className="absolute inset-0 bg-slate-950/95 p-6 flex flex-col items-center justify-center text-center space-y-3 z-20">
              <span className="text-3xl">⚠️</span>
              <p className="text-xs font-bold text-slate-300 max-w-xs">{errorMsg}</p>
              <button
                onClick={startCamera}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
              >
                Retry Camera Access
              </button>
            </div>
          )}
        </div>

        {/* Modal Bottom Controls */}
        <div className="p-4 bg-[#0a0f1d] border-t border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-[11px]">Auto-Detecting 2D Code</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // Demo scan simulation helper for desk testing without physical QR
                const sampleCode = `BUSGO:48:1:7`;
                onScan(sampleCode);
                playSuccessChime();
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[11px] transition border border-slate-700"
            >
              Test Scan Code
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
