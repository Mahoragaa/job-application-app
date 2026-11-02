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

// ─── PDF / DOCX / Text Extraction & Artifact Cleaner ──

/**
 * Decodes PDF octal escapes (including TeX OT1/T1 ligatures and bullets)
 * and standard PDF string escapes.
 */
export function decodePdfOctalAndEscapes(input: string): string {
  return input
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => {
      const code = parseInt(oct, 8);
      // TeX OT1 / T1 / MacRoman ligatures, dashes, and bullets
      if (code === 11 || code === 27) return "ff";
      if (code === 12 || code === 28) return "fi";
      if (code === 13 || code === 29) return "fl";
      if (code === 14 || code === 30) return "ffi";
      if (code === 15 || code === 31) return "ffl";
      if (code === 21 || code === 22 || code === 150 || code === 123) return " – ";
      if (code === 23 || code === 151 || code === 124) return " — ";
      if (code === 136 || code === 149 || code === 183) return " • ";
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return " ";
    })
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

const KNOWN_CAMEL_WORDS = new Set([
  "github", "linkedin", "gitlab", "bitbucket", "pytorch", "tensorflow",
  "fastapi", "javascript", "typescript", "postgresql", "mongodb", "mysql",
  "hsqldb", "servicenow", "smartsheet", "netsmartz", "resnet", "latex",
  "openai", "langchain", "graphql", "devops", "tailwind", "tailwindcss",
  "vscode", "numpy", "scipy", "matplotlib", "powerpoint", "sharepoint",
  "onedrive", "workday", "wellfound", "angellist", "glassdoor", "leetcode",
  "hackerrank", "springboot", "nestjs", "nextjs", "nodejs", "vuejs",
]);

/**
 * Repairs text extracted from tightly kerned or LaTeX-encoded PDFs where
 * spaces or octal escapes were collapsed.
 */
export function cleanPdfArtifacts(raw: string): string {
  let text = decodePdfOctalAndEscapes(raw);

  // Separate known section headers if glued to adjacent text
  const gluedHeaders = [
    "Professional Summary",
    "Working Experience",
    "Work Experience",
    "Professional Experience",
    "Certifications & Training",
    "Technical Skills",
    "Projects",
    "Skills",
    "Education",
    "Languages",
  ];
  for (const h of gluedHeaders) {
    const compact = h.replace(/\s+/g, "\\s*");
    text = text.replace(new RegExp(`([^\\n])(${compact})(?=\\n|[A-Z•])`, "g"), `$1\n${h}\n`);
  }

  // Insert spaces at camelCase transitions that aren't known tech brands
  text = text.replace(/([a-z]{2,})([A-Z][a-z]{2,})/g, (full, left: string, right: string) => {
    if (KNOWN_CAMEL_WORDS.has(full.toLowerCase())) return full;
    return `${left} ${right}`;
  });

  // Insert spaces around punctuation/digits glued in PDFs (careful with URLs/emails/versions)
  text = text
    .replace(/([a-zA-Z])(\()(?=[A-Za-z])/g, "$1 (")
    .replace(/(\))([A-Za-z])/g, ") $2")
    .replace(/([,:;])([A-Za-z])/g, "$1 $2")
    .replace(/([a-z])(\d{2,4}\b)/g, "$1 $2")
    .replace(/(\d%|\d\+)([a-zA-Z])/g, "$1 $2")
    .replace(/\s*•\s*/g, " • ");

  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

/**
 * Coordinate- and kerning-aware PDF text stream parser:
 * - Honors negative kerning adjustments inside `[...] TJ` arrays as word spaces
 * - Tracks `Td`, `TD`, `Tm`, and `T*` vertical/horizontal moves for accurate newlines & spaces
 * - Decodes PDF octal escapes and TeX ligatures (`\034` -> `fi`, `\050` -> `(`, `\210` -> `•`)
 */
function extractPdfTextLocal(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const lines: string[] = [];

  const parseTjArray = (arrayBody: string): string => {
    const out: string[] = [];
    const tokenRegex = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(arrayBody)) !== null) {
      const tok = m[0];
      if (tok.startsWith("(")) {
        out.push(decodePdfOctalAndEscapes(tok.slice(1, -1)));
      } else if (m[1] !== undefined) {
        const hex = m[1].replace(/\s+/g, "");
        let str = "";
        for (let i = 0; i + 1 < hex.length; i += 2) {
          const code = parseInt(hex.slice(i, i + 2), 16);
          if (code >= 32) str += String.fromCharCode(code);
        }
        out.push(str);
      } else if (m[2] !== undefined) {
        const kern = parseFloat(m[2]);
        // Negative TJ displacement <= -95 in PDF text space represents a word space
        if (kern <= -95) {
          out.push(" ");
        }
      }
    }
    return out.join("");
  };

  const extractOperators = (content: string) => {
    const btBlocks = content.match(/BT[\s\S]*?ET/g);
    if (!btBlocks) return;

    for (const block of btBlocks) {
      let currentLine = "";
      let lastY: number | null = null;

      const opRegex =
        /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]|T\*|\((?:\\.|[^\\()])*\)\s*(?:Tj|')|\[((?:\\.|[^\]])*)\]\s*TJ/g;

      let m: RegExpExecArray | null;
      while ((m = opRegex.exec(block)) !== null) {
        const full = m[0];
        if (m[6] !== undefined) {
          // Tm operator: m[5] = x, m[6] = y
          const y = parseFloat(m[6]);
          if (lastY !== null && Math.abs(y - lastY) > 2) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = "";
          } else if (currentLine && !currentLine.endsWith(" ")) {
            currentLine += " ";
          }
          lastY = y;
        } else if (m[8] !== undefined) {
          // Td / TD operator: m[7] = tx, m[8] = ty
          const tx = parseFloat(m[7]);
          const ty = parseFloat(m[8]);
          if (Math.abs(ty) > 1.5) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = "";
            if (lastY !== null) lastY += ty;
          } else if (tx > 2.5 && currentLine && !currentLine.endsWith(" ")) {
            currentLine += " ";
          }
        } else if (full === "T*") {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = "";
        } else if (m[9] !== undefined) {
          // [...] TJ array
          currentLine += parseTjArray(m[9]);
        } else if (full.startsWith("(")) {
          const isNewLineQuote = full.endsWith("'");
          const strBody = full.replace(/\)\s*(?:Tj|')$/, "").slice(1);
          if (isNewLineQuote && currentLine.trim()) {
            lines.push(currentLine.trim());
            currentLine = "";
          }
          currentLine += decodePdfOctalAndEscapes(strBody);
        }
      }

      if (currentLine.trim()) {
        lines.push(currentLine.trim());
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

  return cleanPdfArtifacts(lines.join("\n"));
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

  return { text: cleanPdfArtifacts(buffer.toString("utf8").trim()) };
}

// ─── Sanitizer & Markdown Formatter ──────────────

export function sanitizeStructuredResume(raw: unknown): StructuredResume {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const str = (v: unknown, fallback = "") =>
    typeof v === "string" ? cleanPdfArtifacts(v) : fallback;

  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? cleanPdfArtifacts(x) : "")).filter(Boolean)
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

// ─── Curated Technical & Engineering Taxonomy (No Fake Words!) ──

const SKILL_TAXONOMY: Record<string, string[]> = {
  "Languages": [
    "TypeScript", "JavaScript", "Python", "Java", "Go", "Golang", "Rust", "C++", "C#", "C",
    "SQL", "PL/SQL", "HTML", "CSS", "Bash", "Shell", "Unix", "Ruby", "PHP", "Swift", "Kotlin", "Scala", "R", "LaTeX",
  ],
  "Frontend & UI": [
    "React", "Next.js", "Vue.js", "Angular", "Svelte", "Tailwind CSS", "Redux",
    "SASS", "Webpack", "Vite", "GraphQL", "Responsive Design", "Accessibility", "Figma",
  ],
  "Backend & APIs": [
    "Node.js", "Express", "NestJS", "FastAPI", "Django", "Flask", "Spring Boot", ".NET",
    "REST API", "RESTful APIs", "gRPC", "Microservices", "WebSockets", "Prisma", "tRPC", "OAuth", "LDAP",
  ],
  "Databases & Enterprise": [
    "PostgreSQL", "MySQL", "Oracle SQL", "MongoDB", "Redis", "SQLite", "HSQLDB", "DynamoDB",
    "Elasticsearch", "Cassandra", "Snowflake", "BigQuery", "Kafka", "RabbitMQ", "Supabase", "Firebase",
    "Oracle EBS", "ServiceNow", "ERP",
  ],
  "Cloud, DevOps & AI": [
    "AWS", "GCP", "Google Cloud", "Azure", "OCI", "Oracle Cloud", "Docker", "Kubernetes",
    "Terraform", "CI/CD", "GitHub Actions", "Jenkins", "Linux", "Nginx", "Vercel",
    "Datadog", "Prometheus", "Grafana", "Machine Learning", "Deep Learning", "Computer Vision",
    "CNNs", "ResNet", "PyTorch", "TensorFlow", "Scikit-learn", "Pandas", "NumPy",
    "LLMs", "Generative AI", "AI Agents", "OpenAI", "LangChain", "RAG",
  ],
  "Engineering Practices": [
    "System Design", "Distributed Systems", "Data Structures", "Algorithms", "OOP",
    "Agile", "Scrum", "SDLC", "TDD", "Unit Testing", "Integration Testing",
    "Jest", "Cypress", "Playwright", "Performance Optimization", "Scalability",
    "Security", "Code Review", "Automation",
  ],
};

const ALL_TAXONOMY_SKILLS = Object.values(SKILL_TAXONOMY).flat();

/** Strips parenthetical metadata like `(Remote Eligible)` or `- Remote` from role titles for clean prose. */
export function cleanRoleForProse(role: string): string {
  return (
    role
      .replace(/\s*\([^)]*(?:remote|hybrid|onsite|eligible|contract|full[- ]time)[^)]*\)/gi, "")
      .replace(/\s*[-–|]\s*(?:remote|hybrid|onsite).*$/i, "")
      .trim() || role.trim()
  );
}

// ─── 1. Dynamic Local Resume Section Parser ──────

type SectionKind =
  | "header"
  | "summary"
  | "skills"
  | "experience"
  | "projects"
  | "education"
  | "certifications"
  | "ignore";

function detectSectionHeader(line: string): SectionKind | null {
  const clean = line.replace(/^[#*\-•=\s]+|[#*\-=\s:]+$/g, "").toLowerCase();
  if (clean.length > 44) return null;

  if (/^(professional\s+)?(summary|profile|objective|about\s+me)$/i.test(clean)) {
    return "summary";
  }
  if (/^(technical\s+|core\s+)?(skills|technologies|tech\s+stack|competencies)$/i.test(clean)) {
    return "skills";
  }
  if (
    /^(working\s+|work\s+|professional\s+|relevant\s+)?(experience|employment|work\s+history|career\s+history)$/i.test(
      clean
    )
  ) {
    return "experience";
  }
  if (/^(key\s+|personal\s+|academic\s+|selected\s+)?projects$/i.test(clean)) {
    return "projects";
  }
  if (/^(education|academic\s+background|qualifications)$/i.test(clean)) {
    return "education";
  }
  if (/^(certifications?(\s*&\s*training)?|licenses?\s*&?\s*certifications?)$/i.test(clean)) {
    return "certifications";
  }
  if (/^(languages|interests|hobbies)$/i.test(clean)) {
    return "ignore";
  }
  return null;
}

const DATE_RANGE_REGEX =
  /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:[-–—]|to)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|Present|Current|Now)\b/i;

export function dynamicResumeParser(inputRawText: string): StructuredResume {
  const cleanedText = cleanPdfArtifacts(inputRawText);

  const rawLines = cleanedText
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
    certifications: [],
    ignore: [],
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
  let fullName = headerLines[0]?.replace(/^#\s*/, "").trim() || "Candidate Name";
  let extraContactFromFirstLine = "";

  // Handle PDF first line where name + links were on the same line (e.g. "Raghav Arora LinkedIn • GitHub • +91...")
  const inlineContactIdx = fullName.search(/\b(LinkedIn|GitHub|https?:|\+\d|\w+@\w+)/i);
  if (inlineContactIdx > 2) {
    extraContactFromFirstLine = fullName.slice(inlineContactIdx).trim();
    fullName = fullName.slice(0, inlineContactIdx).replace(/[•|\-–]+$/, "").trim();
  }

  const contactCandidates = [
    ...(extraContactFromFirstLine ? [extraContactFromFirstLine] : []),
    ...headerLines.slice(1).filter((l) => l.length < 140),
  ];
  const contactInfo = contactCandidates
    .join(" | ")
    .replace(/\s*•\s*/g, " | ")
    .replace(/(?:\s*\|\s*)+/g, " | ")
    .trim();

  // 2. Summary
  const headerLongParagraphs = headerLines.slice(1).filter((l) => l.length >= 140);
  const summaryLines =
    sections.summary.length > 0 ? sections.summary : headerLongParagraphs;
  const summary =
    summaryLines.join(" ").trim() ||
    "Software Engineer with hands-on experience designing, building, and scaling reliable backend systems and modern web applications.";

  // 3. Skills (supports bullet-separated inline groups like "• Programming: Java, Python • Tools: Git")
  const skills: SkillGroup[] = [];
  if (sections.skills.length > 0) {
    const expandedSkillLines = sections.skills
      .join("\n")
      .split(/\n|•/)
      .map((s) => s.replace(/^[-*▪▸]\s*/, "").trim())
      .filter(Boolean);

    for (const entry of expandedSkillLines) {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 0 && colonIdx < 40) {
        const category = entry.slice(0, colonIdx).replace(/\*\*/g, "").trim();
        const items = entry
          .slice(colonIdx + 1)
          .split(/[,|;]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.length > 0) {
          skills.push({ category, items });
        }
      } else {
        const items = entry
          .split(/[,|;]/)
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

  if (skills.length === 0) {
    const lowerText = cleanedText.toLowerCase();
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
  let currentExp: ExperienceItem | null = null;

  for (const line of sections.experience) {
    const isBullet = /^[-•*▪▸]\s+/.test(line);
    const dateMatch = line.match(DATE_RANGE_REGEX);

    if (!isBullet && dateMatch) {
      if (currentExp && (currentExp.bullets.length > 0 || currentExp.company)) {
        experience.push(currentExp);
      }
      const dates = dateMatch[0];
      const beforeDate = line.slice(0, dateMatch.index).trim();
      const afterDate = line.slice((dateMatch.index || 0) + dates.length).trim();

      const headerParts = beforeDate
        .replace(/^###\s+/, "")
        .split(/\s+(?:—|–|-|\||at|@)\s+/)
        .map((p) => p.trim())
        .filter(Boolean);

      const roleTitle = headerParts[0] || "Software Engineer";
      let companyName = headerParts.slice(1).join(" - ") || "Company";
      // Deduplicate repeated company names from two-line LaTeX headers (e.g. "Infosys Infosys")
      const words = companyName.split(/\s+/);
      if (
        words.length >= 2 &&
        words[words.length - 1].toLowerCase() === words[words.length - 2].toLowerCase()
      ) {
        words.pop();
        companyName = words.join(" ");
      }

      currentExp = {
        id: `exp-${experience.length + 1}`,
        role: roleTitle,
        company: companyName,
        location: "",
        dates,
        bullets: [],
      };

      // If inline bullets were attached after the date on the same line, split them
      if (afterDate) {
        const inlineBullets = afterDate
          .split(/\s+-\s+|^-\s*/)
          .map((b) => b.trim())
          .filter((b) => b.length > 10);
        currentExp.bullets.push(...inlineBullets);
      }
    } else {
      const splitBullets = line
        .replace(/^[-•*▪▸]\s*/, "")
        .split(/\s+-\s+(?=[A-Z])/)
        .map((b) => b.trim())
        .filter((b) => b.length > 8);

      if (!currentExp) {
        currentExp = {
          id: "exp-1",
          role: "Software Engineer",
          company: "Experience",
          location: "",
          dates: "",
          bullets: [],
        };
      }
      currentExp.bullets.push(...splitBullets);
    }
  }
  if (currentExp && (currentExp.bullets.length > 0 || currentExp.company)) {
    experience.push(currentExp);
  }

  // 5. Projects
  const projects: ProjectItem[] = [];
  let currentProj: ProjectItem | null = null;
  for (const line of sections.projects) {
    const isBullet = /^[-•*▪▸]\s*/.test(line) && line.startsWith("-");
    if (!isBullet && line.length < 95) {
      if (currentProj && currentProj.bullets.length > 0) projects.push(currentProj);
      const cleanLine = line.replace(/\bGitHub\s*Repo\b/gi, "").trim();
      const parts = cleanLine
        .replace(/^###\s+/, "")
        .split(/\s*(?:\||—|–)\s*/)
        .filter(Boolean);
      currentProj = {
        id: `proj-${projects.length + 1}`,
        name: parts[0] || "Project",
        techStack: parts.slice(1).join(" · "),
        link: "",
        bullets: [],
      };
    } else {
      const bullets = line
        .replace(/^[-•*▪▸]\s*/, "")
        .split(/\s+-\s+(?=[A-Z])/)
        .map((b) => b.trim())
        .filter((b) => b.length > 10);
      if (!currentProj) {
        currentProj = {
          id: `proj-${projects.length + 1}`,
          name: "Featured Project",
          techStack: "",
          link: "",
          bullets: [],
        };
      }
      currentProj.bullets.push(...bullets);
    }
  }
  if (currentProj && currentProj.bullets.length > 0) projects.push(currentProj);

  // 6. Education
  const education: EducationItem[] = [];
  for (const line of sections.education) {
    const cleaned = line.replace(/^[-•*▪▸]\s+/, "").replace(/\*\*/g, "").trim();
    const dateMatch = cleaned.match(DATE_RANGE_REGEX) || cleaned.match(/\b(19|20)\d{2}\b/);
    const dates = dateMatch ? dateMatch[0] : "";
    const beforeDate = dateMatch ? cleaned.slice(0, dateMatch.index).trim() : cleaned;
    const afterDate = dateMatch
      ? cleaned.slice((dateMatch.index || 0) + dates.length).trim()
      : "";
    const parts = beforeDate.split(/\s*(?:—|–|-|\|)\s*/).filter(Boolean);
    if (parts.length > 0) {
      education.push({
        id: `edu-${education.length + 1}`,
        degree: parts[0],
        institution: parts[1] || "",
        dates,
        details: afterDate,
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
              category: "Core Skills",
              items: ["Software Engineering", "Backend Systems", "Web Development"],
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
  const cleanedRaw = cleanPdfArtifacts(rawText);
  try {
    const parsed = await runJsonPrompt<StructuredResume>(
      PARSE_SYSTEM_PROMPT,
      cleanedRaw
        ? `Parse this resume into structured JSON:\n\n${cleanedRaw}`
        : "Extract and parse the attached PDF resume into structured JSON.",
      inlinePdf
    );
    const structured = sanitizeStructuredResume(parsed);
    const effectiveRaw = cleanedRaw || structuredResumeToMarkdown(structured);
    return { rawText: effectiveRaw, structured };
  } catch {
    const structured = dynamicResumeParser(cleanedRaw || "Candidate Resume");
    return { rawText: cleanedRaw || structuredResumeToMarkdown(structured), structured };
  }
}

// ─── 2. Dynamic JD Analysis & Resume Tailoring Engine ──

/**
 * Strictly extracts verified engineering, cloud, data, and software keywords
 * from the Job Description (no false-positive English words like "Now").
 */
export function extractKeywordsFromJD(jd: string): string[] {
  const found: string[] = [];
  const lower = jd.toLowerCase();

  for (const skill of ALL_TAXONOMY_SKILLS) {
    // Avoid matching single-letter "C" or "R" unless clearly standalone in a tech list
    if (skill === "C" || skill === "R") {
      if (new RegExp(`(?:,\\s*|/\\s*|\\bLanguage[s]?:\\s*)${skill}(?:\\s*,|\\b)`, "i").test(jd)) {
        found.push(skill);
      }
      continue;
    }
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    if (regex.test(lower)) {
      found.push(skill);
    }
  }

  return found.slice(0, 16);
}

const WEAK_VERB_UPGRADES: Array<[RegExp, string]> = [
  [/^(Worked on|Helped with|Assisted in|Assisted with)\s+/i, "Engineered and delivered "],
  [/^(Responsible for|In charge of|Handled)\s+/i, "Owned and executed "],
  [/^(Made|Created)\s+/i, "Designed and built "],
  [/^(Used|Utilized)\s+/i, "Leveraged "],
  [/^(Participated in|Contributed to)\s+/i, "Collaborated across sprints to deliver "],
];

function upgradeBulletForJD(
  bullet: string,
  jdKeywords: string[],
  mode: TailorMode,
  bulletIndex: number
): { updated: string; changed: boolean; matchedKw: string | null } {
  let updated = bullet.trim();
  let changed = false;

  for (const [pattern, replacement] of WEAK_VERB_UPGRADES) {
    if (pattern.test(updated)) {
      updated = updated.replace(pattern, replacement);
      changed = true;
      break;
    }
  }

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
      `applying ${candidateKw} best practices for production reliability.`,
      `aligned with scalable ${candidateKw} architecture standards.`,
      `strengthening ${candidateKw} performance and maintainability.`,
    ];
    updated = `${stripped}, ${suffixes[bulletIndex % suffixes.length]}`;
    changed = true;
    return { updated, changed, matchedKw: candidateKw };
  }

  return { updated, changed, matchedKw: existingKwInBullet || candidateKw };
}

export function dynamicTailorResume(
  baseResume: StructuredResume,
  jobDescription: string,
  company: string,
  role: string,
  mode: TailorMode
): TailorResult {
  const cleanRole = cleanRoleForProse(role);
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
  const candidateAllSkills = baseResume.skills.flatMap((g) => g.items);
  const summarySkills =
    alreadyPresent.length >= 2
      ? alreadyPresent.slice(0, 4)
      : Array.from(new Set([...alreadyPresent, ...candidateAllSkills])).slice(0, 4);

  const topSkillsPhrase =
    summarySkills.length > 0
      ? summarySkills.join(", ")
      : "backend engineering, modern web frameworks, and scalable systems";

  const newSummary = `${cleanRole} with hands-on experience in ${topSkillsPhrase}. Proven track record of building reliable production systems, optimizing database and API performance, and delivering measurable engineering outcomes aligned with ${company}'s technical goals.`;

  if (newSummary.trim() !== oldSummary.trim()) {
    tailored.summary = newSummary;
    changes.push({
      id: "chg-summary",
      section: "summary",
      targetLabel: "Professional Summary",
      before: oldSummary || "(No summary provided)",
      after: newSummary,
      reason: `Positions your background directly for the ${cleanRole} role at ${company} and highlights matched skills (${topSkillsPhrase}).`,
      accepted: true,
    });
  }

  // ── 2. Reorder & Enhance Technical Skills ──
  const skillsToInject =
    mode === "conservative"
      ? []
      : mode === "balanced"
      ? initiallyMissing.slice(0, 2)
      : initiallyMissing.slice(0, 4);

  if (tailored.skills.length > 0) {
    const oldSkillsFormatted = tailored.skills
      .map((g) => `${g.category}: ${g.items.join(", ")}`)
      .join(" · ");

    for (const group of tailored.skills) {
      group.items.sort((a, b) => {
        const aInJd = jdKeywords.some((k) => k.toLowerCase() === a.toLowerCase()) ? 0 : 1;
        const bInJd = jdKeywords.some((k) => k.toLowerCase() === b.toLowerCase()) ? 0 : 1;
        return aInJd - bInJd;
      });
    }

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
      .join(" · ");

    if (oldSkillsFormatted !== newSkillsFormatted) {
      changes.push({
        id: "chg-skills",
        section: "skills",
        targetLabel: "Technical Skills",
        before: oldSkillsFormatted,
        after: newSkillsFormatted,
        reason: `Front-loads JD-matched skills in each category for rapid recruiter & ATS scanning.`,
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
          targetLabel: `${exp.role} · ${exp.company} (Bullet ${bIdx + 1})`,
          before: oldBullet,
          after: updated,
          reason: matchedKw
            ? `Connects your accomplishment to ${matchedKw} from ${company}'s requirements.`
            : "Sharpens action verbs and measurable engineering framing.",
          accepted: true,
        });
      }
    }
  });

  const finalMatched = Array.from(new Set([...alreadyPresent, ...skillsToInject]));
  const finalMissing = initiallyMissing.filter((k) => !skillsToInject.includes(k));

  const totalKw = Math.max(1, jdKeywords.length);
  const matchScoreBefore =
    jdKeywords.length === 0
      ? 68
      : Math.min(84, Math.max(45, Math.round((alreadyPresent.length / totalKw) * 100)));
  const matchScoreAfter = Math.min(
    96,
    Math.max(
      matchScoreBefore + 16,
      Math.round((finalMatched.length / totalKw) * 100) + 12
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
  const { currentResume, baseResume, company, role, instruction, sectionTarget } = params;
  const cleanRole = cleanRoleForProse(role);
  const clone: StructuredResume = JSON.parse(JSON.stringify(currentResume));
  const lowerInst = instruction.toLowerCase();
  const lowerTarget = (sectionTarget || "").toLowerCase();
  const newChanges: ResumeChangeItem[] = [];

  if (/keep.*(original|old).*summary|revert.*summary|restore.*summary/i.test(instruction)) {
    const before = clone.summary;
    clone.summary = baseResume.summary;
    newChanges.push({
      id: `refine-${Date.now()}-summary`,
      section: "summary",
      targetLabel: "Professional Summary",
      before,
      after: clone.summary,
      reason: "Restored your original base summary.",
      accepted: true,
    });
    return {
      updatedResume: clone,
      summaryOfChanges: "Restored your original Professional Summary.",
      newChanges,
    };
  }

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
            targetLabel: `${exp.role} · ${exp.company}`,
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
      summaryOfChanges: `Replaced "${fromTerm}" with "${toTerm}".`,
      newChanges,
    };
  }

  if (/shorter|concise|brief|trim|tighten/i.test(lowerInst)) {
    if (!lowerTarget || lowerTarget.includes("summary")) {
      const before = clone.summary;
      const sentences = before.split(/(?<=[.!?])\s+/);
      const conciseSummary = sentences[0] || before;
      if (conciseSummary !== before) {
        clone.summary = conciseSummary;
        newChanges.push({
          id: `refine-${Date.now()}-short-sum`,
          section: "summary",
          targetLabel: "Professional Summary",
          before,
          after: conciseSummary,
          reason: "Shortened summary to a crisp single-sentence headline.",
          accepted: true,
        });
      }
    }

    if (!lowerTarget || lowerTarget.includes("experience")) {
      for (const exp of clone.experience) {
        exp.bullets = exp.bullets.map((b, idx) => {
          const shortened = b
            .replace(/,\s+(?:applying|aligned with|strengthening)\s+[^,.]+(?:reliability|standards|maintainability)\./i, ".")
            .replace(/\s+in order to\s+/gi, " to ");
          if (shortened !== b) {
            newChanges.push({
              id: `refine-${Date.now()}-short-${exp.id}-${idx}`,
              section: "experience",
              targetLabel: `${exp.role} · ${exp.company} (Bullet ${idx + 1})`,
              before: b,
              after: shortened,
              reason: "Trimmed secondary clauses for a tighter, faster read.",
              accepted: true,
            });
          }
          return shortened;
        });
      }
    }

    return {
      updatedResume: clone,
      summaryOfChanges: "Tightened summary and bullets for brevity.",
      newChanges,
    };
  }

  if (/tone\s+down|buzzword|natural|human|simple/i.test(lowerInst)) {
    const deBuzz = (text: string) =>
      text
        .replace(/\bOwned and executed\b/g, "Led")
        .replace(/\bDesigned and built\b/g, "Built")
        .replace(/\bEngineered and delivered\b/g, "Developed")
        .replace(/\bProven track record of building\b/gi, "Experienced in building");

    const oldSum = clone.summary;
    clone.summary = deBuzz(oldSum);
    if (clone.summary !== oldSum) {
      newChanges.push({
        id: `refine-${Date.now()}-natural-sum`,
        section: "summary",
        targetLabel: "Professional Summary",
        before: oldSum,
        after: clone.summary,
        reason: "Simplified phrasing for a grounded, natural tone.",
        accepted: true,
      });
    }
    return {
      updatedResume: clone,
      summaryOfChanges: "Adjusted phrasing to a natural, understated tone.",
      newChanges,
    };
  }

  if (/metric|quantif|number|impact|data-driven/i.test(lowerInst)) {
    if (clone.experience.length > 0) {
      const exp = clone.experience[0];
      exp.bullets = exp.bullets.map((b, idx) => {
        if (/\d+%|\d+x|\$\d+|\d+\+/i.test(b) || idx > 1) return b;
        const suffix =
          idx === 0
            ? ", improving incident turnaround time by 25% across production environments."
            : ", reducing manual verification effort by 30% per release cycle.";
        const after = `${b.replace(/[.!]+$/, "")}${suffix}`;
        newChanges.push({
          id: `refine-${Date.now()}-metric-${idx}`,
          section: "experience",
          targetLabel: `${exp.role} · ${exp.company} (Bullet ${idx + 1})`,
          before: b,
          after,
          reason: "Added measurable outcome framing.",
          accepted: true,
        });
        return after;
      });
    }
    return {
      updatedResume: clone,
      summaryOfChanges: "Added quantitative impact framing to top experience bullets.",
      newChanges,
    };
  }

  const topicMatch =
    instruction.match(
      /(?:incorporate\s+my\s+experience\s+with|add|include|emphasize|highlight|focus\s+on|mention)\s+(.+?)(?:\s+into\s+.*|\s+in\s+my\s+.*|\.?$)/i
    ) || [null, instruction];

  const cleanTopic = (topicMatch[1] || instruction)
    .replace(/^(please|can you|could you|i want to)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();

  if (lowerTarget.includes("skill") && clone.skills.length > 0) {
    const group = clone.skills[0];
    const before = group.items.join(", ");
    const additions = cleanTopic.split(/,|and/).map((s) => s.trim()).filter(Boolean);
    for (const item of additions) {
      if (!group.items.some((x) => x.toLowerCase() === item.toLowerCase())) {
        group.items.unshift(item);
      }
    }
    newChanges.push({
      id: `refine-${Date.now()}-skills`,
      section: "skills",
      targetLabel: `Skills · ${group.category}`,
      before,
      after: group.items.join(", "),
      reason: `Added "${cleanTopic}" to Technical Skills.`,
      accepted: true,
    });
  } else {
    const beforeSum = clone.summary;
    clone.summary = `${beforeSum.replace(/[.!]+$/, "")}, with strong focus on ${cleanTopic} for the ${cleanRole} role at ${company}.`;
    newChanges.push({
      id: `refine-${Date.now()}-sum`,
      section: "summary",
      targetLabel: "Professional Summary",
      before: beforeSum,
      after: clone.summary,
      reason: `Highlighted "${cleanTopic}" in summary.`,
      accepted: true,
    });

    if (cleanTopic.length <= 32 && clone.skills.length > 0) {
      const group = clone.skills[0];
      if (!group.items.some((i) => i.toLowerCase() === cleanTopic.toLowerCase())) {
        const beforeSk = group.items.join(", ");
        group.items.unshift(cleanTopic);
        newChanges.push({
          id: `refine-${Date.now()}-sk`,
          section: "skills",
          targetLabel: `Skills · ${group.category}`,
          before: beforeSk,
          after: group.items.join(", "),
          reason: `Added "${cleanTopic}" to skills.`,
          accepted: true,
        });
      }
    }
  }

  return {
    updatedResume: clone,
    summaryOfChanges: `Updated ${sectionTarget || "resume"} with "${cleanTopic}".`,
    newChanges,
  };
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

  const cleanRole = cleanRoleForProse(role);
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const allSkills = resume.skills.flatMap((g) => g.items);
  const topSkills =
    keywordsMatched.length >= 3
      ? keywordsMatched.slice(0, 5)
      : Array.from(new Set([...keywordsMatched, ...allSkills])).slice(0, 5);
  const skillsPhrase =
    topSkills.length > 0
      ? topSkills.join(", ")
      : "full-stack engineering and backend systems";

  const latestExp = resume.experience[0];
  const secondExp = resume.experience[1];
  const topBullets = [
    ...(latestExp?.bullets?.slice(0, 2) || []),
    ...(secondExp?.bullets?.slice(0, 1) || []),
  ].slice(0, 3);

  const jdSentences = jobDescription
    .split(/[\r\n.!?]+/)
    .map((s) => s.replace(/^[-•*▪▸]\s*/, "").trim())
    .filter((s) => s.length > 35 && s.length < 150);
  const jdFocus =
    jdSentences.find((s) => /build|design|develop|scale|automate|engineer/i.test(s)) ||
    "building reliable, scalable software products";

  const openingByTone: Record<CoverLetterTone, string> = {
    professional: `I am writing to express my interest in the ${cleanRole} position at ${company}. With hands-on experience in ${skillsPhrase}${
      latestExp ? `, including my work as ${latestExp.role} at ${latestExp.company},` : ""
    } I am excited to contribute to your engineering team.`,
    enthusiastic: `I am thrilled to apply for the ${cleanRole} role at ${company}! Seeing ${company}'s focus on ${jdFocus.toLowerCase()}, I would love to bring my background in ${skillsPhrase} to help build and scale your platform.`,
    technical: `As an engineer experienced in production systems using ${skillsPhrase}, I am applying for the ${cleanRole} opening at ${company}. Your focus on ${jdFocus.toLowerCase()} aligns closely with my recent backend and ML engineering work.`,
  };

  const closingByTone: Record<CoverLetterTone, string> = {
    professional: `Thank you for your time and consideration. I welcome the opportunity to discuss how my engineering experience aligns with ${company}'s goals.`,
    enthusiastic: `Thank you so much for considering my application — I would love the opportunity to connect with the ${company} team!`,
    technical: `I look forward to discussing the architecture and measurable outcomes of my recent systems and how they map to ${company}'s stack.`,
  };

  const lines: string[] = [];
  lines.push(resume.fullName || "Candidate Name");
  if (resume.contactInfo) lines.push(resume.contactInfo);
  lines.push(today);
  lines.push("");
  lines.push(`Hiring Team — ${company}`);
  lines.push(`Re: ${cleanRole}`);
  lines.push("");
  lines.push(`Dear ${company} Hiring Team,`);
  lines.push("");
  lines.push(openingByTone[tone]);
  lines.push("");

  if (latestExp && topBullets.length > 0) {
    lines.push(
      `In my recent work at ${latestExp.company}, I focused on reliability, performance, and clean execution:`
    );
    for (const b of topBullets) {
      lines.push(`• ${b}`);
    }
    lines.push("");
  }

  if (resume.projects.length > 0) {
    const p = resume.projects[0];
    lines.push(
      `Additionally, I built ${p.name}${p.techStack ? ` (${p.techStack})` : ""}${
        p.bullets[0] ? ` — ${p.bullets[0]}` : "."
      }`
    );
    lines.push("");
  }

  lines.push(closingByTone[tone]);
  lines.push("");
  lines.push("Sincerely,");
  lines.push(resume.fullName || "Candidate Name");

  return lines.join("\n");
}
