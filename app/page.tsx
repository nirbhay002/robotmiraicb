"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [liveSourceTranscript, setLiveSourceTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef(""); 
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync ref with state for the auto-trigger logic
  useEffect(() => {
    transcriptRef.current = liveSourceTranscript;
  }, [liveSourceTranscript]);

  /**
   * 🔊 Speak Function
   * Swaps voices based on script detection (Hindi vs English)
   */
  function speakNow(text: string) {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    // 🔑 Script Detection
    const isHindi = /[\u0900-\u097F]/.test(text);
    
    // Buffer word to prevent audio clipping on start
    const buffer = isHindi ? "जी , " : "Okay , ";
    const utterance = new SpeechSynthesisUtterance(buffer + text);
    
    utterance.lang = isHindi ? "hi-IN" : "en-US";
    const voices = window.speechSynthesis.getVoices();
    
    // Voice matching
    const voice = voices.find(v => 
      isHindi ? (v.lang.includes("hi") || v.name.includes("Hindi")) 
              : (v.lang.includes("en") || v.name.includes("English"))
    );
    
    if (voice) utterance.voice = voice;
    utterance.rate = isHindi ? 0.9 : 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setStatus("Romaji is speaking...");
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setStatus("Idle");
      // 🔑 AUTO-RESTART: Automatically start listening after speaking finishes
      startListening();
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setStatus("Idle");
      startListening();
    };

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 500);
  }

  /**
   * Automatic processing after silence detection
   */
  async function processConversation() {
    const finalTranscript = transcriptRef.current.trim();
    if (!finalTranscript) {
      setStatus("Idle");
      return;
    }
    
    setListening(false);
    recognitionRef.current?.stop();
    setStatus("Thinking...");

    // Browser context unlock
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: finalTranscript }),
      });
      const data = await res.json();
      if (data.reply) {
        speakNow(data.reply);
      } else {
        setStatus("Idle");
        startListening();
      }
    } catch (error) {
      console.error("❌ API Error:", error);
      setStatus("Idle");
      startListening();
    }
  }

  /**
   * Start Recognition Logic
   */
  const startListening = () => {
    if (recognitionRef.current && !listening && !isSpeaking) {
      window.speechSynthesis.cancel();
      setLiveSourceTranscript("");
      setListening(true);
      setStatus("Listening...");
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn("Recognition already active");
      }
    }
  };

  /**
   * Initialize Recognition with Hinglish (en-IN) and Silence Detection
   */
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recog = new SpeechRecognition();
    recog.continuous = true;
    recog.interimResults = true;
    
    // 🔑 Hinglish Logic: Generate Latin script transcripts
    recog.lang = "en-IN"; 

    recog.onresult = (event: any) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        interim += event.results[i][0].transcript;
      }
      setLiveSourceTranscript(interim);

      // 🔑 SILENCE TRIGGER: Process automatically after 1.5 seconds of silence
      silenceTimerRef.current = setTimeout(() => {
        processConversation();
      }, 1500);
    };

    recog.onerror = (err: any) => {
      console.error("Speech Recognition Error:", err.error);
      if (err.error === "no-speech") setStatus("Idle");
    };

    recognitionRef.current = recog;

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  // Pre-load voices
  useEffect(() => {
    const loadVoices = () => window.speechSynthesis.getVoices();
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#080808] overflow-hidden">
      
      {/* 🌫️ Grainy Aesthetic Overlay */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>

      {/* 🤖 Romaji Face */}
      <div className={`relative w-80 h-80 rounded-full bg-slate-900 border-4 transition-all duration-500 flex flex-col items-center justify-center ${
        listening ? "border-cyan-400 shadow-[0_0_50px_rgba(34,211,238,0.3)]" : "border-slate-800"
      }`}>
        
        {/* 👁️ Glowing Blinking Eyes */}
        <div className="flex gap-14 mb-10">
          <div className={`w-10 h-10 rounded-full bg-cyan-400 transition-all duration-300 ${
            isSpeaking ? "shadow-[0_0_30px_rgba(34,211,238,1)] scale-110" : "shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          } ${status === "Idle" ? "animate-[blink_4s_infinite]" : ""}`}>
             <div className="absolute top-2 left-2 w-2 h-2 bg-white rounded-full opacity-50"></div>
          </div>
          
          <div className={`w-10 h-10 rounded-full bg-cyan-400 transition-all duration-300 ${
            isSpeaking ? "shadow-[0_0_30px_rgba(34,211,238,1)] scale-110" : "shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          } ${status === "Idle" ? "animate-[blink_4s_infinite]" : ""}`}>
             <div className="absolute top-2 left-2 w-2 h-2 bg-white rounded-full opacity-50"></div>
          </div>
        </div>

        {/* 👄 Gol Muh (Round Mouth) */}
        <div 
          className={`w-24 bg-white rounded-full transition-all duration-200 ${
            isSpeaking ? "h-10" : "h-2"
          } ${listening ? "animate-pulse" : ""}`}
        ></div>
      </div>

      <div className="mt-12 flex flex-col items-center gap-6 z-10">
        <div className="min-h-[2.5rem] flex items-center justify-center">
          {liveSourceTranscript && (
            <p className="max-w-xs text-cyan-300 text-center text-sm font-medium italic opacity-80 animate-in fade-in duration-300">
              "{liveSourceTranscript}"
            </p>
          )}
        </div>

        {!listening && status === "Idle" && !isSpeaking && (
          <button
            onClick={startListening}
            className="px-12 py-4 bg-cyan-500 text-black rounded-2xl font-black tracking-widest uppercase shadow-xl hover:bg-cyan-400 transition-all active:scale-95"
          >
            Wake Up Romaji
          </button>
        )}

        <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status === "Idle" ? "bg-slate-700" : "bg-cyan-400 animate-ping"}`}></div>
            <span className="text-[10px] font-mono text-slate-500 tracking-[0.2em] uppercase">{status}</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
      `}</style>
      
      {/* 🏷️ Mirai School of Technology Branding */}
      <div className="fixed bottom-6 right-8 text-right opacity-30">
        <p className="text-[10px] font-mono text-cyan-500 tracking-widest uppercase">Robot Name: Romaji</p>
        <p className="text-[10px] font-mono text-white/50 tracking-tighter">Developed by Students of Mirai School of Technology</p>
      </div>
    </main>
  );
}