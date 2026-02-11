"use client";
import { useState } from "react";
import RegistrationFlow from "./components/RegistrationFlow";
import ChatInterface from "./components/ChatInterface";

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
            <div className="flex gap-8 mb-6">
              <div className="w-6 h-6 rounded-full bg-cyan-400" />
              <div className="w-6 h-6 rounded-full bg-cyan-400" />
            </div>
            <div className="bg-white rounded-full h-2 w-16" />
          </div>

          <h1 className="text-4xl font-bold text-cyan-400 mb-4">
            Romaji AI Robot
          </h1>
          <p className="text-cyan-300 text-sm mb-8">
            Mirai School of Technology
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col gap-4 w-80">
            <button
              onClick={handleNewUser}
              className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl font-bold text-white text-lg shadow-lg transition-all transform hover:scale-105"
            >
              🆕 Register as New User
            </button>
            <button
              onClick={handleOldUser}
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-xl font-bold text-white text-lg shadow-lg transition-all transform hover:scale-105"
            >
              👤 I'm an Old User
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