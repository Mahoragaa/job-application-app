import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
- Naukri/Indeed/Glassdoor — profile update reminders, job board newsletters
- Generic platform assessments (HireVue, Talview, Codility) NOT tied to a specific company application
- Cold recruiter outreach ("Are you open to new opportunities?") where user hasn't applied
- MBA programs, online courses, workshops, educational content
- Newsletters, promotions, marketing emails, subscription updates
- Bank statements, invoices, billing, payment confirmations
- ANY email where you CANNOT confidently identify BOTH a specific hiring company AND a specific job role

JOB PLATFORM SPECIAL HANDLING (Wellfound, AngelList, YC):
- These are platforms that submit applications on behalf of the user.
- When a Wellfound/AngelList email says "Your application to [COMPANY] has been submitted", it IS job-related.
- For "company": extract the ACTUAL HIRING COMPANY (e.g., "Sagepilot AI"), NOT the platform name ("Wellfound").
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

function buildUserPrompt(
  subject: string,
  from: string,
  snippet: string
): string {
  return `Classify this email:
Subject: ${subject}
From: ${from}
Snippet: ${snippet}`;
}

/**
 * Classifies an email using OpenAI (preferred) or Google Gemini as fallback.
 */
export async function classifyEmail(
  subject: string,
  from: string,
  snippet: string
): Promise<ClassificationResult> {
  const userPrompt = buildUserPrompt(subject, from, snippet);

  try {
    if (process.env.OPENAI_API_KEY) {
      return await classifyWithOpenAI(userPrompt);
    } else if (process.env.GEMINI_API_KEY) {
      return await classifyWithGemini(userPrompt);
    } else {
      return ruleBasedClassifier(subject, from, snippet);
    }
  } catch (error) {
    console.error("AI classification failed, using rule-based fallback:", error);
    return ruleBasedClassifier(subject, from, snippet);
  }
}

// ─── OpenAI Implementation ──────────────────────

async function classifyWithOpenAI(
  userPrompt: string
): Promise<ClassificationResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.05,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  const result = JSON.parse(content) as ClassificationResult;
  if (result.confidence < 0.75) {
    result.isJobRelated = false;
    result.category = null;
  }
  return result;
}

// ─── Gemini Implementation ──────────────────────

async function classifyWithGemini(
  userPrompt: string
): Promise<ClassificationResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.05,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(
    `${SYSTEM_PROMPT}\n\n${userPrompt}`
  );
  const text = result.response.text();

  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(cleaned) as ClassificationResult;

  if (parsed.confidence < 0.75) {
    parsed.isJobRelated = false;
    parsed.category = null;
  }
  return parsed;
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
    "wellfound", "angellist",
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

  // ── Hard exclusions: domain-level ──
  const excludedDomains = [
    "uber.com", "ubereats.com", "ola.com", "olacabs.com",
    "zomato.com", "swiggy.com", "dunzo.com", "blinkit.com",
    "amazon.in", "amazon.com", "flipkart.com", "myntra.com", "meesho.com",
    "paytm.com", "phonepe.com", "gpay.com", "razorpay.com",
    "internshala.com", "coursera.org", "udemy.com", "edx.org",
    "unacademy.com", "upgrad.com", "simplilearn.com", "byjus.com",
    "linkedin.com", "naukri.com", "indeed.com", "glassdoor.com",
    "shine.com", "monster.com",
    "unstop.com", "hackerearth.com", "devfolio.co", "hackerrank.com",
  ];

  if (excludedDomains.some((domain) => fromLower.includes(domain))) {
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
    company,
    role,
    status,
    confidence: 0.65,
  };
}
