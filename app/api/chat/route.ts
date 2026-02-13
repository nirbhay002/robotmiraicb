import { NextResponse } from "next/server";
import { buildChatSystemPrompt } from "../../lib/miraiPolicy";

function cleanText(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const { text, userName = "Guest", messages = [] } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ reply: "" });
    }

    const history: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: buildChatSystemPrompt(userName),
      },
    ];

    const recentMessages = messages.slice(-10);
    recentMessages.forEach((msg: { role: string; text: string }) => {
      history.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text,
      });
    });

    history.push({
      role: "user",
      content: text,
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: history,
        temperature: 0.2,
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
