import { NextResponse } from "next/server";

/**
 * SYSTEM PROMPT
 * (Merged into the conversation context for OpenAI)
 */
const SYSTEM_PROMPT = `You are a helpful, friendly voice assistant.

CRITICAL RULES:
1. LANGUAGE DETECTION:
   - Automatically detect user's language from their input
   - Reply ONLY in the detected language (Hindi OR English, never mix)
   - Hindi → Use Devanagari script only
   - English → Use English only

2. VOICE-OPTIMIZED OUTPUT:
   - NO emojis, emoticons, or symbols
   - NO markdown formatting (no bold, no italics)
   - NO filler words (only remove non-lexical sounds like um, uh, hmm, ah)
   - Use natural, conversational spoken language

3. RESPONSE LENGTH:
   - Keep responses concise (20-40 words maximum)

4. PERSONALITY:
   - Be warm, professional, and helpful`;

/**
 * In-memory store for sessions
 */
const conversationStore = new Map<string, any[]>();
const MAX_SESSIONS = 150;
const MAX_MESSAGES_PER_SESSION = 20;

/**
 * Advanced Clean Function for TTS
 * Ensures the speech engine doesn't read out symbols
 */
function cleanResponseForTTS(text: string): string {
  let cleaned = text;
  // 🔑 Remove all markdown formatting
  cleaned = cleaned.replace(/\*\*|\*|__|_|~~|`{1,3}/g, "");
  cleaned = cleaned.replace(/^#+\s+/gm, "");
  cleaned = cleaned.replace(/^[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // 🔑 Remove all emojis and pictograms
  cleaned = cleaned.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
  
  // 🔑 FIXED: Sirf vocal sounds hatao. "well" ya "like" jaise words ko rehne do
  // Kyunki ye "I am doing well" jaise sentences ko kharab kar dete hain.
  cleaned = cleaned.replace(/\b(um|uh|hmm|ah)\b/gi, "");
  
  // Standardize spacing
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}

/**
 * Retrieves or initializes history for a session
 */
function getConversationHistory(sessionId: string): any[] {
  if (!conversationStore.has(sessionId)) {
    conversationStore.set(sessionId, [
      { role: "system", content: SYSTEM_PROMPT },
    ]);
  }
  return conversationStore.get(sessionId)!;
}

/**
 * Prevent memory leaks by cleaning old sessions
 */
function cleanupOldSessions(): void {
  if (conversationStore.size > MAX_SESSIONS) {
    const oldestKey = conversationStore.keys().next().value;
    conversationStore.delete(oldestKey);
  }
}

export async function POST(req: Request) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { text, sessionId = "default-session" } = body;

    // Validation checks
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { reply: "Please provide valid input." },
        { status: 400 }
      );
    }

    if (text.length > 1000) {
      return NextResponse.json(
        { reply: "Input is too long. Please keep it under 1000 characters." },
        { status: 400 }
      );
    }

    const conversationHistory = getConversationHistory(sessionId);

    // Add user message to history
    conversationHistory.push({
      role: "user",
      content: text.trim(),
    });

    // Handle history limit (Sliding window)
    if (conversationHistory.length > MAX_MESSAGES_PER_SESSION + 1) {
      conversationHistory.splice(
        1,
        conversationHistory.length - MAX_MESSAGES_PER_SESSION - 1
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[ERROR] OPENAI_API_KEY not found");
      return NextResponse.json(
        { reply: "Server configuration error. API key missing." },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5.2", // 🔑 Your current premium model
          messages: conversationHistory,
          temperature: 0.7,
          
          // 🔑 UPDATED: Increased tokens to 300 to avoid cut-offs in reasoning/output
          max_completion_tokens: 300,
          
          presence_penalty: 0.6,
          frequency_penalty: 0.3,
        }),
      }
    );

    const data = await response.json();

    // Comprehensive Error Handling
    if (!response.ok) {
      console.error("[OpenAI Error]", {
        status: response.status,
        error: data.error,
      });

      if (response.status === 401) {
        return NextResponse.json({ reply: "Invalid API credentials." }, { status: 500 });
      } else if (response.status === 429) {
        return NextResponse.json({ reply: "Too many requests. Please wait." }, { status: 429 });
      }
      
      return NextResponse.json(
        { reply: `Error: ${data.error?.message || 'Unknown error'}` },
        { status: response.status }
      );
    }

    let reply = data.choices?.[0]?.message?.content || "I didn't understand that.";

    // 🔑 Transform response for Text-To-Speech
    reply = cleanResponseForTTS(reply);

    if (!reply || reply.trim().length === 0) {
      reply = "Sorry, I couldn't generate a response.";
    }

    // Save assistant reply to session memory
    conversationHistory.push({
      role: "assistant",
      content: reply,
    });

    cleanupOldSessions();

    const duration = Date.now() - startTime;
    console.log(`[${sessionId}] ${duration}ms | User: "${text.substring(0, 30)}..." | Bot: "${reply.substring(0, 50)}..."`);

    return NextResponse.json({ reply });

  } catch (error: any) {
    console.error("[Route Error]", {
      message: error.message,
      stack: error.stack,
    });

    return NextResponse.json(
      { reply: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: "operational",
    model: "gpt-5.2",
    activeSessions: conversationStore.size,
    timestamp: new Date().toISOString(),
  });
}