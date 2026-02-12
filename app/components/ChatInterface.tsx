"use client";
import { useEffect, useRef, useState } from "react";
import { captureVideoFrameBlob } from "../lib/cameraFrame";
import { RealtimeClient } from "../lib/realtimeClient";

interface ChatInterfaceProps {
  userName: string | null;
  isOldUser: boolean;
  onEndChat: () => void;
  onUserRecognized: (name: string) => void;
}

type ChatPhase =
  | "SCANNING"
  | "FOUND_WAITING_GESTURE"
  | "CONNECTING_REALTIME"
  | "READY"
  | "NOT_RECOGNIZED"
  | "ERROR";

const SCAN_DURATION_MS = 10_000;
const SCAN_INTERVAL_MS = 400;

export default function ChatInterface({
  userName,
  isOldUser,
  onEndChat,
  onUserRecognized,
}: ChatInterfaceProps) {
  const [phase, setPhase] = useState<ChatPhase>(
    isOldUser ? "SCANNING" : "FOUND_WAITING_GESTURE"
  );
  const [recognizedName, setRecognizedName] = useState<string | null>(userName);
  const [scanProgress, setScanProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backHomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const onEndChatRef = useRef(onEndChat);
  const onUserRecognizedRef = useRef(onUserRecognized);

  useEffect(() => {
    onEndChatRef.current = onEndChat;
    onUserRecognizedRef.current = onUserRecognized;
  }, [onEndChat, onUserRecognized]);

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const stopScanTimer = () => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  };

  const stopBackHomeTimer = () => {
    if (backHomeTimerRef.current) {
      clearTimeout(backHomeTimerRef.current);
      backHomeTimerRef.current = null;
    }
  };

  const handleEndChat = () => {
    stopScanTimer();
    stopBackHomeTimer();
    stopCamera();
    realtimeRef.current?.disconnect();
    realtimeRef.current = null;
    onEndChatRef.current();
  };

  const handleJoinChat = async () => {
    if (!audioRef.current) {
      setError("Audio output device is unavailable.");
      setPhase("ERROR");
      return;
    }

    setError(null);
    setPhase("CONNECTING_REALTIME");

    try {
      const realtime = new RealtimeClient(audioRef.current);
      realtimeRef.current = realtime;
      await realtime.connect(recognizedName, { warmGreeting: true });
      setPhase("READY");
    } catch (err) {
      console.error("Realtime connection error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to connect voice chat.";
      setError(message);
      realtimeRef.current?.disconnect();
      realtimeRef.current = null;
      setPhase("ERROR");
    }
  };

  useEffect(() => {
    if (!isOldUser) {
      return () => {
        stopScanTimer();
        stopBackHomeTimer();
        stopCamera();
      };
    }

    let cancelled = false;
    let scanStartedAt = 0;

    const startScanning = () => {
      const loop = async () => {
        if (cancelled || !videoRef.current) return;

        const elapsed = Date.now() - scanStartedAt;
        setScanProgress(Math.min((elapsed / SCAN_DURATION_MS) * 100, 100));

        if (elapsed >= SCAN_DURATION_MS) {
          stopScanTimer();
          stopCamera();
          setPhase("NOT_RECOGNIZED");
          stopBackHomeTimer();
          backHomeTimerRef.current = setTimeout(() => {
            onEndChatRef.current();
          }, 2500);
          return;
        }

        try {
          const frameBlob = await captureVideoFrameBlob(videoRef.current, {
            maxWidth: 1024,
            maxHeight: 1280,
            type: "image/jpeg",
            quality: 0.8,
          });

          const payload = new FormData();
          payload.set(
            "file",
            new File([frameBlob], "identify.jpg", { type: "image/jpeg" })
          );

          const response = await fetch("/api/face/identify", {
            method: "POST",
            body: payload,
          });
          const data = await response.json().catch(() => ({}));

          if (response.ok && data?.status === "found") {
            stopScanTimer();
            stopCamera();
            stopBackHomeTimer();

            const matchedName =
              typeof data?.name === "string" && data.name.trim()
                ? data.name.trim()
                : "Guest";
            setRecognizedName(matchedName);
            onUserRecognizedRef.current(matchedName);
            setPhase("FOUND_WAITING_GESTURE");
            return;
          }
        } catch (scanErr) {
          console.error("Face scan request failed:", scanErr);
        }

        scanTimerRef.current = setTimeout(loop, SCAN_INTERVAL_MS);
      };

      void loop();
    };

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            scanStartedAt = Date.now();
            startScanning();
          };
        }
      } catch (cameraError) {
        console.error("Camera error:", cameraError);
        setError("Camera access failed. Please allow camera permission.");
        setPhase("ERROR");
      }
    };

    void init();

    return () => {
      cancelled = true;
      stopScanTimer();
      stopBackHomeTimer();
      stopCamera();
    };
  }, [isOldUser]);

  useEffect(() => {
    return () => {
      realtimeRef.current?.disconnect();
      realtimeRef.current = null;
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col bg-gradient-to-b from-gray-900 to-black">
      {phase === "SCANNING" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold text-cyan-400 mb-6">
            Scanning Face...
          </h2>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="rounded-xl border-4 border-cyan-400 mb-4"
            style={{ width: "480px", height: "360px", objectFit: "cover" }}
          />
          <div className="w-96 bg-gray-700 rounded-full h-4 mb-2">
            <div
              className="bg-cyan-400 h-4 rounded-full transition-all"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <p className="text-cyan-300 text-sm">
            {Math.round(scanProgress)}% - Looking for registered faces...
          </p>
        </div>
      )}

      {phase === "FOUND_WAITING_GESTURE" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-3xl font-bold text-green-400 mb-2">
            Welcome back, {recognizedName || "Guest"}!
          </h2>
          <p className="text-cyan-300 mb-6">
            Tap below to start voice conversation.
          </p>
          <button
            onClick={handleJoinChat}
            className="px-10 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl font-bold text-white text-lg shadow-lg transition-all"
          >
            Join Chat
          </button>
        </div>
      )}

      {phase === "CONNECTING_REALTIME" && (
        <div className="flex-1 flex flex-col items-center justify-center text-cyan-300">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400 mb-4" />
          <p>Connecting voice session...</p>
        </div>
      )}

      {phase === "NOT_RECOGNIZED" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-3xl font-bold text-red-400 mb-4">
            Face Not Recognized
          </h2>
          <p className="text-cyan-300 mb-6">
            Returning to home screen...
          </p>
          <button
            onClick={handleEndChat}
            className="px-8 py-4 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold text-white"
          >
            Back to Home
          </button>
        </div>
      )}

      {phase === "ERROR" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-3xl font-bold text-red-400 mb-3">Error</h2>
          <p className="text-red-200 mb-6 max-w-xl text-center px-6">
            {error || "Unexpected issue occurred."}
          </p>
          <div className="flex gap-4">
            {recognizedName && (
              <button
                onClick={handleJoinChat}
                className="px-8 py-4 bg-green-500 hover:bg-green-600 rounded-xl font-bold text-white"
              >
                Retry Join Chat
              </button>
            )}
            <button
              onClick={handleEndChat}
              className="px-8 py-4 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold text-white"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}

      {phase === "READY" && (
        <>
          <div className="flex justify-between items-center px-8 py-4">
            <p className="text-cyan-300 text-lg">
              Logged in as:{" "}
              <span className="font-bold text-white">
                {recognizedName || "Guest"}
              </span>
            </p>
            <button
              onClick={handleEndChat}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-white transition-all shadow-lg"
            >
              End Chat
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="mb-24 md:mb-28">
              <RobotFace isLive />
            </div>
            <p className="text-cyan-300 text-lg">Live voice chat is active</p>
          </div>
        </>
      )}

      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}

function RobotFace({ isLive }: { isLive: boolean }) {
  const [blinkLeft, setBlinkLeft] = useState(false);
  const [blinkRight, setBlinkRight] = useState(false);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      const shouldBlink = Math.random() > 0.7;
      if (shouldBlink) {
        setBlinkLeft(true);
        setBlinkRight(true);
        setTimeout(() => {
          setBlinkLeft(false);
          setBlinkRight(false);
        }, 140);
      }
    }, 2800);

    return () => clearInterval(blinkInterval);
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-center origin-top scale-125 md:scale-150">
      {isLive && (
        <div className="absolute inset-0 -z-10 scale-150">
          <div className="w-96 h-96 bg-cyan-400 rounded-full blur-[100px] opacity-25 animate-pulse" />
        </div>
      )}

      <div className="flex gap-32 mb-20">
        <div
          className={`w-24 h-24 rounded-full bg-gradient-to-br from-cyan-300 to-cyan-500 shadow-2xl shadow-cyan-400/50 transition-all duration-150 ${
            blinkLeft ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
          }`}
        />
        <div
          className={`w-24 h-24 rounded-full bg-gradient-to-br from-cyan-300 to-cyan-500 shadow-2xl shadow-cyan-400/50 transition-all duration-150 ${
            blinkRight ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
          }`}
        />
      </div>

      <div className="w-28 h-2 rounded-full bg-white opacity-90" />
    </div>
  );
}
