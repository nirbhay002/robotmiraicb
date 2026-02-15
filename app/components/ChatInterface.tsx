"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { captureVideoFrameBlob } from "../lib/cameraFrame";
import { RealtimeClient } from "../lib/realtimeClient";
import miraiLogo from "../../assets/mirai-logo.png";

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
const FAST_SCAN_MIN_MS = 300;
const FAST_SCAN_MAX_MS = 400;
const SLOW_SCAN_MIN_MS = 700;
const SLOW_SCAN_MAX_MS = 900;
const MID_SCAN_MIN_MS = 500;
const MID_SCAN_MAX_MS = 650;
const MATCH_WINDOW_SIZE = 4;
const REQUIRED_MATCHES = 2;
const MIN_FACE_AREA_RATIO = 0.12;
const CENTER_BOX_MIN = 0.3;
const CENTER_BOX_MAX = 0.7;
const BLUR_VARIANCE_THRESHOLD = 45;

type DetectableFace = {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type FaceDetectorLike = {
  detect(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<DetectableFace[]>;
};

type FaceDetectorCtor = new (options?: {
  fastMode?: boolean;
  maxDetectedFaces?: number;
}) => FaceDetectorLike;

function randomBetween(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function createScanSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function nextScanDelayMs(rttMs: number): number {
  if (rttMs < 250) {
    return randomBetween(FAST_SCAN_MIN_MS, FAST_SCAN_MAX_MS);
  }
  if (rttMs < 500) {
    return randomBetween(MID_SCAN_MIN_MS, MID_SCAN_MAX_MS);
  }
  return randomBetween(SLOW_SCAN_MIN_MS, SLOW_SCAN_MAX_MS);
}

function laplacianVariance(
  source: HTMLVideoElement,
  width: number,
  height: number
): number {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;

  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

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
  const [scanHint, setScanHint] = useState("Position your face in the center");

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backHomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const faceDetectorRef = useRef<FaceDetectorLike | null>(null);
  const localGateReadyRef = useRef(false);
  const localGateUnsupportedNotifiedRef = useRef(false);
  const recentMatchIdsRef = useRef<(string | null)[]>([]);
  const scanSessionIdRef = useRef<string>("");
  const adaptiveRequestedUsersRef = useRef<Set<string>>(new Set());
  const onEndChatRef = useRef(onEndChat);
  const onUserRecognizedRef = useRef(onUserRecognized);

  useEffect(() => {
    onEndChatRef.current = onEndChat;
    onUserRecognizedRef.current = onUserRecognized;
  }, [onEndChat, onUserRecognized]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ctor = (window as Window & { FaceDetector?: FaceDetectorCtor }).FaceDetector;
    if (!ctor) {
      return;
    }
    try {
      faceDetectorRef.current = new ctor({ fastMode: true, maxDetectedFaces: 3 });
      localGateReadyRef.current = true;
    } catch (err) {
      console.warn("Local FaceDetector initialization failed:", err);
      faceDetectorRef.current = null;
      localGateReadyRef.current = false;
    }
  }, []);

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

  const triggerPassiveAdaptation = async (userId: string) => {
    if (!videoRef.current) return;
    if (adaptiveRequestedUsersRef.current.has(userId)) return;
    adaptiveRequestedUsersRef.current.add(userId);

    try {
      const frameBlob = await captureVideoFrameBlob(videoRef.current, {
        maxWidth: 720,
        maxHeight: 720,
        type: "image/jpeg",
        quality: 0.72,
      });

      const payload = new FormData();
      payload.set(
        "file",
        new File([frameBlob], "identify-adapt.jpg", { type: "image/jpeg" })
      );
      payload.set("user_id", userId);
      payload.set("session_id", scanSessionIdRef.current);

      await fetch("/api/face/identify/adapt", {
        method: "POST",
        headers: { "x-session-id": scanSessionIdRef.current },
        body: payload,
      });
    } catch (adaptErr) {
      console.warn("Passive adaptation request failed:", adaptErr);
    }
  };

  const pushMatch = (userId: string | null) => {
    recentMatchIdsRef.current.push(userId);
    while (recentMatchIdsRef.current.length > MATCH_WINDOW_SIZE) {
      recentMatchIdsRef.current.shift();
    }
  };

  const hasTemporalConfirmation = (userId: string) => {
    const count = recentMatchIdsRef.current.filter((id) => id === userId).length;
    return count >= REQUIRED_MATCHES;
  };

  const runLocalForegroundGate = async (
    video: HTMLVideoElement
  ): Promise<{ ok: boolean; hint: string }> => {
    if (!localGateReadyRef.current || !faceDetectorRef.current) {
      if (!localGateUnsupportedNotifiedRef.current) {
        localGateUnsupportedNotifiedRef.current = true;
        setScanHint("Local gate unavailable in this browser, using server checks");
      }
      return { ok: true, hint: "Looking for registered faces..." };
    }

    const faces = await faceDetectorRef.current.detect(video);
    if (faces.length === 0) {
      return { ok: false, hint: "No face detected. Move into frame." };
    }
    if (faces.length > 1) {
      return { ok: false, hint: "Only one person should be visible." };
    }

    const box = faces[0].boundingBox;
    const frameArea = Math.max(video.videoWidth * video.videoHeight, 1);
    const faceAreaRatio = (box.width * box.height) / frameArea;
    if (faceAreaRatio < MIN_FACE_AREA_RATIO) {
      return { ok: false, hint: "Move closer to the camera." };
    }

    const cx = (box.x + box.width / 2) / Math.max(video.videoWidth, 1);
    const cy = (box.y + box.height / 2) / Math.max(video.videoHeight, 1);
    if (
      cx < CENTER_BOX_MIN ||
      cx > CENTER_BOX_MAX ||
      cy < CENTER_BOX_MIN ||
      cy > CENTER_BOX_MAX
    ) {
      return { ok: false, hint: "Center your face in the frame." };
    }

    const blurScore = laplacianVariance(video, 96, 96);
    if (blurScore < BLUR_VARIANCE_THRESHOLD) {
      return { ok: false, hint: "Hold still and improve lighting." };
    }

    return { ok: true, hint: "Face quality good. Verifying identity..." };
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
    recentMatchIdsRef.current = [];
    scanSessionIdRef.current = createScanSessionId();
    adaptiveRequestedUsersRef.current.clear();

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
          const gate = await runLocalForegroundGate(videoRef.current);
          setScanHint(gate.hint);
          if (!gate.ok) {
            scanTimerRef.current = setTimeout(loop, randomBetween(250, 450));
            return;
          }

          const requestStartedAt = Date.now();
          const frameBlob = await captureVideoFrameBlob(videoRef.current, {
            maxWidth: 720,
            maxHeight: 720,
            type: "image/jpeg",
            quality: 0.68,
          });

          const payload = new FormData();
          payload.set(
            "file",
            new File([frameBlob], "identify.jpg", { type: "image/jpeg" })
          );

          const response = await fetch("/api/face/identify", {
            method: "POST",
            headers: { "x-session-id": scanSessionIdRef.current },
            body: payload,
          });
          const data = await response.json().catch(() => ({}));
          const elapsedRttMs = Date.now() - requestStartedAt;

          if (response.ok && data?.status === "found") {
            const matchedName =
              typeof data?.name === "string" && data.name.trim()
                ? data.name.trim()
                : "Guest";
            const matchedUserId =
              typeof data?.user_id === "string" ? data.user_id : null;
            pushMatch(matchedUserId);

            if (matchedUserId && hasTemporalConfirmation(matchedUserId)) {
              void triggerPassiveAdaptation(matchedUserId);
              stopScanTimer();
              stopCamera();
              stopBackHomeTimer();
              setRecognizedName(matchedName);
              onUserRecognizedRef.current(matchedName);
              setPhase("FOUND_WAITING_GESTURE");
              return;
            }

            setScanHint("Face matched. Confirming identity...");
            scanTimerRef.current = setTimeout(loop, nextScanDelayMs(elapsedRttMs));
            return;
          }

          pushMatch(null);
          const reason =
            typeof data?.reason === "string" ? data.reason : "below_threshold";
          if (reason === "ambiguous") {
            setScanHint("Multiple similar faces detected. Stay alone in frame.");
          } else if (reason === "low_quality") {
            setScanHint("Face quality is low. Move closer and hold still.");
          } else if (reason === "no_face") {
            setScanHint("No face found. Move into frame.");
          } else {
            setScanHint("Looking for registered faces...");
          }
          scanTimerRef.current = setTimeout(loop, nextScanDelayMs(elapsedRttMs));
          return;
        } catch (scanErr) {
          console.error("Face scan request failed:", scanErr);
          setScanHint("Scan error. Retrying...");
        }

        scanTimerRef.current = setTimeout(loop, randomBetween(650, 900));
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
    <div className="relative w-full h-screen flex flex-col bg-gradient-to-b from-gray-900 to-black">
      <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-lg bg-black/35 p-2 md:right-5 md:top-5 md:p-2.5">
        <Image
          src={miraiLogo}
          alt="Mirai logo watermark"
          width={76}
          className="h-auto w-14 opacity-65 md:w-[76px]"
          priority
        />
      </div>
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
            {Math.round(scanProgress)}% - {scanHint}
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
          <div className="flex items-center px-8 py-4 pr-24 md:pr-28">
            <p className="text-cyan-300 text-lg">
              Logged in as:{" "}
              <span className="font-bold text-white">
                {recognizedName || "Guest"}
              </span>
            </p>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="mb-24 md:mb-28">
              <RobotFace isLive />
            </div>
            <p className="text-cyan-300 text-lg">Live voice chat is active</p>
          </div>

          <button
            onClick={handleEndChat}
            className="absolute right-4 bottom-4 z-30 px-6 py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-white transition-all shadow-lg sm:bottom-5 md:right-8 md:bottom-6"
          >
            End Chat
          </button>
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
          className={`w-24 h-20 rounded-[999px] bg-gradient-to-br from-cyan-200 to-cyan-400 shadow-2xl shadow-cyan-400/40 transition-all duration-150 ${
            blinkLeft ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
          }`}
        />
        <div
          className={`w-24 h-20 rounded-[999px] bg-gradient-to-br from-cyan-200 to-cyan-400 shadow-2xl shadow-cyan-400/40 transition-all duration-150 ${
            blinkRight ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
          }`}
        />
      </div>

      <div className="w-28 h-2 rounded-full bg-white opacity-90" />
    </div>
  );
}
