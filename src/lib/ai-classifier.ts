import OpenAI from "openai";
import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type ResponseSchema,
} from "@google/generative-ai";
import { cleanCompanyName } from "./company";
import { isExcludedSender } from "./senders";
import { sleep } from "./concurrency";

// ─── Classification Types ────────────────────────

export interface ClassificationResult {
  isJobRelated: boolean;
  category: "applied" | "reply" | null;
  company: string | null;
  role: string | null;
  status:
    | "applied"
    | "reply_received"
    | "interview"
    | "rejected"
    | "offer"
    | null;
  confidence: number;
}

// ─── System Prompt ───────────────────────────────

const SYSTEM_PROMPT = `You are an extremely strict email classifier for a personal job application tracker. Your only job is to determine if an email is DIRECTLY and UNAMBIGUOUSLY related to a specific job application the user has personally submitted to a specific company for a specific role.

ONLY classify as job-related (isJobRelated: true) for these two categories:

CATEGORY "applied":
- A confirmation/receipt that the user's job application was submitted or received by a SPECIFIC company for a SPECIFIC role.
- MUST reference BOTH a specific hiring company AND a specific job title/role/position.
- Examples: "Thank you for applying to Software Engineer at Google", "We received your application for Product Manager", "Your application to Microsoft has been submitted"

CATEGORY "reply":
- A DIRECT response from a SPECIFIC company's recruiter/hiring team regarding a job the user applied to.
- Includes: interview invitations, rejection letters, offer letters, status updates like "role is on hold", "position has been paused", "hiring is postponed", "position no longer available", "we've decided to move in a different direction"
- Must clearly reference the user's specific application or the role applied for.

STRICTLY NOT JOB-RELATED — always set isJobRelated: false for:
- Account creation, registration, welcome emails ("Welcome to...", "Your account is ready")
- OTP, verification codes, password reset, email confirmation
- Service/product emails: Uber rides, Zomato/Swiggy food delivery, Amazon/Flipkart orders, Paytm/PhonePe transactions
- Internshala/Coursera/Udemy/edX — course enrollments, certificates, bootcamps, webinars
- Unstop, HackerEarth, Devfolio — competition/hackathon registrations
- LinkedIn job alerts, "jobs you might like", connection requests, profile views
- LinkedIn "Your application was viewed by..." notifications (not a reply from the company)
- Naukri/Indeed/Glassdoor — profile update reminders, job board newsletters
- Generic platform assessments (HireVue, Talview, Codility) NOT tied to a specific company application
- Cold recruiter outreach ("Are you open to new opportunities?") where user hasn't applied
- MBA programs, online courses, workshops, educational content
- Newsletters, promotions, marketing emails, subscription updates
- Bank statements, invoices, billing, payment confirmations
- ANY email where you CANNOT confidently identify BOTH a specific hiring company AND a specific job role

JOB PLATFORM SPECIAL HANDLING (Wellfound, AngelList, YC, LinkedIn):
- These are platforms that submit applications on behalf of the user.
- When a Wellfound/AngelList email says "Your application to [COMPANY] has been submitted", it IS job-related.
- When a LinkedIn email (jobs-noreply@linkedin.com) says "Your application was sent to [COMPANY]", it IS job-related (category "applied").
- For "company": extract the ACTUAL HIRING COMPANY (e.g., "Sagepilot AI"), NOT the platform name ("Wellfound", "LinkedIn").
- For "role": extract the actual job title from the email body/snippet.

IMPORTANT RULES:
- "Thank you for registering" ≠ job application. Only "Thank you for applying" counts.
- "Welcome to [Platform]" = account creation, NOT job related.
- If the email is about a company's OWN PRODUCT/SERVICE, it is NOT a job email.
- "Role is on hold", "position paused", "hiring postponed" = reply with status "rejected".
- Only set isJobRelated: true if your confidence is >= 0.75. When in doubt, return isJobRelated: false.

For "company": Extract the HIRING company name only. NOT the ATS/platform (not Greenhouse, Lever, Workday, iCIMS, Wellfound). If unclear, return null.
For "role": Extract from the SUBJECT first, then from the SNIPPET/BODY if the subject is generic. Look for patterns like "for the [ROLE] position", "the [ROLE] role", "role: [ROLE]". If no specific job title is stated, return null.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "isJobRelated": boolean,
  "category": "applied" | "reply" | null,
  "company": string | null,
  "role": string | null,
  "status": "applied" | "reply_received" | "interview" | "rejected" | "offer" | null,
  "confidence": number between 0 and 1
}`;

// ─── Classifier ──────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.75;

const VALID_STATUSES = [
  "applied",
  "reply_received",
  "interview",
  "rejected",
  "offer",
] as const;

const notJobRelated = (confidence = 0): ClassificationResult => ({
  isJobRelated: false,
  category: null,
  company: null,
  role: null,
  status: null,
  confidence,
});

function buildUserPrompt(
  subject: string,
  from: string,
  snippet: string,
  date?: Date
): string {
  const dateStr = date && !isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "unknown";
  return `Classify this email:
Subject: ${subject}
From: ${from}
Date: ${dateStr}
Snippet: ${snippet}`;
}

/** Trims quotes/whitespace, rejects placeholders, caps very long titles. */
export function cleanRole(role: unknown): string | null {
  if (typeof role !== "string") return null;
  let r = role
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (!r || /^(unknown( role)?|n\/?a|null|none)$/i.test(r)) return null;
  if (r.length > 80) {
    r = r.slice(0, 80);
    const lastSpace = r.lastIndexOf(" ");
    if (lastSpace > 40) r = r.slice(0, lastSpace);
    r = r.trim();
  }
  return r;
}

/**
 * Validates raw model output into a well-formed ClassificationResult.
 * Anything malformed or below the confidence threshold becomes "not job-related".
 */
export function sanitizeResult(raw: unknown): ClassificationResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.min(1, Math.max(0, r.confidence))
      : 0;

  const category =
    r.category === "applied" || r.category === "reply" ? r.category : null;

  if (r.isJobRelated !== true || category === null || confidence < CONFIDENCE_THRESHOLD) {
    return notJobRelated(confidence);
  }

  let status = (VALID_STATUSES as readonly string[]).includes(r.status as string)
    ? (r.status as ClassificationResult["status"])
    : null;

  // Keep category and status consistent
  if (category === "applied") status = "applied";
  else if (!status || status === "applied") status = "reply_received";

  return {
    isJobRelated: true,
    category,
    company: cleanCompanyName(r.company as string | null),
    role: cleanRole(r.role),
    status,
    confidence,
  };
}

/**
 * Classifies an email using OpenAI (preferred) or Google Gemini.
 * Throws if the AI call fails, so the caller can leave the email unprocessed
 * and retry on the next sync. The rule-based classifier is used only when no
 * AI key is configured.
 */
export async function classifyEmail(
  subject: string,
  from: string,
  snippet: string,
  date?: Date
): Promise<ClassificationResult> {
  // Cheap pre-filter — never spend an AI call on known-noise senders
  if (isExcludedSender(from)) return notJobRelated(0.95);

  const userPrompt = buildUserPrompt(subject, from, snippet, date);

  if (process.env.OPENAI_API_KEY) {
    return classifyWithOpenAI(userPrompt); // SDK retries 429/5xx internally
  }
  if (process.env.GEMINI_API_KEY) {
    return withRetry(() => classifyWithGemini(userPrompt));
  }
  return ruleBasedClassifier(subject, from, snippet);
}

/** Retries once (after a short backoff) on rate-limit, server, or parse errors. */
async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const retryable = status === undefined || status === 429 || status >= 500;
    if (retries <= 0 || !retryable) throw err;
    await sleep(1500);
    return withRetry(fn, retries - 1);
  }
}

// ─── OpenAI Implementation ──────────────────────

let openaiClient: OpenAI | null = null;
const getOpenAI = () =>
  (openaiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 3,
    timeout: 30_000,
  }));

const OPENAI_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "email_classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["isJobRelated", "category", "company", "role", "status", "confidence"],
      properties: {
        isJobRelated: { type: "boolean" },
        category: { anyOf: [{ type: "string", enum: ["applied", "reply"] }, { type: "null" }] },
        company: { type: ["string", "null"] },
        role: { type: ["string", "null"] },
        status: { anyOf: [{ type: "string", enum: [...VALID_STATUSES] }, { type: "null" }] },
        confidence: { type: "number" },
      },
    },
  },
};

async function classifyWithOpenAI(
  userPrompt: string
): Promise<ClassificationResult> {
  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.05,
    response_format: OPENAI_RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  return sanitizeResult(JSON.parse(content));
}

// ─── Gemini Implementation ──────────────────────

const GEMINI_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    isJobRelated: { type: SchemaType.BOOLEAN },
    category: { type: SchemaType.STRING, format: "enum", enum: ["applied", "reply"], nullable: true },
    company: { type: SchemaType.STRING, nullable: true },
    role: { type: SchemaType.STRING, nullable: true },
    status: { type: SchemaType.STRING, format: "enum", enum: [...VALID_STATUSES], nullable: true },
    confidence: { type: SchemaType.NUMBER },
  },
  required: ["isJobRelated", "category", "company", "role", "status", "confidence"],
};

let geminiModel: GenerativeModel | null = null;
const getGeminiModel = () =>
  (geminiModel ??= new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.05,
      responseMimeType: "application/json",
      responseSchema: GEMINI_SCHEMA,
    },
  }));

async function classifyWithGemini(
  userPrompt: string
): Promise<ClassificationResult> {
  const result = await getGeminiModel().generateContent(userPrompt);
  const text = result.response.text();

  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return sanitizeResult(JSON.parse(cleaned));
}

// ─── Rule-Based Fallback ─────────────────────────

/**
 * Attempts to extract the company name from the email domain when
 * the display name yields nothing useful.
 * e.g. "noreply@recruiting.mercedes-benz.com" → "Mercedes Benz"
 */
function extractCompanyFromDomain(from: string): string | null {
  const domainMatch = from.match(/@(?:[\w-]+\.)?([\w-]+)\.(com|org|io|co|in|net)(?:\.|>|$)/i);
  if (!domainMatch) return null;

  const rawName = domainMatch[1];

  // Exclude generic/noise domains
  const noiseDomains = [
    "gmail", "yahoo", "outlook", "hotmail", "proton",
    "myworkday", "workday", "greenhouse", "lever", "icims",
    "rippling", "bamboohr", "recruitee", "ashby",
    "talent", "careers", "recruiting", "hr", "jobs",
    "wellfound", "angellist", "linkedin",
  ];
  if (noiseDomains.includes(rawName.toLowerCase())) return null;

  // Convert kebab-case to title case: "mercedes-benz" → "Mercedes Benz"
  return rawName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Tries to extract the actual hiring company from Wellfound/platform emails.
 * Wellfound snippet format: "Your application has been submitted! ... [Role] [Company] · ..."
 */
function extractCompanyFromPlatformSnippet(snippet: string): string | null {
  // Wellfound pattern: role + company on same line separated by spaces before "·"
  const wellfoundMatch = snippet.match(/submitted!.*?(?:\n|\.)\s*(.+?)\s+(.+?)\s+[·•]/);
  if (wellfoundMatch) return wellfoundMatch[2].trim();
  return null;
}

function ruleBasedClassifier(
  subject: string,
  from: string,
  snippet: string
): ClassificationResult {
  const lower = `${subject} ${from} ${snippet}`.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const fromLower = from.toLowerCase();
  const snippetLower = snippet.toLowerCase();

  // ── Hard exclusions: sender (shared list with the Gmail query) ──
  if (isExcludedSender(from)) {
    return { isJobRelated: false, category: null, company: null, role: null, status: null, confidence: 0.95 };
  }

  // ── Hard exclusions: subject/snippet keywords ──
  const exclusionKeywords = [
    "account created", "account activation", "verify your account",
    "verify your email", "verification code", "confirm your email",
    "password reset", " otp ", "one-time password", "signed up",
    "welcome to", "registration successful", "profile created",
    "order confirmed", "order delivered", "your order", "shipment",
    "invoice", "payment received", "payment successful", "transaction",
    "bank statement", "credit card", "debit card", "subscription renewed",
    "mba program", "certificate course", "bootcamp", "workshop",
    "webinar", "masterclass", "hackathon", "competition", "coding challenge",
    "job alert", "jobs for you", "new jobs matching", "recommended jobs",
    "who viewed your profile", "update your resume", "complete your profile",
    "talent pool", "open to work",
    "video introduction", "pre-recorded interview", "ai interview",
    "one-way interview", "talview", "hirevue", "codility",
    "newsletter", "unsubscribe", "weekly digest", "daily digest",
    "promotional", "special offer",
  ];

  if (exclusionKeywords.some((kw) => lower.includes(kw))) {
    return { isJobRelated: false, category: null, company: null, role: null, status: null, confidence: 0.9 };
  }

  // ── Application confirmation patterns ──
  const applicationPatterns = [
    "thank you for applying",
    "application received",
    "we received your application",
    "application confirmation",
    "application submitted",
    "successfully applied",
    "your application for",
    "your application to",
    "thanks for applying",
    "thanks for your interest in joining",
    "we have received your application",
    "application has been submitted",
    "application has been received",
    // Wellfound/platform
    "your application has been submitted",
    // LinkedIn Easy Apply
    "your application was sent to",
  ];

  // ── Reply / status update patterns ──
  const replyPatterns = [
    "move forward with your application",
    "move forward with your candidacy",
    "we'd like to invite you for an interview",
    "we would like to invite you for an interview",
    "pleased to inform you",
    "schedule an interview with you",
    "next steps in our hiring process",
    "next steps in the interview process",
    "unfortunately.*not.*moving forward",
    "regret to inform",
    "after careful consideration",
    "pleased to offer you",
    "offer letter",
    "we are happy to offer",
    "we would like to offer",
    "we have decided not to",
    "position has been filled",
    "not be moving forward",
    // On-hold / paused / closed patterns (Fix D)
    "role is on hold",
    "position is on hold",
    "role has been put on hold",
    "position has been put on hold",
    "hiring.*on hold",
    "hiring.*paused",
    "hiring.*postponed",
    "role is no longer available",
    "position is no longer available",
    "position has been closed",
    "role has been closed",
    "no longer moving forward",
    "decided to move in a different direction",
    "decided not to proceed",
  ];

  const isApplication = applicationPatterns.some((kw) => lower.includes(kw));
  const isReply = replyPatterns.some((kw) => {
    if (kw.includes(".*")) return new RegExp(kw).test(lower);
    return lower.includes(kw);
  });

  if (!isApplication && !isReply) {
    return { isJobRelated: false, category: null, company: null, role: null, status: null, confidence: 0.5 };
  }

  // ── Company extraction (Fix B + Fix C) ──
  // 1. Try display name from From field
  const fromMatch = from.match(/(?:"?([^"<]+)"?\s*<)/);
  let company = fromMatch
    ? fromMatch[1]
        .replace(
          /\s*(Careers|Recruiting|Recruitment|HR|Talent|Jobs|Team|Hiring|Notifications?|No.?Reply|Support|via\s+\w+|Alerts?)\s*/gi,
          " "
        )
        .replace(/\s+(at|@)\s+.*/i, "")
        .replace(/\s+/g, " ")
        .trim() || null
    : null;

  // 2. If display name yielded nothing, fall back to domain (Fix B)
  if (!company) {
    company = extractCompanyFromDomain(from);
  }

  // 3. Special handling for job platforms like Wellfound (Fix C)
  const isFromPlatform = fromLower.includes("wellfound") || fromLower.includes("angellist") || fromLower.includes("hi.wellfound");
  if (isFromPlatform) {
    company = extractCompanyFromPlatformSnippet(snippet) || company;
  }

  // 4. LinkedIn Easy Apply: "Your application was sent to Acme"
  const linkedInMatch = subject.match(/your application was sent to\s+(.+?)\s*$/i);
  if (linkedInMatch) {
    company = linkedInMatch[1];
  }

  // ── Role extraction — subject first, then snippet fallback (Fix E) ──
  const roleSubjectPatterns = [
    /(?:application\s+(?:for|to)\s+(?:the\s+)?(?:role\s+of\s+|position\s+of\s+)?)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
    /(?:position\s*(?:of|:|-)\s*)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
    /(?:role\s*(?:of|:|-)\s*)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
    /(?:applied\s+(?:for|to)\s+(?:the\s+)?)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
    /(?:opening\s+(?:for|:|-)\s*)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
    /(?:vacancy\s+(?:for|:|-)\s*)(.+?)(?:\s*[-–|]|\s+at\s|\s*$)/i,
  ];

  let role: string | null = null;

  for (const pattern of roleSubjectPatterns) {
    const m = subject.match(pattern);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (candidate.length <= 60 && candidate.split(" ").length <= 8) {
        role = candidate;
        break;
      }
    }
  }

  // Snippet-based fallback (Fix E) — when subject is generic
  if (!role) {
    const snippetRolePatterns = [
      /(?:for the|for our|for a|the)\s+["']?(.+?)["']?\s+(?:position|role|opening)/i,
      /(?:position|role)\s*(?::|of|–|-)\s*(.+?)(?:\.|,|\s+at\s|\s+in\s|$)/i,
      /(?:applied for|application for)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:role|position|at|$)/i,
      // Bain-style: "Associate - Full Stack Developer(PEG) position"
      /(?:the\s+)([\w\s\-()]+?)\s+position/i,
    ];
    for (const p of snippetRolePatterns) {
      const m = snippet.match(p);
      if (m && m[1]) {
        const candidate = m[1].trim();
        if (candidate.length <= 70 && candidate.split(" ").length <= 10) {
          role = candidate;
          break;
        }
      }
    }
  }

  // ── Status determination (Fix D) ──
  let status: ClassificationResult["status"] = null;
  if (isReply) {
    const isOnHold =
      lower.includes("on hold") ||
      lower.includes("paused") ||
      lower.includes("postponed") ||
      lower.includes("no longer available") ||
      lower.includes("position has been closed") ||
      lower.includes("role has been closed") ||
      lower.includes("no longer moving forward") ||
      lower.includes("different direction");

    if (isOnHold) {
      status = "rejected";
    } else if (
      lower.includes("interview") ||
      lower.includes("schedule") ||
      lower.includes("next steps")
    ) {
      status = "interview";
    } else if (
      lower.includes("unfortunately") ||
      lower.includes("regret") ||
      lower.includes("not moving forward") ||
      lower.includes("position has been filled") ||
      lower.includes("decided not to proceed")
    ) {
      status = "rejected";
    } else if (lower.includes("offer") || lower.includes("pleased to offer")) {
      status = "offer";
    } else {
      status = "reply_received";
    }
  } else {
    status = "applied";
  }

  return {
    isJobRelated: true,
    category: isReply ? "reply" : "applied",
    company: cleanCompanyName(company),
    role: cleanRole(role),
    status,
    confidence: 0.65,
  };
}
