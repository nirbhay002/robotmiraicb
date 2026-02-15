"use client";
import { useState } from "react";
import Image from "next/image";
import RegistrationFlow from "./components/RegistrationFlow";
import ChatInterface from "./components/ChatInterface";
import miraiLogo from "../assets/mirai-logo.png";

type AppState = "LANDING" | "REGISTRATION" | "CHAT";
type UserType = "NEW" | "OLD";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("LANDING");
  const [userType, setUserType] = useState<UserType | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const handleNewUser = () => {
    setUserType("NEW");
    setAppState("REGISTRATION");
  };

  const handleOldUser = () => {
    setUserType("OLD");
    setAppState("CHAT");
  };

  const handleRegistrationComplete = (name: string) => {
    setUserName(name);
    setAppState("CHAT");
  };

  const handleEndChat = () => {
    setAppState("LANDING");
    setUserType(null);
    setUserName(null);
  };

  const handleUserRecognized = (name: string) => {
    setUserName(name);
  };

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center">
      {appState === "LANDING" && (
        <div className="flex flex-col items-center gap-6">
          {/* Robot Logo */}
          <div className="w-48 h-48 rounded-full border-4 border-cyan-400 flex flex-col items-center justify-center mb-8">
            <div className="flex gap-10 mb-8">
              <div className="w-7 h-5 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.45)]" />
              <div className="w-7 h-5 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.45)]" />
            </div>
            <div className="w-20 h-2 rounded-full bg-white opacity-90" />
          </div>

          <h1 className="text-4xl font-bold text-cyan-400 mb-4">
            Romaji: Your AI voice companion at MSOT
          </h1>
          <div className="flex justify-center mb-4">
            <Image src={miraiLogo} alt="Mirai logo" width={130} />
          </div>
          <p className="text-cyan-300 text-sm mb-8">
            Mirai School of Technology
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col gap-4 w-80">
            <button
              onClick={handleNewUser}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl font-bold text-white text-lg shadow-lg transition-all transform hover:scale-105"
            >
              Register as New User
            </button>
            <button
              onClick={handleOldUser}
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-xl font-bold text-white text-lg shadow-lg transition-all transform hover:scale-105"
            >
              I&apos;m an Old User
            </button>
          </div>

          <p className="text-cyan-500 text-xs mt-8 max-w-md text-center">
            New users will register their face and name. Old users will be
            automatically recognized.
          </p>
        </div>
      )}

      {appState === "REGISTRATION" && (
        <RegistrationFlow onComplete={handleRegistrationComplete} />
      )}

      {appState === "CHAT" && (
        <ChatInterface
          userName={userName}
          isOldUser={userType === "OLD"}
          onEndChat={handleEndChat}
          onUserRecognized={handleUserRecognized}
        />
      )}
    </main>
  );
}
