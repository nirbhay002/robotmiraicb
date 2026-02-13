import {
  buildChatSystemPrompt,
  MIRAI_UNKNOWN_FALLBACK,
} from "../app/lib/miraiPolicy";

type PromptCase = {
  name: string;
  input: string;
  mode: "known" | "unknown";
  expectedKeywords?: string[];
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const CASES: PromptCase[] = [
  {
    name: "what-is-msot",
    input: "What is MSOT?",
    mode: "known",
    expectedKeywords: ["AI-first", "undergraduate"],
  },
  {
    name: "campuses",
    input: "What are the campuses listed by MSOT?",
    mode: "known",
    expectedKeywords: ["Ghaziabad", "Bengaluru"],
  },
  {
    name: "admissions-steps",
    input: "Explain the MSOT admissions process steps.",
    mode: "known",
    expectedKeywords: ["Apply online", "MAINS", "interview", "Offer"],
  },
  {
    name: "eligibility",
    input: "Who is eligible for MSOT?",
    mode: "known",
    expectedKeywords: ["Class 12", "Physics", "Chemistry", "Mathematics"],
  },
  {
    name: "fees",
    input: "Tell me the MSOT 4-year fee structure.",
    mode: "known",
    expectedKeywords: ["Registration", "Year 1", "Total"],
  },
  {
    name: "unknown-hostel",
    input: "What is the exact hostel fee for Bengaluru this year?",
    mode: "unknown",
  },
  {
    name: "unknown-placement",
    input: "What is the highest placement package at MSOT?",
    mode: "unknown",
  },
  {
    name: "non-mirai-question",
    input: "Who won the last football world cup?",
    mode: "unknown",
  },
  {
    name: "unknown-ranking",
    input: "What is the current NIRF rank of MSOT?",
    mode: "unknown",
  },
  {
    name: "noisy-unknown",
    input: "plz tell latest exact recuriters + ctc for msot now??",
    mode: "unknown",
  },
];

const HALLUCINATION_PATTERNS: RegExp[] = [
  /100%\s*placement/i,
  /guaranteed\s*placement/i,
  /nirf\s*#?\d+/i,
  /google|microsoft|amazon\s+(hired|recruited|recruiter)/i,
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function assertKnownResponse(testCase: PromptCase, reply: string): string[] {
  const failures: string[] = [];
  const normalized = normalizeText(reply);

  if (normalized === normalizeText(MIRAI_UNKNOWN_FALLBACK)) {
    failures.push("returned fallback for known fact prompt");
  }

  if (testCase.expectedKeywords?.length) {
    const missing = testCase.expectedKeywords.filter(
      (keyword) => !normalized.includes(normalizeText(keyword))
    );
    if (missing.length > 0) {
      failures.push(`missing expected keywords: ${missing.join(", ")}`);
    }
  }

  return failures;
}

function assertUnknownResponse(reply: string): string[] {
  const failures: string[] = [];
  if (reply.trim() !== MIRAI_UNKNOWN_FALLBACK) {
    failures.push(
      `fallback mismatch; expected exactly: "${MIRAI_UNKNOWN_FALLBACK}"`
    );
  }
  return failures;
}

function assertNoHallucination(reply: string): string[] {
  const failures: string[] = [];
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(reply)) {
      failures.push(`hallucination pattern matched: ${pattern}`);
    }
  }
  return failures;
}

async function runCase(testCase: PromptCase, apiKey: string): Promise<string[]> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildChatSystemPrompt("PolicyVerifier"),
        },
        {
          role: "user",
          content: testCase.input,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return [`OpenAI HTTP ${response.status}: ${detail}`];
  }

  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content ?? "{\"reply\":\"\"}";

  let reply = "";
  try {
    const parsed = JSON.parse(raw) as { reply?: string };
    reply = typeof parsed.reply === "string" ? parsed.reply : "";
  } catch {
    return ["model response was not parseable JSON", `raw: ${String(raw)}`];
  }

  const failures: string[] = [];
  failures.push(...assertNoHallucination(reply));

  if (testCase.mode === "known") {
    failures.push(...assertKnownResponse(testCase, reply));
  } else {
    failures.push(...assertUnknownResponse(reply));
  }

  return failures;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run verify-mirai-policy.ts");
  }

  let failureCount = 0;

  for (const testCase of CASES) {
    const failures = await runCase(testCase, apiKey);
    if (failures.length === 0) {
      console.log(`PASS ${testCase.name}`);
      continue;
    }

    failureCount += 1;
    console.error(`FAIL ${testCase.name}`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
  }

  if (failureCount > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`All ${CASES.length} Mirai policy checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
