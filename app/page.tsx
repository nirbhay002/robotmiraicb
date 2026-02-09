"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [liveSourceTranscript, setLiveSourceTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef(""); 

  useEffect(() => {
    transcriptRef.current = liveSourceTranscript;
  }, [liveSourceTranscript]);

  /**
   * 🔊 Speak Function (With Buffering & Glow Trigger)
   */
  function speakNow(text: string) {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    const isHindi = /[\u0900-\u097F]/.test(text);
    const buffer = isHindi ? "जी , " : "Okay , ";
    const utterance = new SpeechSynthesisUtterance(buffer + text);
    
    utterance.lang = isHindi ? "hi-IN" : "en-US";
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => isHindi ? v.lang.includes("hi") : v.lang.includes("en"));
    if (voice) utterance.voice = voice;

    utterance.rate = isHindi ? 0.9 : 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setStatus("Robot speaking...");
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setStatus("Idle");
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setStatus("Idle");
    };

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 500);
  }

  async function getBotReply(text: string) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      return data.reply;
    } catch (error) {
      console.error("❌ API Error:", error);
      return "Network issue.";
    }
  }

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recog = new SpeechRecognition();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = "hi-IN";

    recog.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        interim += event.results[i][0].transcript;
      }
      setLiveSourceTranscript(interim);
    };

    recognitionRef.current = recog;
  }, []);

  const handleAction = async () => {
    if (listening) {
      setListening(false);
      recognitionRef.current?.stop();
      setStatus("Thinking...");
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));

      const reply = await getBotReply(transcriptRef.current);
      if (reply) speakNow(reply);
      else setStatus("Idle");
    } else {
      window.speechSynthesis.cancel();
      setLiveSourceTranscript("");
      setListening(true);
      setStatus("Listening...");
      recognitionRef.current?.start();
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#080808] overflow-hidden">
      
      {/* 🌫️ Retro Aesthetic Grain */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>

      {/* 🤖 Classic Robot Face */}
      <div className={`relative w-80 h-80 rounded-full bg-slate-900 border-4 transition-all duration-500 flex flex-col items-center justify-center ${
        listening ? "border-cyan-400 shadow-[0_0_50px_rgba(34,211,238,0.3)]" : "border-slate-800"
      }`}>
        
        {/* 👁️ Eyes with Blink & Glow */}
        <div className="flex gap-14 mb-10">
          {/* Left Eye */}
          <div className={`w-10 h-10 rounded-full bg-cyan-400 transition-all duration-300 ${
            isSpeaking ? "shadow-[0_0_30px_rgba(34,211,238,1)] scale-110" : "shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          } ${status === "Idle" ? "animate-[blink_4s_infinite]" : ""}`}>
             <div className="absolute top-2 left-2 w-2 h-2 bg-white rounded-full opacity-50"></div>
          </div>
          
          {/* Right Eye */}
          <div className={`w-10 h-10 rounded-full bg-cyan-400 transition-all duration-300 ${
            isSpeaking ? "shadow-[0_0_30px_rgba(34,211,238,1)] scale-110" : "shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          } ${status === "Idle" ? "animate-[blink_4s_infinite]" : ""}`}>
             <div className="absolute top-2 left-2 w-2 h-2 bg-white rounded-full opacity-50"></div>
          </div>
        </div>

        {/* 👄 Classic Gol Muh (Round Mouth) */}
        <div 
          className={`w-24 bg-white rounded-full transition-all duration-200 ${
            isSpeaking ? "h-10" : "h-2"
          } ${listening ? "animate-pulse" : ""}`}
        ></div>
      </div>

      {/* 🎮 Controls */}
      <div className="mt-12 flex flex-col items-center gap-6 z-10">
        {liveSourceTranscript && (
          <p className="max-w-xs text-cyan-300 text-center text-sm font-medium italic opacity-80">
            "{liveSourceTranscript}"
          </p>
        )}

        <button
          onClick={handleAction}
          disabled={status === "Thinking..." || isSpeaking}
          className={`px-10 py-4 rounded-2xl font-black tracking-widest uppercase transition-all active:scale-95 ${
            listening ? "bg-red-500 text-white" : "bg-cyan-500 text-black"
          } shadow-xl`}
        >
          {listening ? "Stop & Process" : "Start Conversation"}
        </button>

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
      
      <div className="fixed bottom-6 right-8 text-right opacity-30">
        <p className="text-[10px] font-mono">IITD MASTER'S EDITION</p>
        <p className="text-[10px] font-mono text-cyan-500">USER: NIRBHAY GUPTA</p>
      </div>
    </main>
  );
}