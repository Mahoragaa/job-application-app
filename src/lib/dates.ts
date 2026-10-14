// ─── Timezone-safe date helpers ──────────────────
// All "YYYY-MM-DD" strings here are LOCAL calendar dates (never UTC).

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DD" using local date parts (no UTC shift). */
export function toLocalISODate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" → local-midnight Date, or null if invalid (e.g. 2026-02-31). */
export function parseLocalISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** Local "YYYY-MM-DD" for N days before today. */
export function localISODateDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return toLocalISODate(d);
}

/**
 * Converts an inclusive local date range into Gmail-friendly epoch seconds.
 * `before` is the start of the day AFTER `to`, so the whole `to` day is included.
 */
export function dayRangeToEpoch(
  from: string,
  to: string
): { after: number; before: number } | null {
  const start = parseLocalISODate(from);
  const end = parseLocalISODate(to);
  if (!start || !end || start > end) return null;
  const dayAfterEnd = new Date(end);
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
  return {
    after: Math.floor(start.getTime() / 1000),
    before: Math.floor(dayAfterEnd.getTime() / 1000),
  };
}

/** Strict "DD/MM/YYYY" → "YYYY-MM-DD". Returns "" if invalid. */
export function parseDDMMYYYY(input: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return parseLocalISODate(iso) ? iso : "";
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" for display. */
export function isoToDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Formats raw text typed into a DD/MM/YYYY box.
 * Slashes are auto-inserted only while the text is GROWING, so backspace works.
 */
export function autoFormatDateInput(prev: string, next: string): string {
  const cleaned = next.replace(/[^\d/]/g, "").slice(0, 10);
  const growing = cleaned.length > prev.length;
  if (growing && (/^\d{2}$/.test(cleaned) || /^\d{2}\/\d{2}$/.test(cleaned))) {
    return cleaned + "/";
  }
  return cleaned;
}

/** Validates an inclusive local date range. Returns an error message or null. */
export function validateDateRange(from: string, to: string, today = toLocalISODate()): string | null {
  if (!parseLocalISODate(from) || !parseLocalISODate(to)) return "Pick a valid date range";
  if (from > to) return "\"From\" must be on or before \"To\"";
  if (to > today) return "\"To\" can't be in the future";
  return null;
}
