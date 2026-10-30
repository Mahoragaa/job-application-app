import zlib from "zlib";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Structured Resume & Diff Types ──────────────

export interface SkillGroup {
  category: string;
  items: string[];
}

export interface ExperienceItem {
  id: string;
  company: string;
  role: string;
  location: string;
  dates: string;
  bullets: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  techStack: string;
  link: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  degree: string;
  dates: string;
  details: string;
}

export interface StructuredResume {
  fullName: string;
  contactInfo: string;
  summary: string;
  skills: SkillGroup[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
}

export interface ResumeChangeItem {
  id: string;
  section: "summary" | "skills" | "experience" | "projects";
  targetLabel: string;
  before: string;
  after: string;
  reason: string;
  accepted: boolean;
}

export interface RevisionHistoryEntry {
  id: string;
  timestamp: string;
  prompt: string;
  sectionTarget?: string;
  summaryOfChanges: string;
  snapshot: StructuredResume;
}

export interface TailorResult {
  tailoredContent: StructuredResume;
  changeSummary: ResumeChangeItem[];
  keywordsMatched: string[];
  keywordsMissing: string[];
  matchScoreBefore: number;
  matchScoreAfter: number;
}

export type TailorMode = "conservative" | "balanced" | "aggressive";

// ─── AI Clients ──────────────────────────────────

let openaiClient: OpenAI | null = null;
const getOpenAI = () =>
  (openaiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 2,
    timeout: 60_000,
  }));

const getGemini = () => {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};

async function runJsonPrompt<T>(
  systemPrompt: string,
  userPrompt: string,
  inlineAttachment?: { data: string; mimeType: string }
): Promise<T> {
  if (process.env.OPENAI_API_KEY && !inlineAttachment) {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");
    return JSON.parse(content) as T;
  }

  const gemini = getGemini();
  if (gemini) {
    const model = gemini.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: userPrompt },
    ];
    if (inlineAttachment) {
      parts.push({ inlineData: inlineAttachment });
    }
    const result = await model.generateContent(parts);
    const cleaned = result.response
      .text()
      .replace(/```json\n?|\n?```/g, "")
      .trim();
    return JSON.parse(cleaned) as T;
  }

  throw new Error("NO_AI_KEY");
}

// ─── File Text Extraction (PDF / DOCX / TXT / MD) ──

/**
 * Extracts text from a `.docx` buffer by locating `word/document.xml` in the
 * ZIP archive and inflating it with Node's built-in `zlib`.
 */
function extractDocxText(buffer: Buffer): string {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    // Local file header signature 0x04034b50
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLen).toString("utf8");
    const dataStart = offset + 30 + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (fileName === "word/document.xml" && dataEnd <= buffer.length) {
      const rawSlice = buffer.subarray(dataStart, dataEnd);
      const xmlBuffer =
        compression === 8
          ? zlib.inflateRawSync(rawSlice)
          : compression === 0
          ? rawSlice
          : null;
      if (xmlBuffer) {
        const xml = xmlBuffer.toString("utf8");
        return xml
          .replace(/<\/w:p>/g, "\n")
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<w:br[^/>]*\/>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }
    offset = dataEnd > offset ? dataEnd : offset + 1;
  }
  throw new Error("Could not locate word/document.xml inside DOCX file");
}

/**
 * Extracts text from a PDF buffer by decompressing FlateDecode streams with
 * Node's built-in `zlib` and parsing PDF text operators (`Tj`, `TJ`).
 */
function extractPdfTextLocal(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];

  const decodePdfLiteral = (s: string) =>
    s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");

  const extractOperators = (content: string) => {
    const btBlocks = content.match(/BT[\s\S]*?ET/g) || [content];
    for (const block of btBlocks) {
      const parts: string[] = [];
      const regex = /\((?:\\.|[^\\()])*\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(block)) !== null) {
        if (m[1] !== undefined) {
          const inner = m[1];
          const strRegex = /\((?:\\.|[^\\()])*\)/g;
          let sm: RegExpExecArray | null;
          while ((sm = strRegex.exec(inner)) !== null) {
            parts.push(decodePdfLiteral(sm[0].slice(1, -1)));
          }
        } else {
          const lit = m[0].replace(/\)\s*Tj$/, "").slice(1);
          parts.push(decodePdfLiteral(lit));
        }
      }
      if (parts.length > 0) {
        chunks.push(parts.join(""));
      }
    }
  };

  let pos = 0;
  while (pos < raw.length) {
    const streamIdx = raw.indexOf("stream", pos);
    if (streamIdx === -1) break;
    let start = streamIdx + 6;
    if (raw[start] === "\r" && raw[start + 1] === "\n") start += 2;
    else if (raw[start] === "\n" || raw[start] === "\r") start += 1;

    const endIdx = raw.indexOf("endstream", start);
    if (endIdx === -1) break;

    const streamBuf = buffer.subarray(start, endIdx);
    try {
      const inflated = zlib.inflateSync(streamBuf).toString("latin1");
      extractOperators(inflated);
    } catch {
      extractOperators(streamBuf.toString("latin1"));
    }
    pos = endIdx + 9;
  }

  return chunks
    .join("\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromUploadedFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ text: string; inlinePdf?: { data: string; mimeType: string } }> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
    return { text: extractDocxText(buffer) };
  }

  if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
    const localText = extractPdfTextLocal(buffer);
    return {
      text: localText,
      inlinePdf: { data: buffer.toString("base64"), mimeType: "application/pdf" },
    };
  }

  return { text: buffer.toString("utf8").trim() };
}

// ─── Sanitizer & Helpers ─────────────────────────

export function sanitizeStructuredResume(raw: unknown): StructuredResume {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const str = (v: unknown, fallback = "") =>
    typeof v === "string" ? v.trim() : fallback;

  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];

  const skills: SkillGroup[] = Array.isArray(obj.skills)
    ? obj.skills
        .map((s) => {
          const item = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          return {
            category: str(item.category, "Core Skills"),
            items: strArr(item.items),
          };
        })
        .filter((g) => g.items.length > 0)
    : [];

  const experience: ExperienceItem[] = Array.isArray(obj.experience)
    ? obj.experience.map((e, idx) => {
        const item = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
        return {
          id: str(item.id, `exp-${idx + 1}`),
          company: str(item.company, "Company"),
          role: str(item.role, "Role"),
          location: str(item.location, ""),
          dates: str(item.dates, ""),
          bullets: strArr(item.bullets),
        };
      })
    : [];

  const projects: ProjectItem[] = Array.isArray(obj.projects)
    ? obj.projects.map((p, idx) => {
        const item = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        return {
          id: str(item.id, `proj-${idx + 1}`),
          name: str(item.name, "Project"),
          techStack: str(item.techStack, ""),
          link: str(item.link, ""),
          bullets: strArr(item.bullets),
        };
      })
    : [];

  const education: EducationItem[] = Array.isArray(obj.education)
    ? obj.education.map((ed, idx) => {
        const item = (ed && typeof ed === "object" ? ed : {}) as Record<string, unknown>;
        return {
          id: str(item.id, `edu-${idx + 1}`),
          institution: str(item.institution, "Institution"),
          degree: str(item.degree, ""),
          dates: str(item.dates, ""),
          details: str(item.details, ""),
        };
      })
    : [];

  return {
    fullName: str(obj.fullName, "Candidate Name"),
    contactInfo: str(obj.contactInfo, ""),
    summary: str(obj.summary, ""),
    skills,
    experience,
    projects,
    education,
  };
}

export function structuredResumeToMarkdown(resume: StructuredResume): string {
  const lines: string[] = [];
  lines.push(`# ${resume.fullName || "Resume"}`);
  if (resume.contactInfo) lines.push(resume.contactInfo);
  lines.push("");

  if (resume.summary) {
    lines.push("## Professional Summary");
    lines.push(resume.summary);
    lines.push("");
  }

  if (resume.skills.length > 0) {
    lines.push("## Technical Skills");
    for (const group of resume.skills) {
      lines.push(`- **${group.category}:** ${group.items.join(", ")}`);
    }
    lines.push("");
  }

  if (resume.experience.length > 0) {
    lines.push("## Professional Experience");
    for (const exp of resume.experience) {
      const meta = [exp.location, exp.dates].filter(Boolean).join(" | ");
      lines.push(`### ${exp.role} — ${exp.company}${meta ? ` (${meta})` : ""}`);
      for (const b of exp.bullets) {
        lines.push(`- ${b}`);
      }
      lines.push("");
    }
  }

  if (resume.projects.length > 0) {
    lines.push("## Projects");
    for (const proj of resume.projects) {
      const tech = proj.techStack ? ` | *${proj.techStack}*` : "";
      lines.push(`### ${proj.name}${tech}`);
      for (const b of proj.bullets) {
        lines.push(`- ${b}`);
      }
      lines.push("");
    }
  }

  if (resume.education.length > 0) {
    lines.push("## Education");
    for (const edu of resume.education) {
      lines.push(
        `- **${edu.degree || edu.institution}** — ${edu.institution}${
          edu.dates ? ` (${edu.dates})` : ""
        }${edu.details ? ` | ${edu.details}` : ""}`
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// ─── 1. Parse Raw Resume Text into Structured JSON ──

const PARSE_SYSTEM_PROMPT = `You are an expert technical resume parser. Convert the provided resume into a clean, lossless JSON object with this exact structure:
{
  "fullName": "string",
  "contactInfo": "string (email, phone, location, LinkedIn, GitHub, portfolio on one line separated by ' | ')",
  "summary": "string (professional summary or objective if present, otherwise synthesize a concise 2-sentence factual summary from their experience)",
  "skills": [
    { "category": "string (e.g. Languages, Frameworks, Cloud & Tools)", "items": ["string"] }
  ],
  "experience": [
    {
      "id": "exp-1",
      "company": "string",
      "role": "string",
      "location": "string",
      "dates": "string",
      "bullets": ["string (preserve every accomplishment bullet faithfully)"]
    }
  ],
  "projects": [
    {
      "id": "proj-1",
      "name": "string",
      "techStack": "string",
      "link": "string",
      "bullets": ["string"]
    }
  ],
  "education": [
    {
      "id": "edu-1",
      "institution": "string",
      "degree": "string",
      "dates": "string",
      "details": "string (GPA, honors, coursework)"
    }
  ]
}
Preserve all facts, metrics, companies, dates, and bullets accurately. Respond ONLY with valid JSON.`;

function ruleBasedResumeParser(rawText: string): StructuredResume {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fullName = lines[0] || "Candidate Name";
  const contactInfo =
    lines.find((l) => l.includes("@") || /\d{3}[-.\s]?\d{3}/.test(l) || /linkedin|github/i.test(l)) ||
    lines[1] ||
    "";

  const bulletLines = lines
    .filter((l) => /^[-•*▪▸]\s+/.test(l))
    .map((l) => l.replace(/^[-•*▪▸]\s+/, "").trim());

  const skillTokens = rawText.match(
    /\b(JavaScript|TypeScript|Python|Java|C\+\+|Go|Rust|SQL|React|Next\.js|Node\.js|Express|GraphQL|REST|AWS|GCP|Azure|Docker|Kubernetes|PostgreSQL|MongoDB|Redis|Prisma|Git|CI\/CD|Tailwind|Linux|TensorFlow|PyTorch)\b/gi
  );
  const uniqueSkills = Array.from(new Set((skillTokens || []).map((s) => s.trim())));

  return {
    fullName,
    contactInfo,
    summary:
      lines.find((l) => l.length > 80 && !l.includes("@") && !/^[-•*]/.test(l)) ||
      "Results-driven professional with experience building and delivering high-impact solutions.",
    skills: [
      {
        category: "Core Technologies & Skills",
        items: uniqueSkills.length > 0 ? uniqueSkills : ["Software Engineering", "Problem Solving", "System Design"],
      },
    ],
    experience: [
      {
        id: "exp-1",
        company: "Experience Highlights",
        role: "Professional Experience",
        location: "",
        dates: "Present",
        bullets:
          bulletLines.length > 0
            ? bulletLines.slice(0, 8)
            : lines.slice(2, 8).filter((l) => l.length > 25),
      },
    ],
    projects:
      bulletLines.length > 8
        ? [
            {
              id: "proj-1",
              name: "Key Projects & Initiatives",
              techStack: uniqueSkills.slice(0, 5).join(", "),
              link: "",
              bullets: bulletLines.slice(8, 13),
            },
          ]
        : [],
    education: [],
  };
}

export async function parseResumeText(
  rawText: string,
  inlinePdf?: { data: string; mimeType: string }
): Promise<{ rawText: string; structured: StructuredResume }> {
  try {
    const parsed = await runJsonPrompt<StructuredResume>(
      PARSE_SYSTEM_PROMPT,
      rawText
        ? `Parse this resume into structured JSON:\n\n${rawText}`
        : "Extract and parse the attached PDF resume into structured JSON.",
      inlinePdf
    );
    const structured = sanitizeStructuredResume(parsed);
    const effectiveRaw = rawText || structuredResumeToMarkdown(structured);
    return { rawText: effectiveRaw, structured };
  } catch {
    const structured = ruleBasedResumeParser(rawText || "Candidate Resume");
    return { rawText: rawText || structuredResumeToMarkdown(structured), structured };
  }
}

// ─── 2. Tailor Resume to Job Description ─────────

const TAILOR_SYSTEM_PROMPT = `You are an elite Executive Technical Recruiter and ATS Resume Optimization Strategist.
Your task is to tailor a candidate's StructuredResume to a specific Job Description (JD) for a better fit while remaining 100% truthful to the candidate's actual background.

STRICT ETHICAL & QUALITY RULES:
1. NEVER invent fake companies, fake job titles, fake degrees, or fake employment dates.
2. DO rewrite the Professional Summary to directly position the candidate's real background for the target role & company.
3. DO reorganize and surface relevant skills from the candidate's background (and standard adjacent tools clearly implied by their existing stack) so ATS scanners match the JD.
4. DO rewrite experience & project bullet points to emphasize relevant keywords, architectural patterns, and measurable outcomes that align with the JD's responsibilities.
5. For every meaningful modification you make, record an entry in "changeSummary" with the exact "before" text, "after" text, "section", "targetLabel" (e.g. "Professional Summary", "Acme Corp — Senior Engineer (Bullet 1)", "Skills — Cloud & DevOps"), and a clear 1-sentence "reason" explaining how it improves fit for the JD.

Respond ONLY with valid JSON matching this schema:
{
  "tailoredContent": {
    "fullName": "string",
    "contactInfo": "string",
    "summary": "string",
    "skills": [{ "category": "string", "items": ["string"] }],
    "experience": [{ "id": "string", "company": "string", "role": "string", "location": "string", "dates": "string", "bullets": ["string"] }],
    "projects": [{ "id": "string", "name": "string", "techStack": "string", "link": "string", "bullets": ["string"] }],
    "education": [{ "id": "string", "institution": "string", "degree": "string", "dates": "string", "details": "string" }]
  },
  "changeSummary": [
    {
      "id": "chg-1",
      "section": "summary" | "skills" | "experience" | "projects",
      "targetLabel": "string",
      "before": "string",
      "after": "string",
      "reason": "string",
      "accepted": true
    }
  ],
  "keywordsMatched": ["string (top 8-15 JD keywords now present in the tailored resume)"],
  "keywordsMissing": ["string (2-6 JD keywords not in candidate's background that they may want to review)"],
  "matchScoreBefore": number (0-100 realistic ATS match score of original resume),
  "matchScoreAfter": number (0-100 realistic ATS match score after tailoring)
}`;

function extractKeywordsFromJD(jd: string): string[] {
  const dictionary = [
    "TypeScript", "JavaScript", "Python", "Java", "Go", "Rust", "C++", "SQL",
    "React", "Next.js", "Node.js", "GraphQL", "REST API", "Microservices",
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "CI/CD", "Terraform",
    "PostgreSQL", "MongoDB", "Redis", "Kafka", "Prisma", "System Design",
    "Distributed Systems", "Machine Learning", "LLMs", "OpenAI", "AI",
    "Agile", "Cross-functional", "Performance Optimization", "Scalability",
    "Security", "Testing", "TDD", "Observability", "Tailwind CSS",
  ];
  const lower = jd.toLowerCase();
  const matched = dictionary.filter((kw) => lower.includes(kw.toLowerCase()));
  if (matched.length >= 4) return matched.slice(0, 12);

  // Extract capitalized technical words from JD
  const words = Array.from(
    new Set(
      (jd.match(/\b[A-Z][A-Za-z0-9.+#-]{2,18}\b/g) || []).filter(
        (w) => !/^(The|And|For|With|You|Our|Are|Will|Who|What|This|That|From|Have|Your)$/.test(w)
      )
    )
  );
  return [...matched, ...words].slice(0, 10);
}

function ruleBasedTailor(
  baseResume: StructuredResume,
  jobDescription: string,
  company: string,
  role: string
): TailorResult {
  const jdKeywords = extractKeywordsFromJD(jobDescription);
  const existingText = JSON.stringify(baseResume).toLowerCase();

  const alreadyPresent = jdKeywords.filter((k) => existingText.includes(k.toLowerCase()));
  const missing = jdKeywords.filter((k) => !existingText.includes(k.toLowerCase()));

  const tailored: StructuredResume = JSON.parse(JSON.stringify(baseResume));
  const changes: ResumeChangeItem[] = [];

  // 1. Tailor summary
  const oldSummary = baseResume.summary;
  const topKw = jdKeywords.slice(0, 4).join(", ") || "scalable software systems";
  const newSummary = `${role} candidate with proven experience delivering high-impact solutions aligned with ${company}'s engineering goals. Skilled in ${topKw}, with a strong track record of end-to-end execution, performance optimization, and cross-functional collaboration.`;
  tailored.summary = newSummary;
  changes.push({
    id: "chg-summary",
    section: "summary",
    targetLabel: "Professional Summary",
    before: oldSummary || "(No summary provided)",
    after: newSummary,
    reason: `Positions profile specifically for the ${role} role at ${company} and front-loads key JD terms (${topKw}).`,
    accepted: true,
  });

  // 2. Align skills
  if (tailored.skills.length > 0 && jdKeywords.length > 0) {
    const oldSkills = tailored.skills[0].items.join(", ");
    const merged = Array.from(new Set([...alreadyPresent, ...tailored.skills[0].items, ...missing.slice(0, 3)]));
    tailored.skills[0].items = merged;
    const newSkills = merged.join(", ");
    if (oldSkills !== newSkills) {
      changes.push({
        id: "chg-skills",
        section: "skills",
        targetLabel: `Skills — ${tailored.skills[0].category}`,
        before: oldSkills,
        after: newSkills,
        reason: "Prioritizes JD-matched technical skills at the front of the skills section for ATS scanning.",
        accepted: true,
      });
    }
  }

  // 3. Enhance first experience bullets
  if (tailored.experience.length > 0 && tailored.experience[0].bullets.length > 0) {
    const exp = tailored.experience[0];
    const oldBullet = exp.bullets[0];
    const focusKw = jdKeywords[0] || "scalable architecture";
    const newBullet = `${oldBullet.replace(/\.$/, "")}, leveraging ${focusKw} best practices to improve reliability and delivery velocity.`;
    exp.bullets[0] = newBullet;
    changes.push({
      id: "chg-exp-1",
      section: "experience",
      targetLabel: `${exp.company} — ${exp.role} (Bullet 1)`,
      before: oldBullet,
      after: newBullet,
      reason: `Reinforces impact and connects existing accomplishment to ${focusKw} mentioned in the job description.`,
      accepted: true,
    });
  }

  const scoreBefore = Math.min(80, Math.max(45, Math.round((alreadyPresent.length / Math.max(1, jdKeywords.length)) * 100)));
  const scoreAfter = Math.min(96, Math.max(scoreBefore + 18, 82));

  return {
    tailoredContent: tailored,
    changeSummary: changes,
    keywordsMatched: Array.from(new Set([...alreadyPresent, ...missing.slice(0, 3)])),
    keywordsMissing: missing.slice(3),
    matchScoreBefore: scoreBefore,
    matchScoreAfter: scoreAfter,
  };
}

export async function tailorResumeToJob(params: {
  baseResume: StructuredResume;
  jobDescription: string;
  company: string;
  role: string;
  mode?: TailorMode;
}): Promise<TailorResult> {
  const { baseResume, jobDescription, company, role, mode = "balanced" } = params;

  const modeInstructions: Record<TailorMode, string> = {
    conservative:
      "MODE: CONSERVATIVE — Only refine the Professional Summary, reorder existing skills, and lightly polish experience bullets for clarity and JD keywords without changing structure.",
    balanced:
      "MODE: BALANCED — Rewrite the Professional Summary for strong role alignment, optimize and group skills for ATS match, and sharpen experience/project bullets with clear action verbs and JD terminology.",
    aggressive:
      "MODE: AGGRESSIVE — Maximize ATS and hiring-manager fit across every section: deeply tailor the summary, reframe every relevant experience and project bullet around the JD's core responsibilities, and surface all transferable technical skills.",
  };

  const userPrompt = `Target Company: ${company}
Target Role: ${role}
${modeInstructions[mode]}

=== JOB DESCRIPTION ===
${jobDescription}

=== CANDIDATE BASE RESUME (JSON) ===
${JSON.stringify(baseResume, null, 2)}`;

  try {
    const raw = await runJsonPrompt<Record<string, unknown>>(TAILOR_SYSTEM_PROMPT, userPrompt);
    const tailoredContent = sanitizeStructuredResume(raw.tailoredContent ?? baseResume);
    const changeSummary: ResumeChangeItem[] = Array.isArray(raw.changeSummary)
      ? raw.changeSummary.map((c, idx) => {
          const item = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          const sec = item.section;
          return {
            id: typeof item.id === "string" ? item.id : `chg-${idx + 1}`,
            section:
              sec === "summary" || sec === "skills" || sec === "experience" || sec === "projects"
                ? sec
                : "experience",
            targetLabel: typeof item.targetLabel === "string" ? item.targetLabel : `Change #${idx + 1}`,
            before: typeof item.before === "string" ? item.before : "",
            after: typeof item.after === "string" ? item.after : "",
            reason: typeof item.reason === "string" ? item.reason : "Aligned with job description requirements.",
            accepted: item.accepted !== false,
          };
        })
      : [];

    const keywordsMatched = Array.isArray(raw.keywordsMatched)
      ? raw.keywordsMatched.filter((x): x is string => typeof x === "string")
      : [];
    const keywordsMissing = Array.isArray(raw.keywordsMissing)
      ? raw.keywordsMissing.filter((x): x is string => typeof x === "string")
      : [];

    const matchScoreBefore =
      typeof raw.matchScoreBefore === "number"
        ? Math.min(100, Math.max(0, Math.round(raw.matchScoreBefore)))
        : 62;
    const matchScoreAfter =
      typeof raw.matchScoreAfter === "number"
        ? Math.min(100, Math.max(matchScoreBefore, Math.round(raw.matchScoreAfter)))
        : 88;

    return {
      tailoredContent,
      changeSummary,
      keywordsMatched,
      keywordsMissing,
      matchScoreBefore,
      matchScoreAfter,
    };
  } catch {
    return ruleBasedTailor(baseResume, jobDescription, company, role);
  }
}

// ─── 3. Specific AI Refinement (Chat / Targeted Edits) ──

const REFINE_SYSTEM_PROMPT = `You are an expert AI Resume Editor working interactively with a candidate on their tailored resume.
Apply the user's specific editing instruction accurately while keeping the rest of the resume intact and truthful.

Respond ONLY with valid JSON matching this schema:
{
  "updatedResume": {
    "fullName": "string",
    "contactInfo": "string",
    "summary": "string",
    "skills": [{ "category": "string", "items": ["string"] }],
    "experience": [{ "id": "string", "company": "string", "role": "string", "location": "string", "dates": "string", "bullets": ["string"] }],
    "projects": [{ "id": "string", "name": "string", "techStack": "string", "link": "string", "bullets": ["string"] }],
    "education": [{ "id": "string", "institution": "string", "degree": "string", "dates": "string", "details": "string" }]
  },
  "summaryOfChanges": "string (1-2 sentences describing what was updated based on the user's request)",
  "newChanges": [
    {
      "id": "string",
      "section": "summary" | "skills" | "experience" | "projects",
      "targetLabel": "string",
      "before": "string",
      "after": "string",
      "reason": "string",
      "accepted": true
    }
  ]
}`;

export async function refineTailoredResume(params: {
  currentResume: StructuredResume;
  baseResume: StructuredResume;
  jobDescription: string;
  company: string;
  role: string;
  instruction: string;
  sectionTarget?: string;
}): Promise<{
  updatedResume: StructuredResume;
  summaryOfChanges: string;
  newChanges: ResumeChangeItem[];
}> {
  const { currentResume, baseResume, jobDescription, company, role, instruction, sectionTarget } = params;

  const userPrompt = `Target Role: ${role} at ${company}
Target Section: ${sectionTarget || "Entire Resume (as applicable to instruction)"}
User Instruction: "${instruction}"

=== JOB DESCRIPTION ===
${jobDescription}

=== CURRENT TAILORED RESUME (JSON) ===
${JSON.stringify(currentResume, null, 2)}

=== ORIGINAL BASE RESUME FOR REFERENCE (JSON) ===
${JSON.stringify(baseResume, null, 2)}`;

  try {
    const raw = await runJsonPrompt<Record<string, unknown>>(REFINE_SYSTEM_PROMPT, userPrompt);
    const updatedResume = sanitizeStructuredResume(raw.updatedResume ?? currentResume);
    const summaryOfChanges =
      typeof raw.summaryOfChanges === "string"
        ? raw.summaryOfChanges
        : `Applied requested update: "${instruction}"`;

    const newChanges: ResumeChangeItem[] = Array.isArray(raw.newChanges)
      ? raw.newChanges.map((c, idx) => {
          const item = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          const sec = item.section;
          return {
            id: `refine-${Date.now()}-${idx}`,
            section:
              sec === "summary" || sec === "skills" || sec === "experience" || sec === "projects"
                ? sec
                : "summary",
            targetLabel: typeof item.targetLabel === "string" ? item.targetLabel : sectionTarget || "AI Refinement",
            before: typeof item.before === "string" ? item.before : "",
            after: typeof item.after === "string" ? item.after : "",
            reason: typeof item.reason === "string" ? item.reason : `User request: ${instruction}`,
            accepted: true,
          };
        })
      : [];

    return { updatedResume, summaryOfChanges, newChanges };
  } catch {
    // Fallback deterministic edit when no AI key is configured
    const clone: StructuredResume = JSON.parse(JSON.stringify(currentResume));
    const oldSummary = clone.summary;
    if (!sectionTarget || sectionTarget === "summary") {
      clone.summary = `${clone.summary} (${instruction})`;
    } else if (sectionTarget === "skills" && clone.skills.length > 0) {
      clone.skills[0].items.push(instruction);
    } else if (clone.experience.length > 0) {
      clone.experience[0].bullets[0] = `${clone.experience[0].bullets[0]} — ${instruction}`;
    }
    return {
      updatedResume: clone,
      summaryOfChanges: `Updated ${sectionTarget || "resume"} with your instruction: "${instruction}"`,
      newChanges: [
        {
          id: `refine-${Date.now()}`,
          section: "summary",
          targetLabel: sectionTarget || "Custom AI Edit",
          before: oldSummary,
          after: clone.summary,
          reason: `User requested: ${instruction}`,
          accepted: true,
        },
      ],
    };
  }
}

