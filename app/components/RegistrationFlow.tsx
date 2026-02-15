"use client";
import { useEffect, useRef, useState } from "react";
import { captureVideoFrameBlob } from "../lib/cameraFrame";

type RegistrationState =
  | "LOADING"
  | "READY"
  | "CAPTURING"
  | "CAPTURED"
  | "SAVING";

interface RegistrationFlowProps {
  onComplete: (name: string) => void;
}

export default function RegistrationFlow({ onComplete }: RegistrationFlowProps) {
  const [state, setState] = useState<RegistrationState>("LOADING");
  const [name, setName] = useState("");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  };

  // Start camera
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (videoRef.current && mounted) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setState("READY");
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        setError("Camera access denied.");
      }
    })();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setState("CAPTURING");
    setError(null);
    setNotice(null);

    try {
      const blob = await captureVideoFrameBlob(videoRef.current);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      setCapturedBlob(blob);
      setState("CAPTURED");
    } catch (err) {
      console.error("Capture error:", err);
      setError("Failed to capture face. Please try again.");
      setState("READY");
    }
  };

  const handleSave = async () => {
    if (!capturedBlob || !name.trim()) {
      setError("Please enter your name");
      return;
    }

    setState("SAVING");
    setError(null);
    setNotice(null);

    try {
      const payload = new FormData();
      payload.set("name", name.trim());
      payload.set(
        "file",
        new File([capturedBlob], "register.jpg", { type: "image/jpeg" })
      );

      const response = await fetch("/api/face/register", {
        method: "POST",
        body: payload,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          data?.detail || data?.error || "Failed to save. Please try again.";
        setError(String(detail));
        setState("CAPTURED");
        return;
      }

      const canonicalName =
        typeof data?.name === "string" && data.name.trim()
          ? data.name.trim()
          : name.trim();
      const registrationMode =
        typeof data?.registration_mode === "string"
          ? data.registration_mode
          : "new";

      if (registrationMode === "existing") {
        setNotice(`Face already registered as ${canonicalName}.`);
        setState("CAPTURED");
        setTimeout(() => {
          stopCamera();
          onComplete(canonicalName);
        }, 1200);
        return;
      }

      stopCamera();
      onComplete(canonicalName);
    } catch (err) {
      console.error("Save error:", err);
      setError("Failed to save. Please try again.");
      setState("CAPTURED");
    }
  };

  const handleRetake = () => {
    setCapturedBlob(null);
    setName("");
    setNotice(null);
    setState("READY");
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl p-6">
      <h2 className="text-3xl font-bold text-cyan-400">New User Registration</h2>

      {/* Video/Canvas Display */}
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          className={`rounded-xl border-4 border-cyan-400 ${
            state === "CAPTURED" ? "hidden" : "block"
          }`}
          style={{ width: "640px", height: "480px", objectFit: "cover" }}
        />
        <canvas
          ref={canvasRef}
          className={`rounded-xl border-4 border-green-400 ${
            state === "CAPTURED" ? "block" : "hidden"
          }`}
          style={{ width: "640px", height: "480px", objectFit: "cover" }}
        />
      </div>

      {/* Status Messages */}
      {state === "LOADING" && (
        <div className="text-cyan-300 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2" />
          <p>Loading camera...</p>
        </div>
      )}

      {state === "READY" && (
        <div className="text-cyan-300 text-center">
          <p className="text-lg mb-2">📸 Position your face in the camera</p>
          <p className="text-sm text-cyan-500">Make sure you&apos;re in good lighting</p>
        </div>
      )}

      {state === "CAPTURING" && (
        <div className="text-yellow-300 text-center">
          <div className="animate-pulse">📸 Capturing your face...</div>
        </div>
      )}

      {state === "CAPTURED" && (
        <div className="text-green-300 text-center">
          <p className="text-lg mb-4">✅ Face captured successfully!</p>
          <div className="bg-gray-900 p-4 rounded-xl w-full max-w-md">
            <label className="text-cyan-400 text-sm mb-2 block">Enter Your Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  handleSave();
                }
              }}
              placeholder="Type your name and press Enter"
              className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border-2 border-cyan-500 focus:border-cyan-300 outline-none text-lg"
              autoFocus
            />
            <p className="text-xs text-cyan-500 mt-2">Press Enter to save</p>
          </div>
        </div>
      )}

      {state === "SAVING" && (
        <div className="text-cyan-300 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2" />
          <p>Saving your profile...</p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-900 bg-opacity-50 border-2 border-red-500 rounded-lg p-4 text-red-200">
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div className="bg-blue-900 bg-opacity-50 border-2 border-blue-500 rounded-lg p-4 text-blue-100">
          ℹ️ {notice}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4">
        {state === "READY" && (
          <button
            onClick={handleCapture}
            className="px-8 py-4 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold text-white shadow-lg transition-all"
          >
            📸 Capture Face
          </button>
        )}

        {state === "CAPTURED" && (
          <>
            <button
              onClick={handleRetake}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-xl font-bold text-white transition-all"
            >
              🔄 Retake
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className={`px-8 py-3 rounded-xl font-bold text-white shadow-lg transition-all ${
                name.trim()
                  ? "bg-green-500 hover:bg-green-600"
                  : "bg-gray-500 cursor-not-allowed"
              }`}
            >
              💾 Save & Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
