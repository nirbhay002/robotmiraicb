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
    <div className="w-full h-screen flex flex-col bg-gradient-to-b from-gray-900 to-black">
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

      {/* Interactive Robot Face - Full Screen */}
      {scanState === "READY" && (
        <>
          {/* Top Bar */}
          <div className="flex justify-between items-center px-8 py-4">
            {recognizedName && (
              <p className="text-cyan-300 text-lg">
                Logged in as: <span className="font-bold text-white">{recognizedName}</span>
              </p>
            )}
            <button
              onClick={handleEndChat}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-white transition-all shadow-lg ml-auto"
            >
              🚪 End Chat
            </button>
          </div>

          {/* Giant Robot Face */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <RobotFace isSpeaking={isSpeaking} isListening={listening} />
          </div>

          {/* Bottom Controls */}
          <div className="flex flex-col items-center gap-6 pb-8">
            {/* Live Transcript */}
            {transcript && (
              <div className="bg-gray-800 bg-opacity-80 px-8 py-4 rounded-2xl max-w-2xl">
                <p className="text-cyan-300 text-center text-xl italic">
                  "{transcript}"
                </p>
              </div>
            )}

            {/* Status & Button */}
            {!listening && !isSpeaking && (
              <button
                onClick={startListening}
                className="px-12 py-6 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-2xl font-bold text-white text-xl shadow-2xl transition-all transform hover:scale-105"
              >
                🎤 Start Speaking
              </button>
            )}

            {listening && (
              <div className="text-cyan-400 font-bold text-2xl animate-pulse flex items-center gap-3">
                <div className="w-4 h-4 bg-cyan-400 rounded-full animate-ping" />
                Listening...
              </div>
            )}

            {isSpeaking && (
              <div className="text-green-400 font-bold text-2xl flex items-center gap-3">
                <div className="w-4 h-4 bg-green-400 rounded-full animate-pulse" />
                Speaking...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ================= ANIMATED ROBOT FACE COMPONENT ================= */
function RobotFace({ isSpeaking, isListening }: { isSpeaking: boolean; isListening: boolean }) {
  const [blinkLeft, setBlinkLeft] = useState(false);
  const [blinkRight, setBlinkRight] = useState(false);
  const [mouthHeight, setMouthHeight] = useState(4);

  // Random eye blinking (natural)
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      const shouldBlink = Math.random() > 0.7;
      if (shouldBlink) {
        setBlinkLeft(true);
        setBlinkRight(true);
        setTimeout(() => {
          setBlinkLeft(false);
          setBlinkRight(false);
        }, 150);
      }
    }, 3000); // Every 3 seconds chance to blink

    return () => clearInterval(blinkInterval);
  }, []);

  // Occasional wink for personality
  useEffect(() => {
    if (isSpeaking) return; // Don't wink while speaking

    const winkInterval = setInterval(() => {
      if (Math.random() > 0.85) {
        const isLeftWink = Math.random() > 0.5;
        if (isLeftWink) {
          setBlinkLeft(true);
          setTimeout(() => setBlinkLeft(false), 250);
        } else {
          setBlinkRight(true);
          setTimeout(() => setBlinkRight(false), 250);
        }
      }
    }, 6000); // Every 6 seconds chance to wink

    return () => clearInterval(winkInterval);
  }, [isSpeaking]);

  // Animated mouth when speaking
  useEffect(() => {
    if (!isSpeaking) {
      setMouthHeight(4);
      return;
    }

    let frame = 0;
    const animateInterval = setInterval(() => {
      // Oscillate mouth size when speaking
      const heights = [4, 12, 20, 24, 20, 12, 8];
      setMouthHeight(heights[frame % heights.length]);
      frame++;
    }, 150);

    return () => clearInterval(animateInterval);
  }, [isSpeaking]);

  return (
    <div className="relative flex flex-col items-center justify-center scale-150">
      {/* Ambient glow when speaking */}
      {isSpeaking && (
        <div className="absolute inset-0 -z-10 scale-150">
          <div className="w-96 h-96 bg-cyan-400 rounded-full blur-[100px] opacity-30 animate-pulse" />
        </div>
      )}

      {/* Listening glow */}
      {isListening && (
        <div className="absolute inset-0 -z-10 scale-150">
          <div className="w-96 h-96 bg-blue-400 rounded-full blur-[100px] opacity-20 animate-ping" />
        </div>
      )}

      {/* Eyes Container */}
      <div className="flex gap-32 mb-20">
        {/* Left Eye */}
        <div className="relative group">
          <div
            className={`w-24 h-24 rounded-full bg-gradient-to-br from-cyan-300 to-cyan-500 shadow-2xl shadow-cyan-400/50 transition-all duration-150 ${
              blinkLeft ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
            } ${isSpeaking ? "animate-pulse" : ""} ${
              isListening ? "ring-4 ring-blue-400 ring-opacity-50" : ""
            }`}
          >
            {/* Eye shine effect */}
            {!blinkLeft && (
              <>
                <div className="absolute top-3 left-3 w-8 h-8 bg-white rounded-full opacity-80 blur-sm" />
                <div className="absolute top-2 left-2 w-4 h-4 bg-white rounded-full" />
              </>
            )}
          </div>
          
          {/* Eyelid top shadow when blinking */}
          {blinkLeft && (
            <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-transparent rounded-full opacity-40" />
          )}
        </div>

        {/* Right Eye */}
        <div className="relative group">
          <div
            className={`w-24 h-24 rounded-full bg-gradient-to-br from-cyan-300 to-cyan-500 shadow-2xl shadow-cyan-400/50 transition-all duration-150 ${
              blinkRight ? "scale-y-[0.05] translate-y-2" : "scale-y-100"
            } ${isSpeaking ? "animate-pulse" : ""} ${
              isListening ? "ring-4 ring-blue-400 ring-opacity-50" : ""
            }`}
          >
            {/* Eye shine effect */}
            {!blinkRight && (
              <>
                <div className="absolute top-3 left-3 w-8 h-8 bg-white rounded-full opacity-80 blur-sm" />
                <div className="absolute top-2 left-2 w-4 h-4 bg-white rounded-full" />
              </>
            )}
          </div>
          
          {/* Eyelid top shadow when blinking */}
          {blinkRight && (
            <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-transparent rounded-full opacity-40" />
          )}
        </div>
      </div>

      {/* Mouth */}
      <div className="relative flex items-center justify-center">
        {isSpeaking ? (
          // Speaking mouth - animated opening/closing
          <div className="relative">
            <div 
              className="bg-gradient-to-b from-white via-gray-100 to-gray-200 rounded-full shadow-2xl shadow-white/40 transition-all duration-150"
              style={{
                width: "160px",
                height: `${mouthHeight * 4}px`,
              }}
            >
              {/* Inner mouth darkness */}
              <div 
                className="absolute inset-2 bg-gray-900 rounded-full"
                style={{
                  opacity: mouthHeight > 10 ? 0.8 : 0.2,
                }}
              />
              
              {/* Teeth (when mouth opens wide) */}
              {mouthHeight > 15 && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 flex gap-2">
                  <div className="w-3 h-4 bg-white rounded-sm" />
                  <div className="w-3 h-4 bg-white rounded-sm" />
                  <div className="w-3 h-4 bg-white rounded-sm" />
                </div>
              )}
            </div>

            {/* Sound waves when speaking */}
            <div className="absolute -left-12 top-1/2 -translate-y-1/2">
              <div className="w-8 h-1 bg-cyan-400 rounded-full animate-pulse" />
            </div>
            <div className="absolute -left-16 top-1/2 -translate-y-1/2">
              <div className="w-6 h-1 bg-cyan-400 rounded-full animate-pulse delay-75" />
            </div>
            <div className="absolute -right-12 top-1/2 -translate-y-1/2">
              <div className="w-8 h-1 bg-cyan-400 rounded-full animate-pulse" />
            </div>
            <div className="absolute -right-16 top-1/2 -translate-y-1/2">
              <div className="w-6 h-1 bg-cyan-400 rounded-full animate-pulse delay-75" />
            </div>
          </div>
        ) : isListening ? (
          // Listening mouth - slightly open smile
          <div className="w-40 h-10 bg-gradient-to-b from-white to-gray-200 rounded-full shadow-xl shadow-white/30 relative">
            <div className="absolute inset-2 bg-gray-900 rounded-full opacity-20" />
          </div>
        ) : (
          // Idle mouth - subtle smile
          <div className="w-36 h-5 bg-white rounded-full shadow-lg shadow-white/20 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-200 to-transparent opacity-50 animate-pulse" />
          </div>
        )}
      </div>

      {/* Breathing effect when idle */}
      {!isSpeaking && !isListening && (
        <div className="absolute inset-0 -z-20">
          <div className="w-full h-full bg-cyan-500 rounded-full blur-3xl opacity-10 animate-pulse" 
               style={{ animationDuration: '4s' }} />
        </div>
      )}
    </div>
  );
}