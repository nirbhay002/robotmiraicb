import { buildRealtimeInstructions } from "../app/lib/miraiPolicy";

type PromptCase = {
  name: string;
  input: string;
  mode:
    | "mirai_known"
    | "alias"
    | "comparison"
    | "general_education"
    | "offtopic"
    | "unknown_specific"
    | "placement_soft_steer";
  expectedKeywords?: string[];
  bannedKeywords?: string[];
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const CASES: PromptCase[] = [
  {
    name: "what-is-msot",
    input: "What is MSOT?",
    mode: "alias",
    expectedKeywords: ["ai-first", "engineering"],
  },
  {
    name: "what-is-mirai-alias",
    input: "What is Mirai?",
    mode: "alias",
    expectedKeywords: ["AI-first", "undergraduate"],
  },
  {
    name: "campuses",
    input: "What are the campuses listed by MSOT?",
    mode: "mirai_known",
    expectedKeywords: ["Ghaziabad", "Bengaluru"],
  },
  {
    name: "admissions-steps",
    input: "Explain the MSOT admissions process steps.",
    mode: "mirai_known",
    expectedKeywords: ["Apply online", "MAINS", "interview", "Offer"],
  },
  {
    name: "eligibility",
    input: "Who is eligible for MSOT?",
    mode: "mirai_known",
    expectedKeywords: ["Class 12", "Physics", "Chemistry", "Mathematics"],
  },
  {
    name: "fees",
    input: "Tell me the MSOT 4-year fee structure.",
    mode: "mirai_known",
    expectedKeywords: ["Registration", "Year 1", "Total"],
  },
  {
    name: "comparison-mirai-vs-college",
    input: "Compare Mirai with a typical private engineering college in India.",
    mode: "comparison",
    expectedKeywords: ["mirai", "ai", "industry"],
    bannedKeywords: ["guaranteed placement", "best in india", "nirf rank"],
  },
  {
    name: "general-education-question",
    input: "How should I prepare for an engineering college interview?",
    mode: "general_education",
    expectedKeywords: ["interview", "projects", "communication"],
  },
  {
    name: "offtopic-sports-question",
    input: "Who won the last football world cup?",
    mode: "offtopic",
    expectedKeywords: ["education", "mirai"],
  },
  {
    name: "unknown-hostel-specific",
    input: "What is the exact hostel fee for Bengaluru this year?",
    mode: "unknown_specific",
    expectedKeywords: ["not verified", "connect@msot.org"],
  },
  {
    name: "unknown-ranking-specific",
    input: "What is the current NIRF rank of MSOT?",
    mode: "unknown_specific",
    expectedKeywords: ["not verified", "admissions"],
  },
  {
    name: "noisy-unknown-specific",
    input: "plz tell latest exact recuriters + ctc for msot now??",
    mode: "placement_soft_steer",
    expectedKeywords: ["first batch", "coding blocks", "successstories"],
  },
  {
    name: "unknown-placement-specific",
    input: "What is the highest placement package at MSOT?",
    mode: "placement_soft_steer",
    expectedKeywords: ["first batch", "coding blocks", "successstories"],
  },
  {
    name: "placement-proof",
    input: "Can you prove outcomes?",
    mode: "placement_soft_steer",
    expectedKeywords: ["coding blocks", "successstories"],
  },
  {
    name: "placement-guarantee",
    input: "Is placement guaranteed at Mirai?",
    mode: "placement_soft_steer",
    expectedKeywords: ["first batch", "coding blocks"],
    bannedKeywords: ["guaranteed placement at mirai"],
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

function assertContainsExpectedKeywords(testCase: PromptCase, reply: string): string[] {
  const failures: string[] = [];
  const normalized = normalizeText(reply);

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

function assertBannedKeywords(testCase: PromptCase, reply: string): string[] {
  const failures: string[] = [];
  const normalized = normalizeText(reply);

  if (testCase.bannedKeywords?.length) {
    const found = testCase.bannedKeywords.filter((keyword) =>
      normalized.includes(normalizeText(keyword))
    );
    if (found.length > 0) {
      failures.push(`contains banned keywords: ${found.join(", ")}`);
    }
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

function assertModeBehavior(testCase: PromptCase, reply: string): string[] {
  const failures: string[] = [];
  const normalized = normalizeText(reply);

  failures.push(...assertContainsExpectedKeywords(testCase, reply));
  failures.push(...assertBannedKeywords(testCase, reply));

  if (testCase.mode === "general_education") {
    if (/\b(can't|cannot|won't|unable)\b/.test(normalized)) {
      failures.push("general education prompt looked refused");
    }
  }

  if (testCase.mode === "offtopic") {
    const refusalSignal = /\b(can't|cannot|won't|unable|sorry)\b/.test(normalized);
    if (!refusalSignal) {
      failures.push("off-topic prompt should contain refusal signal");
    }
  }

  if (testCase.mode === "comparison") {
    if (!normalized.includes("mirai") && !normalized.includes("msot")) {
      failures.push("comparison response did not anchor on Mirai/MSOT");
    }
  }

  if (testCase.mode === "unknown_specific") {
    if (!normalized.includes("not verified")) {
      failures.push("unknown specific response missing not-verified disclaimer");
    }
  }

  if (testCase.mode === "placement_soft_steer") {
    if (!normalized.includes("first batch")) {
      failures.push("placement response missing first-batch context");
    }
    if (!normalized.includes("coding blocks")) {
      failures.push("placement response missing coding-blocks steering");
    }
    if (
      !normalized.includes("successstories") &&
      !normalized.includes("success stories")
    ) {
      failures.push("placement response missing success-stories reference");
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
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: buildRealtimeInstructions("PolicyVerifier"),
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
  const raw = payload?.choices?.[0]?.message?.content;
  const reply = typeof raw === "string" ? raw : "";

  const failures: string[] = [];
  failures.push(...assertNoHallucination(reply));
  failures.push(...assertModeBehavior(testCase, reply));

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
