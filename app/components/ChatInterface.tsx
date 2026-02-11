"use client";
import { useEffect, useRef, useState } from "react";
import {
  loadFaceModels,
  getClosestFace,
  identifyFace,
} from "../lib/faceLogic";

interface ChatInterfaceProps {
  userName: string | null;
  isOldUser: boolean;
  onEndChat: () => void;
  onUserRecognized: (name: string) => void;
}

type ScanState = "SCANNING" | "RECOGNIZED" | "NOT_RECOGNIZED" | "READY";

export default function ChatInterface({
  userName,
  isOldUser,
  onEndChat,
  onUserRecognized,
}: ChatInterfaceProps) {
  const [scanState, setScanState] = useState<ScanState>(isOldUser ? "SCANNING" : "READY");
  const [recognizedName, setRecognizedName] = useState<string | null>(userName);
  const [listening, setListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
  const [scanProgress, setScanProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef(false);
  const isThinkingRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Load voices
  useEffect(() => {
    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      if (v.length) voicesRef.current = v;
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Initial face scan for old users (10 seconds)
  useEffect(() => {
    if (!isOldUser) return;

    let mounted = true;
    let scanStartTime: number;

    (async () => {
      try {
        await loadFaceModels();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            scanStartTime = Date.now();
            startScanning();
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        setScanState("NOT_RECOGNIZED");
      }
    })();

    const startScanning = async () => {
      const SCAN_DURATION = 10000; // 10 seconds
      let bestMatch: { name: string; confidence: number } | null = null;

      const scanLoop = async () => {
        if (!mounted || !videoRef.current) return;

        const elapsed = Date.now() - scanStartTime;
        setScanProgress(Math.min((elapsed / SCAN_DURATION) * 100, 100));

        if (elapsed >= SCAN_DURATION) {
          // Stop camera
          const stream = videoRef.current?.srcObject as MediaStream;
          stream?.getTracks().forEach((track) => track.stop());

          if (bestMatch && bestMatch.confidence > 0.5) {
            setRecognizedName(bestMatch.name);
            onUserRecognized(bestMatch.name);
            setScanState("RECOGNIZED");
            setTimeout(() => {
              speak(`नमस्ते ${bestMatch.name}! मैं आपको पहचान गया हूँ।`);
              setScanState("READY");
            }, 1000);
          } else {
            setScanState("NOT_RECOGNIZED");
          }
          return;
        }

        // Try to recognize
        const result = await getClosestFace(videoRef.current);
        if (result && result.face) {
          const identified = await identifyFace(result.face.descriptor);
          if (identified && identified.confidence > (bestMatch?.confidence || 0)) {
            bestMatch = identified;
          }
        }

        setTimeout(scanLoop, 300); // Scan every 300ms
      };

      scanLoop();
    };

    return () => {
      mounted = false;
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [isOldUser]);

  // Speech Recognition Setup
  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-IN";

    rec.onresult = (e: any) => {
      if (isSpeakingRef.current) return;

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }

      setTranscript(text);

      silenceTimerRef.current = setTimeout(() => {
        processMessage(text);
      }, 1200);
    };

    rec.onend = () => {
      setListening(false);
    };

    rec.onerror = (e: any) => {
      console.error("Speech recognition error:", e.error);
      setListening(false);
    };

    recognitionRef.current = rec;
  }, []);

  // Text to Speech
  const speak = (text: string) => {
    if (!speechSynthesis) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    const isHindi = /[\u0900-\u097F]/.test(text);
    const voice = voicesRef.current.find((v) =>
      isHindi ? v.lang.includes("hi") : v.lang.includes("en")
    );
    if (voice) utter.voice = voice;

    utter.onstart = () => {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
    };

    utter.onend = () => {
      setTimeout(() => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        startListening();
      }, 500);
    };

    speechSynthesis.speak(utter);
  };

  // Start Listening
  const startListening = () => {
    if (scanState !== "READY") return;
    if (recognitionRef.current && !isSpeakingRef.current && !listening) {
      setListening(true);
      setTranscript("");
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  // Process Message
  const processMessage = async (text: string) => {
    if (!text.trim() || isThinkingRef.current || isSpeakingRef.current) return;

    isThinkingRef.current = true;
    setTranscript("");

    // Add user message
    setMessages((prev) => [...prev, { role: "user", text }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          userName: recognizedName || "Guest",
          messages: messages,
        }),
      });

      const data = await res.json();

      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
        speak(data.reply);
      }
    } catch (err) {
      console.error("Chat error:", err);
      const errorMsg = "मुझे अभी तकनीकी समस्या हो रही है।";
      setMessages((prev) => [...prev, { role: "assistant", text: errorMsg }]);
      speak(errorMsg);
    } finally {
      isThinkingRef.current = false;
    }
  };

  // Handle End Chat
  const handleEndChat = () => {
    // Stop all ongoing processes
    speechSynthesis.cancel();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    // Stop camera if still running
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach((track) => track.stop());

    onEndChat();
  };

  return (
    <div className="w-full max-w-4xl h-screen flex flex-col p-6">
      {/* Scanning Phase */}
      {scanState === "SCANNING" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold text-cyan-400 mb-6">
            🔍 Scanning Face...
          </h2>
          <video
            ref={videoRef}
            autoPlay
            muted
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

      {/* Recognition Result */}
      {scanState === "RECOGNIZED" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-3xl font-bold text-green-400 mb-2">
            Welcome back, {recognizedName}!
          </h2>
          <p className="text-cyan-300">Starting conversation...</p>
        </div>
      )}

      {scanState === "NOT_RECOGNIZED" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-3xl font-bold text-red-400 mb-4">
            Face Not Recognized
          </h2>
          <p className="text-cyan-300 mb-6">
            Please register as a new user first.
          </p>
          <button
            onClick={handleEndChat}
            className="px-8 py-4 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold text-white"
          >
            Back to Home
          </button>
        </div>
      )}

      {/* Chat Interface */}
      {scanState === "READY" && (
        <>
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-cyan-400">
                Chat with Romaji
              </h2>
              {recognizedName && (
                <p className="text-cyan-300 text-sm">
                  Logged in as: <span className="font-bold">{recognizedName}</span>
                </p>
              )}
            </div>
            <button
              onClick={handleEndChat}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-white transition-all"
            >
              🚪 End Chat
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-gray-900 rounded-xl p-4 mb-4 space-y-3">
            {messages.length === 0 ? (
              <div className="text-center text-cyan-500 py-12">
                <p className="text-lg">👋 Say "Hi" to start chatting!</p>
                <p className="text-sm mt-2">Click the button below to speak</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg ${
                    msg.role === "user"
                      ? "bg-cyan-600 ml-auto max-w-md"
                      : "bg-gray-700 mr-auto max-w-md"
                  }`}
                >
                  <p className="text-white">{msg.text}</p>
                </div>
              ))
            )}
          </div>

          {/* Input Area */}
          <div className="flex flex-col items-center gap-4">
            {/* Robot Face */}
            <div className="w-24 h-24 rounded-full border-4 border-cyan-400 flex flex-col items-center justify-center">
              <div className="flex gap-4 mb-2">
                <div
                  className={`w-3 h-3 rounded-full bg-cyan-400 ${
                    isSpeaking ? "animate-pulse" : ""
                  }`}
                />
                <div
                  className={`w-3 h-3 rounded-full bg-cyan-400 ${
                    isSpeaking ? "animate-pulse" : ""
                  }`}
                />
              </div>
              <div
                className={`bg-white rounded-full ${
                  isSpeaking ? "h-4" : "h-1"
                } w-10 transition-all`}
              />
            </div>

            {/* Transcript */}
            {transcript && (
              <p className="text-cyan-300 italic text-sm">"{transcript}"</p>
            )}

            {/* Listen Button */}
            {!listening && !isSpeaking && (
              <button
                onClick={startListening}
                className="px-10 py-4 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold text-white shadow-lg transition-all"
              >
                🎤 Start Speaking
              </button>
            )}

            {listening && (
              <div className="text-cyan-400 font-bold animate-pulse">
                🎤 Listening...
              </div>
            )}

            {isSpeaking && (
              <div className="text-green-400 font-bold">🗣️ Speaking...</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}