// ─── Company name helpers ────────────────────────
// Pure functions (no imports) so they can be reused by scripts and tests.

/** ATS / job-platform names that are never the actual hiring company. */
const PLATFORM_NAMES = new Set([
  "greenhouse", "lever", "workday", "myworkday", "myworkdayjobs", "icims",
  "ashby", "ashbyhq", "smartrecruiters", "workable", "rippling", "bamboohr",
  "recruitee", "jobvite", "taleo", "successfactors", "teamtailor", "breezy",
  "wellfound", "angellist", "linkedin", "indeed", "naukri", "glassdoor",
  "instahyre", "cutshort", "hirist", "unknown",
]);

/** Legal / geographic suffixes stripped from the END of a name only. */
const TRAILING_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "ltd", "limited", "pvt", "private",
  "corp", "corporation", "co", "company", "gmbh", "plc", "ag", "sa", "bv",
  "technologies", "technology", "labs", "group", "holdings", "india",
]);

function basicNormalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if the name refers to an ATS/job platform rather than an employer. */
export function isPlatformName(name: string | null | undefined): boolean {
  if (!name) return false;
  const tokens = basicNormalize(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  // "Greenhouse", "Workday Careers", "LinkedIn Jobs" …
  return PLATFORM_NAMES.has(tokens.join("")) || (tokens.length <= 2 && PLATFORM_NAMES.has(tokens[0]));
}

/**
 * Normalized key used to match applications from the same employer.
 * "Google India Pvt. Ltd." → "google". Returns "" when unknown / platform.
 */
export function normalizeCompany(name: string | null | undefined): string {
  if (!name) return "";
  const s = basicNormalize(name);
  if (!s || s === "unknown company") return "";
  if (isPlatformName(s)) return "";

  const tokens = s.split(" ");
  while (tokens.length > 1 && TRAILING_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Cleans a company display name; returns null if it is empty, unknown or a platform. */
export function cleanCompanyName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!trimmed || trimmed.length > 80) return null;
  return normalizeCompany(trimmed) ? trimmed : null;
}
