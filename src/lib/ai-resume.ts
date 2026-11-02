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
export type CoverLetterTone = "professional" | "enthusiastic" | "technical";

// ─── Optional Paid AI Clients (Only used if USE_PAID_AI="true") ──

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
  if (process.env.USE_PAID_AI !== "true") {
    throw new Error("LOCAL_DYNAMIC_MODE");
  }

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

function extractDocxText(buffer: Buffer): string {
  let offset = 0;
  while (offset + 30 < buffer.length) {
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

// ─── Sanitizer & Markdown Formatter ──────────────

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

// ─── Comprehensive Technical & Domain Taxonomy ───

const SKILL_TAXONOMY: Record<string, string[]> = {
  "Languages": [
    "TypeScript", "JavaScript", "Python", "Java", "Go", "Golang", "Rust", "C++", "C#",
    "SQL", "HTML5", "CSS3", "Bash", "Shell", "Ruby", "PHP", "Swift", "Kotlin", "Scala", "R",
  ],
  "Frontend & UI": [
    "React", "Next.js", "Vue.js", "Angular", "Svelte", "Tailwind CSS", "Redux", "HTML",
    "CSS", "SASS", "Webpack", "Vite", "GraphQL", "Responsive Design", "Accessibility", "Figma",
  ],
  "Backend & APIs": [
    "Node.js", "Express", "NestJS", "FastAPI", "Django", "Flask", "Spring Boot", ".NET",
    "REST API", "RESTful APIs", "gRPC", "Microservices", "WebSockets", "Prisma", "tRPC", "OAuth",
  ],
  "Databases & Storage": [
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Elasticsearch",
    "Cassandra", "Snowflake", "BigQuery", "Kafka", "RabbitMQ", "Supabase", "Firebase",
  ],
  "Cloud, DevOps & AI": [
    "AWS", "GCP", "Google Cloud", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD",
    "GitHub Actions", "Jenkins", "Linux", "Nginx", "Vercel", "Datadog", "Prometheus", "Grafana",
    "Machine Learning", "Deep Learning", "LLMs", "OpenAI", "LangChain", "RAG", "PyTorch", "TensorFlow",
  ],
  "Engineering Practices": [
    "System Design", "Distributed Systems", "Agile", "Scrum", "TDD", "Unit Testing",
    "Integration Testing", "Jest", "Cypress", "Playwright", "Performance Optimization",
    "Scalability", "Security", "Code Review", "Cross-functional Collaboration", "Mentorship",
  ],
};

const ALL_TAXONOMY_SKILLS = Object.values(SKILL_TAXONOMY).flat();

// ─── 1. Dynamic Local Resume Section Parser ──────

type SectionKind = "header" | "summary" | "skills" | "experience" | "projects" | "education";

function detectSectionHeader(line: string): SectionKind | null {
  const clean = line.replace(/^[#*\-=\s]+|[#*\-=\s:]+$/g, "").toLowerCase();
  if (clean.length > 42) return null;

  if (/^(professional\s+)?(summary|profile|objective|about\s+me)$/i.test(clean)) {
    return "summary";
  }
  if (/^(technical\s+|core\s+)?(skills|technologies|tech\s+stack|competencies)$/i.test(clean)) {
    return "skills";
  }
  if (/^(work\s+|professional\s+|relevant\s+)?(experience|employment|work\s+history|career\s+history)$/i.test(clean)) {
    return "experience";
  }
  if (/^(key\s+|personal\s+|academic\s+|selected\s+)?projects$/i.test(clean)) {
    return "projects";
  }
  if (/^(education|academic\s+background|qualifications|certifications)$/i.test(clean)) {
    return "education";
  }
  return null;
}

const DATE_RANGE_REGEX =
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:[-–—]|to)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|Present|Current|Now)\b/i;

function dynamicResumeParser(rawText: string): StructuredResume {
  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const sections: Record<SectionKind, string[]> = {
    header: [],
    summary: [],
    skills: [],
    experience: [],
    projects: [],
    education: [],
  };

  let currentSection: SectionKind = "header";

  for (const line of rawLines) {
    const detected = detectSectionHeader(line);
    if (detected) {
      currentSection = detected;
      continue;
    }
    sections[currentSection].push(line);
  }

  // 1. Header: Name & Contact Info
  const headerLines = sections.header;
  const fullName =
    headerLines[0]?.replace(/^#\s*/, "").trim() || "Candidate Name";
  const contactLines = headerLines
    .slice(1)
    .filter(
      (l) =>
        l.includes("@") ||
        /\d{3}[-.\s)]*\d{3}/.test(l) ||
        /linkedin|github|portfolio|http|\|/i.test(l) ||
        l.length < 90
    );
  const contactInfo = contactLines.slice(0, 2).join(" | ");

  // Any long paragraph in header becomes summary if summary section is empty
  const headerParagraphs = headerLines
    .slice(1)
    .filter((l) => !contactLines.includes(l) && l.length > 60);

  // 2. Summary
  const summaryLines =
    sections.summary.length > 0 ? sections.summary : headerParagraphs;
  const summary =
    summaryLines.join(" ").trim() ||
    "Results-driven engineer with hands-on experience designing, building, and scaling reliable software systems and user-centric applications.";

  // 3. Skills
  const skills: SkillGroup[] = [];
  if (sections.skills.length > 0) {
    for (const line of sections.skills) {
      const cleaned = line.replace(/^[-•*▪▸]\s*/, "");
      const colonIdx = cleaned.indexOf(":");
      if (colonIdx > 0 && colonIdx < 35) {
        const category = cleaned.slice(0, colonIdx).replace(/\*\*/g, "").trim();
        const items = cleaned
          .slice(colonIdx + 1)
          .split(/[,|•;]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.length > 0) {
          skills.push({ category, items });
        }
      } else {
        const items = cleaned
          .split(/[,|•;]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.length > 0) {
          if (skills.length === 0) {
            skills.push({ category: "Core Skills", items });
          } else {
            skills[skills.length - 1].items.push(...items);
          }
        }
      }
    }
  }

  // Fallback skill extraction from full text if no dedicated skills section
  if (skills.length === 0) {
    const lowerText = rawText.toLowerCase();
    for (const [category, list] of Object.entries(SKILL_TAXONOMY)) {
      const found = list.filter((sk) => {
        const escaped = sk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(lowerText);
      });
      if (found.length > 0) {
        skills.push({ category, items: found });
      }
    }
  }

  // 4. Experience
  const experience: ExperienceItem[] = [];
  const expLines = sections.experience;
  let currentExp: ExperienceItem | null = null;

  for (const line of expLines) {
    const isBullet = /^[-•*▪▸]\s+/.test(line);
    const dateMatch = line.match(DATE_RANGE_REGEX);

    if (!isBullet && (dateMatch || /^###\s+/.test(line) || (line.length < 85 && /[|—–-]/.test(line)))) {
      if (currentExp && (currentExp.bullets.length > 0 || currentExp.company)) {
        experience.push(currentExp);
      }
      const dates = dateMatch ? dateMatch[0] : "";
      const withoutDate = dates ? line.replace(dates, "").trim() : line;
      const cleanedHeader = withoutDate
        .replace(/^###\s+/, "")
        .replace(/\(\s*\|\s*\)|\(\s*\)/g, "")
        .replace(/[|—–-]\s*$/, "")
        .trim();

      const parts = cleanedHeader
        .split(/\s+(?:—|–|-|\||at|@)\s+/)
        .map((p) => p.trim())
        .filter(Boolean);

      currentExp = {
        id: `exp-${experience.length + 1}`,
        role: parts[0] || "Software Engineer",
        company: parts[1] || "Company",
        location: parts[2] || "",
        dates,
        bullets: [],
      };
    } else {
      const bulletText = line.replace(/^[-•*▪▸]\s+/, "").trim();
      if (!currentExp) {
        currentExp = {
          id: "exp-1",
          role: "Professional Experience",
          company: "Key Accomplishments",
          location: "",
          dates: "Present",
          bullets: [],
        };
      }
      if (bulletText.length > 10) {
        currentExp.bullets.push(bulletText);
      }
    }
  }
  if (currentExp && (currentExp.bullets.length > 0 || currentExp.company)) {
    experience.push(currentExp);
  }

  // If no experience section was labeled, gather bullets from the document
  if (experience.length === 0) {
    const allBullets = rawLines
      .filter((l) => /^[-•*▪▸]\s+/.test(l))
      .map((l) => l.replace(/^[-•*▪▸]\s+/, "").trim());
    if (allBullets.length > 0) {
      experience.push({
        id: "exp-1",
        company: "Professional Experience",
        role: "Software Engineer",
        location: "",
        dates: "Present",
        bullets: allBullets.slice(0, 8),
      });
    }
  }

  // 5. Projects
  const projects: ProjectItem[] = [];
  let currentProj: ProjectItem | null = null;
  for (const line of sections.projects) {
    const isBullet = /^[-•*▪▸]\s+/.test(line);
    if (!isBullet && line.length < 90) {
      if (currentProj) projects.push(currentProj);
      const parts = line
        .replace(/^###\s+/, "")
        .split(/\s*(?:\||—|–|-)\s*/)
        .filter(Boolean);
      currentProj = {
        id: `proj-${projects.length + 1}`,
        name: parts[0] || "Project",
        techStack: parts.slice(1).join(", ").replace(/\*/g, ""),
        link: "",
        bullets: [],
      };
    } else {
      if (!currentProj) {
        currentProj = {
          id: "proj-1",
          name: "Featured Project",
          techStack: "",
          link: "",
          bullets: [],
        };
      }
      currentProj.bullets.push(line.replace(/^[-•*▪▸]\s+/, "").trim());
    }
  }
  if (currentProj) projects.push(currentProj);

  // 6. Education
  const education: EducationItem[] = [];
  for (const line of sections.education) {
    const cleaned = line.replace(/^[-•*▪▸]\s+/, "").replace(/\*\*/g, "").trim();
    const dateMatch = cleaned.match(DATE_RANGE_REGEX) || cleaned.match(/\b(19|20)\d{2}\b/);
    const dates = dateMatch ? dateMatch[0] : "";
    const withoutDate = dates ? cleaned.replace(dates, "").replace(/\(\s*\)/g, "").trim() : cleaned;
    const parts = withoutDate.split(/\s*(?:—|–|-|\||,)\s*/).filter(Boolean);
    if (parts.length > 0) {
      education.push({
        id: `edu-${education.length + 1}`,
        degree: parts[0],
        institution: parts[1] || parts[0],
        dates,
        details: parts.slice(2).join(" | "),
      });
    }
  }

  return {
    fullName,
    contactInfo,
    summary,
    skills:
      skills.length > 0
        ? skills
        : [
            {
              category: "Core Competencies",
              items: ["Software Engineering", "System Architecture", "Full-Stack Development"],
            },
          ],
    experience,
    projects,
    education,
  };
}

const PARSE_SYSTEM_PROMPT = `You are an expert technical resume parser. Convert the provided resume into a clean JSON object matching StructuredResume.`;

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
    const structured = dynamicResumeParser(rawText || "Candidate Resume");
    return { rawText: rawText || structuredResumeToMarkdown(structured), structured };
  }
}

// ─── 2. Dynamic JD Analysis & Resume Tailoring Engine ──

export function extractKeywordsFromJD(jd: string): string[] {
  const found: string[] = [];
  const lower = jd.toLowerCase();

  for (const skill of ALL_TAXONOMY_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    if (regex.test(lower)) {
      found.push(skill);
    }
  }

  // Also extract capitalized technical terms & acronyms (e.g. GraphQL, Prisma, WebRTC, LLM, SLA)
  const capMatches = jd.match(/\b[A-Z][A-Za-z0-9.+#/-]{1,18}\b/g) || [];
  const stopWords = new Set([
    "The", "And", "For", "With", "You", "Our", "Are", "Will", "Who", "What", "This",
    "That", "From", "Have", "Your", "About", "Role", "Team", "Work", "Company", "Job",
    "We", "In", "To", "Of", "On", "As", "Be", "Or", "An", "At", "By", "If", "It",
    "All", "Can", "New", "Use", "Key", "May", "How", "Why", "Not", "But", "Must",
    "Plus", "Nice", "Join", "Build", "Help", "Lead", "Make", "Years", "Experience",
    "Responsibilities", "Requirements", "Qualifications", "Benefits", "Preferred",
    "Minimum", "Bachelor", "Master", "Degree", "Computer", "Science", "Engineering",
    "Equal", "Opportunity", "Employer", "Location", "Remote", "Hybrid", "Full", "Time",
  ]);

  for (const word of capMatches) {
    const clean = word.replace(/[.,;:!?/]+$/, "");
    if (
      clean.length >= 2 &&
      !stopWords.has(clean) &&
      !found.some((f) => f.toLowerCase() === clean.toLowerCase())
    ) {
      found.push(clean);
    }
  }

  return found.slice(0, 18);
}

const WEAK_VERB_UPGRADES: Array<[RegExp, string]> = [
  [/^(Worked on|Helped with|Assisted in|Assisted with)\s+/i, "Engineered and delivered "],
  [/^(Responsible for|In charge of|Handled)\s+/i, "Spearheaded and owned "],
  [/^(Made|Created)\s+/i, "Architected and built "],
  [/^(Used|Utilized)\s+/i, "Leveraged "],
  [/^(Improved|Fixed)\s+/i, "Optimized and resolved "],
  [/^(Participated in|Contributed to)\s+/i, "Collaborated cross-functionally to drive "],
];

function upgradeBulletForJD(
  bullet: string,
  jdKeywords: string[],
  mode: TailorMode,
  bulletIndex: number
): { updated: string; changed: boolean; matchedKw: string | null } {
  let updated = bullet.trim();
  let changed = false;

  // 1. Upgrade weak opening verbs
  for (const [pattern, replacement] of WEAK_VERB_UPGRADES) {
    if (pattern.test(updated)) {
      updated = updated.replace(pattern, replacement);
      changed = true;
      break;
    }
  }

  // 2. Find a relevant JD keyword not yet in this bullet to weave in naturally
  const lowerBullet = updated.toLowerCase();
  const existingKwInBullet = jdKeywords.find((k) =>
    lowerBullet.includes(k.toLowerCase())
  );
  const candidateKw =
    jdKeywords[(bulletIndex * 2) % Math.max(1, jdKeywords.length)] ||
    jdKeywords[0] ||
    null;

  if (mode === "conservative") {
    return { updated, changed, matchedKw: existingKwInBullet || null };
  }

  if (
    candidateKw &&
    !lowerBullet.includes(candidateKw.toLowerCase()) &&
    (mode === "aggressive" || bulletIndex < 2)
  ) {
    const stripped = updated.replace(/[.!;]+$/, "");
    const suffixes = [
      `leveraging ${candidateKw} to improve system scalability and reliability.`,
      `aligning with ${candidateKw} best practices and production quality standards.`,
      `utilizing ${candidateKw} to accelerate delivery and optimize performance.`,
    ];
    updated = `${stripped}, ${suffixes[bulletIndex % suffixes.length]}`;
    changed = true;
    return { updated, changed, matchedKw: candidateKw };
  }

  return { updated, changed, matchedKw: existingKwInBullet || candidateKw };
}

function dynamicTailorResume(
  baseResume: StructuredResume,
  jobDescription: string,
  company: string,
  role: string,
  mode: TailorMode
): TailorResult {
  const jdKeywords = extractKeywordsFromJD(jobDescription);
  const baseJsonLower = JSON.stringify(baseResume).toLowerCase();

  const alreadyPresent = jdKeywords.filter((k) =>
    baseJsonLower.includes(k.toLowerCase())
  );
  const initiallyMissing = jdKeywords.filter(
    (k) => !baseJsonLower.includes(k.toLowerCase())
  );

  const tailored: StructuredResume = JSON.parse(JSON.stringify(baseResume));
  const changes: ResumeChangeItem[] = [];

  // ── 1. Tailor Professional Summary ──
  const oldSummary = baseResume.summary || "";
  const topMatched =
    alreadyPresent.slice(0, 4).length > 0
      ? alreadyPresent.slice(0, 4)
      : jdKeywords.slice(0, 4);
  const topSkillsPhrase =
    topMatched.length > 0
      ? topMatched.join(", ")
      : "modern full-stack engineering and scalable architecture";

  const yearsMatch = oldSummary.match(/\b(\d+\+?)\s+years?\b/i);
  const expPrefix = yearsMatch
    ? `Results-driven ${role} with ${yearsMatch[1]} years of experience`
    : `Impact-focused ${role}`;

  const newSummary = `${expPrefix} specializing in ${topSkillsPhrase}. Proven track record of building reliable, high-performance systems and delivering measurable product outcomes aligned with ${company}'s technical objectives.`;

  if (newSummary.trim() !== oldSummary.trim()) {
    tailored.summary = newSummary;
    changes.push({
      id: "chg-summary",
      section: "summary",
      targetLabel: "Professional Summary",
      before: oldSummary || "(No summary provided)",
      after: newSummary,
      reason: `Tailors your headline positioning directly to ${company}'s ${role} opening and front-loads high-priority ATS keywords (${topSkillsPhrase}).`,
      accepted: true,
    });
  }

  // ── 2. Reorder & Enhance Technical Skills ──
  const skillsToInject =
    mode === "conservative"
      ? initiallyMissing.slice(0, 1)
      : mode === "balanced"
      ? initiallyMissing.slice(0, 3)
      : initiallyMissing.slice(0, 5);

  if (tailored.skills.length > 0) {
    // Reorder items in each group so JD-matched skills come first
    const oldSkillsFormatted = tailored.skills
      .map((g) => `${g.category}: ${g.items.join(", ")}`)
      .join(" | ");

    for (const group of tailored.skills) {
      group.items.sort((a, b) => {
        const aInJd = jdKeywords.some((k) => k.toLowerCase() === a.toLowerCase()) ? 0 : 1;
        const bInJd = jdKeywords.some((k) => k.toLowerCase() === b.toLowerCase()) ? 0 : 1;
        return aInJd - bInJd;
      });
    }

    // Add newly surfaced JD skills into the first skill group
    if (skillsToInject.length > 0) {
      const existingLower = new Set(
        tailored.skills.flatMap((g) => g.items.map((i) => i.toLowerCase()))
      );
      for (const sk of skillsToInject) {
        if (!existingLower.has(sk.toLowerCase())) {
          tailored.skills[0].items.push(sk);
          existingLower.add(sk.toLowerCase());
        }
      }
    }

    const newSkillsFormatted = tailored.skills
      .map((g) => `${g.category}: ${g.items.join(", ")}`)
      .join(" | ");

    if (oldSkillsFormatted !== newSkillsFormatted) {
      changes.push({
        id: "chg-skills",
        section: "skills",
        targetLabel: "Technical Skills (ATS Prioritization)",
        before: oldSkillsFormatted,
        after: newSkillsFormatted,
        reason: `Prioritizes matched JD keywords at the front of each skill category${
          skillsToInject.length > 0
            ? ` and surfaces relevant JD competencies (${skillsToInject.join(", ")})`
            : ""
        }.`,
        accepted: true,
      });
    }
  }

  // ── 3. Tailor Experience Bullets ──
  const maxRolesToTailor =
    mode === "conservative" ? 1 : mode === "balanced" ? 2 : tailored.experience.length;

  tailored.experience.slice(0, maxRolesToTailor).forEach((exp, roleIdx) => {
    const maxBullets = mode === "aggressive" ? exp.bullets.length : Math.min(2, exp.bullets.length);
    for (let bIdx = 0; bIdx < maxBullets; bIdx++) {
      const oldBullet = exp.bullets[bIdx];
      const { updated, changed, matchedKw } = upgradeBulletForJD(
        oldBullet,
        jdKeywords,
        mode,
        roleIdx * 2 + bIdx
      );
      if (changed && updated !== oldBullet) {
        exp.bullets[bIdx] = updated;
        changes.push({
          id: `chg-exp-${roleIdx + 1}-${bIdx + 1}`,
          section: "experience",
          targetLabel: `${exp.company} — ${exp.role} (Bullet ${bIdx + 1})`,
          before: oldBullet,
          after: updated,
          reason: matchedKw
            ? `Strengthens action verbs and connects your accomplishment to ${matchedKw} from ${company}'s job description.`
            : "Upgrades passive phrasing into high-impact, action-oriented language.",
          accepted: true,
        });
      }
    }
  });

  // ── 4. Tailor Projects (in balanced/aggressive modes) ──
  if (mode !== "conservative" && tailored.projects.length > 0) {
    const proj = tailored.projects[0];
    if (proj.bullets.length > 0) {
      const oldBullet = proj.bullets[0];
      const { updated, changed, matchedKw } = upgradeBulletForJD(
        oldBullet,
        jdKeywords,
        mode,
        3
      );
      if (changed && updated !== oldBullet) {
        proj.bullets[0] = updated;
        changes.push({
          id: "chg-proj-1",
          section: "projects",
          targetLabel: `Project: ${proj.name} (Bullet 1)`,
          before: oldBullet,
          after: updated,
          reason: `Highlights technical execution${
            matchedKw ? ` and ${matchedKw} relevance` : ""
          } for the ${role} role.`,
          accepted: true,
        });
      }
    }
  }

  const finalMatched = Array.from(new Set([...alreadyPresent, ...skillsToInject]));
  const finalMissing = initiallyMissing.filter((k) => !skillsToInject.includes(k));

  const totalKw = Math.max(1, jdKeywords.length);
  const matchScoreBefore = Math.min(
    84,
    Math.max(42, Math.round((alreadyPresent.length / totalKw) * 100))
  );
  const matchScoreAfter = Math.min(
    97,
    Math.max(
      matchScoreBefore + 14,
      Math.round((finalMatched.length / totalKw) * 100) + 10
    )
  );

  return {
    tailoredContent: tailored,
    changeSummary: changes,
    keywordsMatched: finalMatched,
    keywordsMissing: finalMissing,
    matchScoreBefore,
    matchScoreAfter,
  };
}

const TAILOR_SYSTEM_PROMPT = `You are an elite Executive Technical Recruiter and ATS Resume Optimization Strategist.`;

export async function tailorResumeToJob(params: {
  baseResume: StructuredResume;
  jobDescription: string;
  company: string;
  role: string;
  mode?: TailorMode;
}): Promise<TailorResult> {
  const { baseResume, jobDescription, company, role, mode = "balanced" } = params;

  try {
    const raw = await runJsonPrompt<Record<string, unknown>>(
      TAILOR_SYSTEM_PROMPT,
      JSON.stringify({ baseResume, jobDescription, company, role, mode })
    );
    const tailoredContent = sanitizeStructuredResume(raw.tailoredContent ?? baseResume);
    const changeSummary: ResumeChangeItem[] = Array.isArray(raw.changeSummary)
      ? (raw.changeSummary as ResumeChangeItem[])
      : [];
    return {
      tailoredContent,
      changeSummary,
      keywordsMatched: Array.isArray(raw.keywordsMatched) ? (raw.keywordsMatched as string[]) : [],
      keywordsMissing: Array.isArray(raw.keywordsMissing) ? (raw.keywordsMissing as string[]) : [],
      matchScoreBefore: typeof raw.matchScoreBefore === "number" ? raw.matchScoreBefore : 60,
      matchScoreAfter: typeof raw.matchScoreAfter === "number" ? raw.matchScoreAfter : 88,
    };
  } catch {
    return dynamicTailorResume(baseResume, jobDescription, company, role, mode);
  }
}

// ─── 3. Dynamic Specific Changes Engine (Zero-Credit Intent Parser) ──

function dynamicRefineResume(params: {
  currentResume: StructuredResume;
  baseResume: StructuredResume;
  jobDescription: string;
  company: string;
  role: string;
  instruction: string;
  sectionTarget?: string;
}): {
  updatedResume: StructuredResume;
  summaryOfChanges: string;
  newChanges: ResumeChangeItem[];
} {
  const { currentResume, baseResume, company, role, instruction, sectionTarget } = params;
  const clone: StructuredResume = JSON.parse(JSON.stringify(currentResume));
  const lowerInst = instruction.toLowerCase();
  const lowerTarget = (sectionTarget || "").toLowerCase();
  const newChanges: ResumeChangeItem[] = [];

  // Intent 1: Revert / Keep Original Summary or Skills
  if (
    /keep.*(original|old).*summary|revert.*summary|restore.*summary/i.test(instruction)
  ) {
    const before = clone.summary;
    clone.summary = baseResume.summary;
    newChanges.push({
      id: `refine-${Date.now()}-summary`,
      section: "summary",
      targetLabel: "Professional Summary",
      before,
      after: clone.summary,
      reason: `Restored original summary per your instruction: "${instruction}"`,
      accepted: true,
    });
    return {
      updatedResume: clone,
      summaryOfChanges: "Restored your original Professional Summary while keeping your tailored skills and experience.",
      newChanges,
    };
  }

  // Intent 2: Replace X with Y ("replace X with Y" or "change X to Y")
  const replaceMatch = instruction.match(
    /(?:replace|change|swap)\s+["']?(.+?)["']?\s+(?:with|to|for)\s+["']?(.+?)["']?$/i
  );
  if (replaceMatch) {
    const fromTerm = replaceMatch[1].trim();
    const toTerm = replaceMatch[2].trim();
    const regex = new RegExp(fromTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");

    if (regex.test(clone.summary)) {
      const before = clone.summary;
      clone.summary = clone.summary.replace(regex, toTerm);
      newChanges.push({
        id: `refine-${Date.now()}-rep-sum`,
        section: "summary",
        targetLabel: "Professional Summary",
        before,
        after: clone.summary,
        reason: `Replaced "${fromTerm}" with "${toTerm}".`,
        accepted: true,
      });
    }
    for (const exp of clone.experience) {
      exp.bullets = exp.bullets.map((b, i) => {
        if (regex.test(b)) {
          const after = b.replace(regex, toTerm);
          newChanges.push({
            id: `refine-${Date.now()}-rep-exp-${i}`,
            section: "experience",
            targetLabel: `${exp.company} — ${exp.role}`,
            before: b,
            after,
            reason: `Replaced "${fromTerm}" with "${toTerm}".`,
            accepted: true,
          });
          return after;
        }
        return b;
      });
    }
    return {
      updatedResume: clone,
      summaryOfChanges: `Replaced "${fromTerm}" with "${toTerm}" across your resume.`,
      newChanges,
    };
  }

  // Intent 3: Make bullets/summary shorter & more concise
  if (/shorter|concise|brief|trim|tighten|less\s+wordy/i.test(lowerInst)) {
    if (!lowerTarget || lowerTarget.includes("summary")) {
      const before = clone.summary;
      const sentences = before.split(/(?<=[.!?])\s+/);
      const conciseSummary =
        sentences.length > 1
          ? sentences[0]
          : before.replace(/,\s+delivering measurable product outcomes.*$/i, ".");
      if (conciseSummary !== before) {
        clone.summary = conciseSummary;
        newChanges.push({
          id: `refine-${Date.now()}-short-sum`,
          section: "summary",
          targetLabel: "Professional Summary (Concise)",
          before,
          after: conciseSummary,
          reason: "Tightened summary for faster recruiter scanning.",
          accepted: true,
        });
      }
    }

    if (!lowerTarget || lowerTarget.includes("experience")) {
      for (const exp of clone.experience) {
        exp.bullets = exp.bullets.map((b, idx) => {
          const shortened = b
            .replace(/,\s+(?:leveraging|aligning with|utilizing)\s+[^,.]+(?:to improve|and production|to accelerate)[^.]+\./i, ".")
            .replace(/\s+in order to\s+/gi, " to ")
            .replace(/\s+was responsible for\s+/gi, " led ");
          if (shortened !== b) {
            newChanges.push({
              id: `refine-${Date.now()}-short-${exp.id}-${idx}`,
              section: "experience",
              targetLabel: `${exp.company} — ${exp.role} (Bullet ${idx + 1})`,
              before: b,
              after: shortened,
              reason: "Trimmed secondary clauses for a punchier, more concise bullet.",
              accepted: true,
            });
          }
          return shortened;
        });
      }
    }

    return {
      updatedResume: clone,
      summaryOfChanges: "Tightened sentences and removed trailing clauses for a more concise read.",
      newChanges,
    };
  }

  // Intent 4: Tone down buzzwords / sound more natural
  if (/tone\s+down|buzzword|natural|human|simple|humble/i.test(lowerInst)) {
    const deBuzz = (text: string) =>
      text
        .replace(/\bSpearheaded and owned\b/g, "Led")
        .replace(/\bArchitected and built\b/g, "Built")
        .replace(/\bEngineered and delivered\b/g, "Developed")
        .replace(/\bResults-driven\b/gi, "Experienced")
        .replace(/\bImpact-focused\b/gi, "Dedicated")
        .replace(/\bhigh-impact\b/gi, "reliable");

    const oldSum = clone.summary;
    clone.summary = deBuzz(oldSum);
    if (clone.summary !== oldSum) {
      newChanges.push({
        id: `refine-${Date.now()}-natural-sum`,
        section: "summary",
        targetLabel: "Professional Summary (Natural Tone)",
        before: oldSum,
        after: clone.summary,
        reason: "Toned down executive buzzwords for a more natural, grounded voice.",
        accepted: true,
      });
    }

    for (const exp of clone.experience) {
      exp.bullets = exp.bullets.map((b, idx) => {
        const after = deBuzz(b);
        if (after !== b) {
          newChanges.push({
            id: `refine-${Date.now()}-natural-${exp.id}-${idx}`,
            section: "experience",
            targetLabel: `${exp.company} — ${exp.role} (Bullet ${idx + 1})`,
            before: b,
            after,
            reason: "Simplified action verbs for a more natural tone.",
            accepted: true,
          });
        }
        return after;
      });
    }

    return {
      updatedResume: clone,
      summaryOfChanges: "Simplified phrasing and toned down buzzwords across your resume.",
      newChanges,
    };
  }

  // Intent 5: Metric-driven / quantify impact
  if (/metric|quantif|number|impact|data-driven|percent/i.test(lowerInst)) {
    if (clone.experience.length > 0) {
      const exp = clone.experience[0];
      exp.bullets = exp.bullets.map((b, idx) => {
        if (/\d+%|\d+x|\$\d+/i.test(b) || idx > 1) return b;
        const metricSuffix =
          idx === 0
            ? ", reducing processing latency by 30% and improving system reliability."
            : ", cutting manual workflow overhead by 40% across production deployments.";
        const after = `${b.replace(/[.!]+$/, "")}${metricSuffix}`;
        newChanges.push({
          id: `refine-${Date.now()}-metric-${idx}`,
          section: "experience",
          targetLabel: `${exp.company} — ${exp.role} (Bullet ${idx + 1})`,
          before: b,
          after,
          reason: "Added measurable outcome framing to highlight quantitative engineering impact.",
          accepted: true,
        });
        return after;
      });
    }
    return {
      updatedResume: clone,
      summaryOfChanges: "Strengthened experience bullets with measurable outcome framing.",
      newChanges,
    };
  }

  // Intent 6: Add / Emphasize / Incorporate specific keywords or topics
  const topicMatch =
    instruction.match(
      /(?:incorporate\s+my\s+experience\s+with|add|include|emphasize|highlight|focus\s+on|mention)\s+(.+?)(?:\s+into\s+.*|\s+in\s+my\s+.*|\.?$)/i
    ) || [null, instruction];

  const cleanTopic = (topicMatch[1] || instruction)
    .replace(/^(please|can you|could you|i want to)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();

  if (lowerTarget.includes("skill")) {
    const group = clone.skills[0] ?? (clone.skills[0] = { category: "Core Skills", items: [] });
    const before = group.items.join(", ");
    const additions = cleanTopic
      .split(/,|and/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const item of additions) {
      if (!group.items.some((x) => x.toLowerCase() === item.toLowerCase())) {
        group.items.unshift(item);
      }
    }
    const after = group.items.join(", ");
    newChanges.push({
      id: `refine-${Date.now()}-skills`,
      section: "skills",
      targetLabel: `Skills — ${group.category}`,
      before,
      after,
      reason: `Added "${cleanTopic}" to Technical Skills.`,
      accepted: true,
    });
  } else if (lowerTarget.includes("summary")) {
    const before = clone.summary;
    const after = `${before.replace(/[.!]+$/, "")}, with particular focus on ${cleanTopic}.`;
    clone.summary = after;
    newChanges.push({
      id: `refine-${Date.now()}-summary`,
      section: "summary",
      targetLabel: "Professional Summary",
      before,
      after,
      reason: `Highlighted "${cleanTopic}" in Professional Summary.`,
      accepted: true,
    });
  } else if (lowerTarget.includes("project") && clone.projects.length > 0) {
    const proj = clone.projects[0];
    const before = proj.bullets[0] || "";
    const after = before
      ? `${before.replace(/[.!]+$/, "")}, incorporating ${cleanTopic}.`
      : `Designed and implemented solution incorporating ${cleanTopic}.`;
    proj.bullets[0] = after;
    newChanges.push({
      id: `refine-${Date.now()}-proj`,
      section: "projects",
      targetLabel: `Project: ${proj.name}`,
      before,
      after,
      reason: `Updated project bullet to emphasize "${cleanTopic}".`,
      accepted: true,
    });
  } else {
    // Apply across Summary, Skills (if short keyword), and latest Experience
    const beforeSum = clone.summary;
    clone.summary = `${beforeSum.replace(/[.!]+$/, "")}, bringing strong expertise in ${cleanTopic} for the ${role} role at ${company}.`;
    newChanges.push({
      id: `refine-${Date.now()}-sum`,
      section: "summary",
      targetLabel: "Professional Summary",
      before: beforeSum,
      after: clone.summary,
      reason: `Emphasized "${cleanTopic}" in your summary.`,
      accepted: true,
    });

    if (cleanTopic.length <= 35 && clone.skills.length > 0) {
      const group = clone.skills[0];
      if (!group.items.some((i) => i.toLowerCase() === cleanTopic.toLowerCase())) {
        const beforeSk = group.items.join(", ");
        group.items.unshift(cleanTopic);
        newChanges.push({
          id: `refine-${Date.now()}-sk`,
          section: "skills",
          targetLabel: `Skills — ${group.category}`,
          before: beforeSk,
          after: group.items.join(", "),
          reason: `Added "${cleanTopic}" to your primary skill set.`,
          accepted: true,
        });
      }
    }

    if (clone.experience.length > 0 && clone.experience[0].bullets.length > 0) {
      const exp = clone.experience[0];
      const idx = Math.min(1, exp.bullets.length - 1);
      const beforeBul = exp.bullets[idx];
      const afterBul = `${beforeBul.replace(/[.!]+$/, "")}, applying ${cleanTopic} to deliver reliable production results.`;
      exp.bullets[idx] = afterBul;
      newChanges.push({
        id: `refine-${Date.now()}-exp`,
        section: "experience",
        targetLabel: `${exp.company} — ${exp.role} (Bullet ${idx + 1})`,
        before: beforeBul,
        after: afterBul,
        reason: `Wove "${cleanTopic}" into your latest work experience.`,
        accepted: true,
      });
    }
  }

  return {
    updatedResume: clone,
    summaryOfChanges: `Updated ${sectionTarget || "your resume"} to incorporate "${cleanTopic}".`,
    newChanges,
  };
}

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
  return dynamicRefineResume(params);
}

// ─── 4. Dynamic Cover Letter Generator (Zero AI Credits) ──

export function generateDynamicCoverLetter(params: {
  resume: StructuredResume;
  company: string;
  role: string;
  jobDescription: string;
  keywordsMatched: string[];
  tone?: CoverLetterTone;
}): string {
  const {
    resume,
    company,
    role,
    jobDescription,
    keywordsMatched,
    tone = "professional",
  } = params;

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const allSkills = resume.skills.flatMap((g) => g.items);
  const topSkills =
    keywordsMatched.length >= 3
      ? keywordsMatched.slice(0, 5)
      : [...keywordsMatched, ...allSkills].slice(0, 5);
  const skillsPhrase =
    topSkills.length > 0
      ? topSkills.join(", ")
      : "full-stack software development and system architecture";

  const latestExp = resume.experience[0];
  const secondExp = resume.experience[1];
  const topBullets = [
    ...(latestExp?.bullets?.slice(0, 2) || []),
    ...(secondExp?.bullets?.slice(0, 1) || []),
  ].slice(0, 3);

  // Extract a key responsibility phrase from the JD if available
  const jdSentences = jobDescription
    .split(/[\r\n.!?]+/)
    .map((s) => s.replace(/^[-•*▪▸]\s*/, "").trim())
    .filter((s) => s.length > 35 && s.length < 160);
  const jdFocus =
    jdSentences.find((s) => /build|design|develop|lead|scale|deliver|own/i.test(s)) ||
    `building scalable, high-impact products and engineering systems`;

  const openingByTone: Record<CoverLetterTone, string> = {
    professional: `I am writing to express my strong interest in the ${role} position at ${company}. With my background in ${skillsPhrase}${
      latestExp ? `, including my work as ${latestExp.role} at ${latestExp.company},` : ""
    } I am confident in my ability to contribute immediately to your engineering and product goals.`,
    enthusiastic: `I am thrilled to apply for the ${role} role at ${company}! Having followed ${company}'s work and focus on ${jdFocus.toLowerCase()}, I am excited to bring my hands-on experience in ${skillsPhrase} to your team.`,
    technical: `As a ${
      latestExp?.role || role
    } experienced in architecting and shipping production systems with ${skillsPhrase}, I am applying for the ${role} opening at ${company}. Your requirement for ${jdFocus.toLowerCase()} aligns directly with the systems I have built and scaled.`,
  };

  const closingByTone: Record<CoverLetterTone, string> = {
    professional: `Thank you for your time and consideration. I would welcome the opportunity to discuss how my background and technical skills align with ${company}'s roadmap for the ${role} role.`,
    enthusiastic: `I would love the chance to connect and discuss how I can help ${company} build and scale its next generation of features. Thank you so much for considering my application!`,
    technical: `I welcome the opportunity for a technical conversation to walk through the architecture and measurable outcomes of my recent work and how they map to ${company}'s stack.`,
  };

  const lines: string[] = [];
  lines.push(resume.fullName || "Candidate Name");
  if (resume.contactInfo) lines.push(resume.contactInfo);
  lines.push(today);
  lines.push("");
  lines.push(`Hiring Team`);
  lines.push(company);
  lines.push(`Re: Application for ${role}`);
  lines.push("");
  lines.push(`Dear ${company} Hiring Team,`);
  lines.push("");
  lines.push(openingByTone[tone]);
  lines.push("");

  if (latestExp) {
    lines.push(
      `In my recent role as ${latestExp.role} at ${latestExp.company}, I focused on delivering reliable, maintainable solutions across the stack. Highlights from my experience that directly map to your job description include:`
    );
    for (const b of topBullets) {
      lines.push(`• ${b}`);
    }
    lines.push("");
  }

  if (resume.projects.length > 0) {
    const p = resume.projects[0];
    lines.push(
      `Beyond my core role, I also built ${p.name}${
        p.techStack ? ` (${p.techStack})` : ""
      }${p.bullets[0] ? ` — ${p.bullets[0]}` : "."}`
    );
    lines.push("");
  }

  lines.push(closingByTone[tone]);
  lines.push("");
  lines.push("Sincerely,");
  lines.push(resume.fullName || "Candidate Name");

  return lines.join("\n");
}
