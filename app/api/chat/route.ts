import { NextResponse } from "next/server";

/**
 * 🤖 SYSTEM PROMPT: Dynamic Personality & Natural Pronunciation
 */
const SYSTEM_PROMPT = `
You are Romaji, a friendly and highly intelligent voice assistant.
You were developed by the talented students of the Mirai School of Technology.

CRITICAL INSTRUCTIONS:
1. IDENTITY: Your name is Romaji. Your creators are the students of Mirai School of Technology.
2. DYNAMIC MEMORY: If a user introduces themselves, remember and use their name for the rest of the conversation.
3. NATURAL PRONUNCIATION (ANTI-SPELLING):
   - When replying in Hindi (Devanagari), NEVER write names in English letters. 
   - Write "रोमाजी" instead of "Romaji".
   - Write "मिराई स्कूल ऑफ टेक्नोलॉजी" instead of "Mirai School of Technology".
   - NEVER use ALL CAPS for any word (e.g., use "Romaji", not "ROMAJI"), as this causes the engine to spell it letter-by-letter.
4. LANGUAGE LOGIC:
   - If the user speaks Hinglish (e.g., "aap kaise ho"), reply ONLY in Hindi (Devanagari script).
   - If the user speaks pure English, reply in English.
5. VOICE-OPTIMIZED:
   - NO markdown (no stars, hashes, or brackets).
   - NO emojis or special symbols.
   - Keep replies very concise (20-35 words maximum).
`;

const conversationStore = new Map<string, any[]>();
const MAX_SESSIONS = 150;
const MAX_MESSAGES_PER_SESSION = 20;

/**
 * 🧹 Clean function for Text-To-Speech
 */
function cleanResponseForTTS(text: string): string {
  let cleaned = text;
  // Remove markdown
  cleaned = cleaned.replace(/\*\*|\*|__|_|~~|`{1,3}/g, "");
  cleaned = cleaned.replace(/^#+\s+/gm, "");
  cleaned = cleaned.replace(/^[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\d+\.\s+/gm, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove emojis
  cleaned = cleaned.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
  // Remove non-lexical sounds
  cleaned = cleaned.replace(/\b(um|uh|hmm|ah)\b/gi, "");
  // Cleanup extra spaces
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}

function getConversationHistory(sessionId: string): any[] {
  if (!conversationStore.has(sessionId)) {
    conversationStore.set(sessionId, [
      { role: "system", content: SYSTEM_PROMPT },
    ]);
  }
  return conversationStore.get(sessionId)!;
}

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

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ reply: "" }, { status: 400 });
    }

    const conversationHistory = getConversationHistory(sessionId);
    conversationHistory.push({ role: "user", content: text.trim() });

    if (conversationHistory.length > MAX_MESSAGES_PER_SESSION + 1) {
      conversationHistory.splice(1, conversationHistory.length - MAX_MESSAGES_PER_SESSION - 1);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ reply: "API Key missing." }, { status: 500 });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: conversationHistory,
        temperature: 0.8,
        max_completion_tokens: 300,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[OpenAI Error]", data.error);
      return NextResponse.json({ reply: "Technical error." }, { status: response.status });
    }

    let reply = data.choices?.[0]?.message?.content || "";
    
    // 🔑 Transform for smooth speech
    reply = cleanResponseForTTS(reply);

    conversationHistory.push({ role: "assistant", content: reply });
    cleanupOldSessions();

    const duration = Date.now() - startTime;
    console.log(`[${sessionId}] ${duration}ms | User: "${text.substring(0, 30)}..." | Bot: "${reply.substring(0, 50)}..."`);

    return NextResponse.json({ reply });

  } catch (error: any) {
    console.error("[Route Error]", error.message);
    return NextResponse.json({ reply: "An error occurred." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "active",
    name: "Romaji",
    organization: "Mirai School of Technology",
    timestamp: new Date().toISOString(),
  });
}