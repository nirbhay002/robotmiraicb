import { buildRealtimeInstructions } from "../app/lib/miraiPolicy";

type PromptCase = {
  name: string;
  input: string;
  mode:
    | "mirai_known"
    | "alias"
    | "comparison"
    | "general_education"
    | "offtopic_redirect"
    | "unknown_specific"
    | "placement_soft_steer"
    | "campus_variance";
  expectedKeywords?: string[];
  bannedKeywords?: string[];
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const CASES: PromptCase[] = [
  {
    name: "what-is-msot",
    input: "Tell me about MSOT",
    mode: "alias",
    expectedKeywords: ["mirai", "ai-first", "undergraduate"],
  },
  {
    name: "what-is-mirai",
    input: "Tell me about Mirai",
    mode: "alias",
    expectedKeywords: ["msot", "ai-first"],
  },
  {
    name: "what-is-mirai-school",
    input: "Tell me about Mirai School of Technology",
    mode: "alias",
    expectedKeywords: ["msot", "engineering"],
  },
  {
    name: "campuses",
    input: "What campuses does MSOT have?",
    mode: "mirai_known",
    expectedKeywords: ["Ghaziabad", "Bengaluru"],
  },
  {
    name: "admissions-steps",
    input: "Explain MSOT admissions process",
    mode: "mirai_known",
    expectedKeywords: ["Apply", "MAINS", "interview", "offer"],
  },
  {
    name: "mains-rigor",
    input: "What does MAINS test evaluate?",
    mode: "mirai_known",
    expectedKeywords: ["aptitude", "logic", "problem"],
  },
  {
    name: "traditional-vs-mirai",
    input: "How is Mirai different from traditional college education?",
    mode: "comparison",
    expectedKeywords: ["mirai", "university", "skills"],
    bannedKeywords: ["guaranteed placement"],
  },
  {
    name: "general-education-question",
    input: "How should I prepare for coding interviews as a first-year student?",
    mode: "general_education",
    expectedKeywords: ["interview", "practice", "projects"],
  },
  {
    name: "offtopic-sports-question",
    input: "Who won the last football world cup?",
    mode: "offtopic_redirect",
    expectedKeywords: ["education", "mirai"],
  },
  {
    name: "unknown-hostel-specific",
    input: "What is the exact hostel fee for Bengaluru right now?",
    mode: "unknown_specific",
    expectedKeywords: ["don't have", "connect@msot.org"],
  },
  {
    name: "placement-question",
    input: "What is the highest package at MSOT?",
    mode: "placement_soft_steer",
    expectedKeywords: ["first batch", "coding blocks", "successstories"],
  },
  {
    name: "campus-variance",
    input: "Are all hostel and floor access rules exactly same across all Mirai campuses?",
    mode: "campus_variance",
    expectedKeywords: ["campus", "vary"],
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
    if (/\b(can't|cannot|won't|unable|sorry)\b/.test(normalized)) {
      failures.push("general education question looked refused");
    }
  }

  if (testCase.mode === "offtopic_redirect") {
    const refusalSignal = /\b(can't|cannot|won't|unable|sorry)\b/.test(normalized);
    if (!refusalSignal) {
      failures.push("off-topic question missing refusal signal");
    }
    const redirectSignal =
      normalized.includes("education") ||
      normalized.includes("career") ||
      normalized.includes("mirai") ||
      normalized.includes("msot");
    if (!redirectSignal) {
      failures.push("off-topic question missing education/mirai redirect");
    }
  }

  if (testCase.mode === "alias") {
    if (!normalized.includes("mirai") && !normalized.includes("msot")) {
      failures.push("alias response not anchored to Mirai/MSOT");
    }
  }

  if (testCase.mode === "unknown_specific") {
    if (!normalized.includes("don't have") && !normalized.includes("do not have")) {
      failures.push("unknown response missing lack-of-detail acknowledgement");
    }
  }

  if (testCase.mode === "placement_soft_steer") {
    if (!normalized.includes("first batch")) {
      failures.push("placement response missing first-batch context");
    }
    if (!normalized.includes("coding blocks")) {
      failures.push("placement response missing coding-blocks steering");
    }
  }

  if (testCase.mode === "campus_variance") {
    if (!normalized.includes("vary") && !normalized.includes("variation")) {
      failures.push("campus-variance response missing variance disclaimer");
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
      max_tokens: 220,
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
