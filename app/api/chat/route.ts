import { NextResponse } from "next/server";

/* ================= SYSTEM PROMPT ================= */
const BASE_SYSTEM_PROMPT = `You are Romaji, an intelligent humanoid robot developed at Mirai School of Technology.

CORE CAPABILITIES:
- You have conversational memory with each user
- You know the user's name when they're logged in
- You speak both Hindi (Devanagari script) and English
- You are friendly, helpful, and concise

BEHAVIOR GUIDELINES:
- Keep responses natural and conversational
- Limit responses to 1-3 sentences
- Use Hindi (Devanagari) for Hindi questions
- Use English for English questions
- Be helpful and friendly
- No emojis

OUTPUT FORMAT:
Always respond with valid JSON:
{
  "reply": "your response text"
}
`;

/* ================= HELPER FUNCTIONS ================= */
function cleanText(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================= MAIN ROUTE ================= */
export async function POST(req: Request) {
  try {
    const { text, userName = "Guest", messages = [] } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ reply: "" });
    }

    // Build conversation history
    const history: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: `${BASE_SYSTEM_PROMPT}\n\nCURRENT USER: ${userName}`,
      },
    ];

    // Add previous messages (keep last 10)
    const recentMessages = messages.slice(-10);
    recentMessages.forEach((msg: { role: string; text: string }) => {
      history.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text,
      });
    });

    // Add current message
    history.push({
      role: "user",
      content: text,
    });

    // Special handling for name queries
    const lowerText = text.toLowerCase();
    if (
      lowerText.includes("my name") ||
      lowerText.includes("mera naam") ||
      lowerText.includes("who am i") ||
      lowerText.includes("mai kaun")
    ) {
      if (userName !== "Guest") {
        return NextResponse.json({
          reply: `आपका नाम ${userName} है।`,
        });
      } else {
        return NextResponse.json({
          reply: "मुझे अभी आपका नाम ज्ञात नहीं है।",
        });
      }
    }

    // Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: history,
        temperature: 0.7,
        max_tokens: 150,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("OpenAI API Error:", errorData);
      return NextResponse.json({
        reply: "मुझे अभी तकनीकी समस्या हो रही है। कृपया फिर से कोशिश करें।",
      });
    }

    const data = await response.json();
    const content = JSON.parse(
      data.choices?.[0]?.message?.content || '{"reply":""}'
    );

    const reply = cleanText(content.reply || "");

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("❌ Chat API error:", err);
    return NextResponse.json({
      reply: "कुछ तकनीकी समस्या हो गई है।",
    });
  }
}