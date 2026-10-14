import { NextResponse } from "next/server";
import type { Application, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  createGmailClient,
  ensureLabels,
  buildJobSearchQuery,
  listMessageIds,
  getMessagesMetadata,
  applyLabel,
  type EmailData,
} from "@/lib/gmail";
import { classifyEmail, type ClassificationResult } from "@/lib/ai-classifier";
import { normalizeCompany } from "@/lib/company";
import { chunk, mapWithConcurrency } from "@/lib/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds (honoured by serverless hosts)

// ─── Tunables ────────────────────────────────────
const LIST_CAP = 5000;            // max message IDs listed per sync
const MAX_PER_SYNC = 200;         // max NEW emails classified per request
const METADATA_CONCURRENCY = 10;  // parallel Gmail messages.get calls
const AI_CONCURRENCY = 5;         // parallel AI classification calls
const MAX_ERRORS_RETURNED = 10;
const MARK_AS_READ = true;        // keep existing behaviour: labelled emails are marked read
const DEFAULT_RANGE_DAYS = 180;

const UNKNOWN_COMPANY = "Unknown Company";
const UNKNOWN_ROLE = "Unknown Role";

// ─── Per-user lock (prevents overlapping manual + auto syncs) ──
const globalForSync = globalThis as unknown as { __activeSyncs?: Set<string> };
const activeSyncs = (globalForSync.__activeSyncs ??= new Set<string>());

type Outcome = "new_app" | "updated_app" | "reply" | "reply_new_app" | "not_job";

// ─── Helpers ─────────────────────────────────────

function parseRange(body: unknown): { after: number; before: number } | string {
  const nowSec = Math.floor(Date.now() / 1000);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const after = b.after === undefined ? nowSec - DEFAULT_RANGE_DAYS * 86400 : Number(b.after);
  const before = b.before === undefined ? nowSec + 86400 : Number(b.before);

  if (!Number.isFinite(after) || !Number.isFinite(before)) return "Invalid date range";
  if (after >= before) return "\"From\" must be before \"To\"";
  if (after > nowSec) return "Date range is in the future";
  return { after: Math.floor(after), before: Math.floor(before) };
}

const sameRole = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/** Fields to fill in on an existing application when we learn more about it. */
function enrichment(
  existing: Application,
  email: EmailData,
  company: string | null,
  companyKey: string,
  role: string | null
): Prisma.ApplicationUpdateInput {
  const data: Prisma.ApplicationUpdateInput = {};
  if (existing.role === UNKNOWN_ROLE && role) data.role = role;
  if (!existing.companyKey && companyKey && company) {
    data.company = company;
    data.companyKey = companyKey;
  }
  if (!existing.threadId) data.threadId = email.threadId;
  if (!existing.senderEmail) data.senderEmail = email.from;
  if (email.date < existing.appliedDate) data.appliedDate = email.date;
  return data;
}

/**
 * Writes one classified email to the DB inside a transaction.
 * The ProcessedEmail marker is written in the SAME transaction, so an email is
 * only ever marked processed if its application data was saved too.
 */
async function persistEmail(
  userId: string,
  email: EmailData,
  result: ClassificationResult
): Promise<Outcome> {
  return prisma.$transaction(async (tx) => {
    const markProcessed = () =>
      tx.processedEmail.create({ data: { userId, emailId: email.id } });

    if (!result.isJobRelated || !result.category) {
      await markProcessed();
      return "not_job";
    }

    const company = result.company;
    const companyKey = normalizeCompany(company);
    const role = result.role;

    // 1) Same Gmail thread is always the strongest signal
    let existing = await tx.application.findFirst({
      where: { userId, threadId: email.threadId },
      orderBy: { appliedDate: "asc" },
    });

    // 2) Otherwise match by normalized company (never for unknown companies)
    if (!existing && companyKey) {
      const candidates = await tx.application.findMany({
        where: { userId, companyKey },
        orderBy: { appliedDate: "desc" },
      });
      if (result.category === "applied") {
        existing =
          candidates.find((c) => sameRole(c.role, role)) ??
          (role ? null : candidates.find((c) => c.role === UNKNOWN_ROLE)) ??
          null;
      } else {
        existing = candidates.find((c) => sameRole(c.role, role)) ?? candidates[0] ?? null;
      }
    }

    let outcome: Outcome;

    if (result.category === "applied") {
      if (existing) {
        const data = enrichment(existing, email, company, companyKey, role);
        if (Object.keys(data).length > 0) {
          await tx.application.update({ where: { id: existing.id }, data });
        }
        outcome = "updated_app";
      } else {
        await tx.application.create({
          data: {
            userId,
            company: company || UNKNOWN_COMPANY,
            companyKey,
            role: role || UNKNOWN_ROLE,
            status: "applied",
            appliedDate: email.date,
            emailId: email.id,
            threadId: email.threadId,
            snippet: email.snippet,
            senderEmail: email.from,
          },
        });
        outcome = "new_app";
      }
    } else {
      const status = result.status || "reply_received";

      if (existing) {
        // Emails are processed oldest → newest, but a later sync over an older
        // range can still surface an older reply: never let it overwrite newer state.
        const isNewest = !existing.replyDate || email.date >= existing.replyDate;
        await tx.application.update({
          where: { id: existing.id },
          data: {
            ...enrichment(existing, email, company, companyKey, role),
            hasReply: true,
            ...(isNewest
              ? { replyDate: email.date, replySnippet: email.snippet, status }
              : {}),
            appliedDate: earlier(existing.appliedDate, email.date),
          },
        });
        outcome = "reply";
      } else {
        await tx.application.create({
          data: {
            userId,
            company: company || UNKNOWN_COMPANY,
            companyKey,
            role: role || UNKNOWN_ROLE,
            status,
            appliedDate: email.date,
            emailId: email.id,
            threadId: email.threadId,
            snippet: email.snippet,
            senderEmail: email.from,
            hasReply: true,
            replyDate: email.date,
            replySnippet: email.snippet,
          },
        });
        outcome = "reply_new_app";
      }
    }

    await markProcessed();
    return outcome;
  });
}

// ─── Route ───────────────────────────────────────

export async function POST(request: Request) {
  // ── 1. Authenticate ──────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // ── 2. Parse date range (epoch seconds computed in the browser's timezone)
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body — use defaults
  }
  const range = parseRange(body);
  if (typeof range === "string") {
    return NextResponse.json({ error: range }, { status: 400 });
  }

  // ── 3. One sync per user at a time ───────────
  if (activeSyncs.has(userId)) {
    return NextResponse.json(
      { error: "A sync is already in progress. Please wait for it to finish." },
      { status: 409 }
    );
  }
  activeSyncs.add(userId);

  try {
    const accessToken = await getValidAccessToken(userId);
    const gmail = createGmailClient(accessToken);

    // ── 4. Labels + message listing in parallel ──
    const query = buildJobSearchQuery(range.after, range.before);
    const [{ appliedLabelId, repliesLabelId }, { ids, truncated }] = await Promise.all([
      ensureLabels(gmail),
      listMessageIds(gmail, query, LIST_CAP),
    ]);

    // ── 5. Drop already-processed IDs with a few DB queries (no Gmail calls)
    const processedSet = new Set<string>();
    for (const part of chunk(ids, 500)) {
      const rows = await prisma.processedEmail.findMany({
        where: { userId, emailId: { in: part } },
        select: { emailId: true },
      });
      rows.forEach((r) => processedSet.add(r.emailId));
    }
    const newIds = ids.filter((id) => !processedSet.has(id));

    // Gmail lists newest first → take the OLDEST batch so state advances chronologically
    const batchIds = newIds.slice(-MAX_PER_SYNC);
    const remaining = newIds.length - batchIds.length;

    const summary = {
      totalMatched: ids.length,
      alreadyProcessed: processedSet.size,
      processed: 0,
      newApplications: 0,
      updatedApplications: 0,
      newReplies: 0,
      notJobRelated: 0,
      remaining,
      truncated,
    };

    if (batchIds.length === 0) {
      await prisma.user.update({ where: { id: userId }, data: { lastSyncAt: new Date() } });
      return NextResponse.json({
        message: ids.length === 0 ? "No matching emails in this range." : "Everything is up to date.",
        ...summary,
      });
    }

    // ── 6. Metadata for new emails only, in parallel ──
    const { emails, failed: metadataFailed } = await getMessagesMetadata(
      gmail,
      batchIds,
      METADATA_CONCURRENCY
    );
    emails.sort((a, b) => a.date.getTime() - b.date.getTime());

    // ── 7. Classify in parallel (pure — no DB writes yet) ──
    const classified = await mapWithConcurrency(emails, AI_CONCURRENCY, async (email) => {
      try {
        const result = await classifyEmail(email.subject, email.from, email.snippet, email.date);
        return { email, result, error: null as string | null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Classification failed";
        return { email, result: null, error: msg };
      }
    });

    // ── 8. Persist sequentially, oldest → newest ──
    const errors: string[] = metadataFailed.map((id) => `Could not fetch message ${id}`);
    const toLabelApplied: string[] = [];
    const toLabelReplies: string[] = [];

    for (const { email, result, error } of classified) {
      if (!result) {
        errors.push(`${email.subject}: ${error}`); // left unprocessed → retried next sync
        continue;
      }
      try {
        const outcome = await persistEmail(userId, email, result);
        summary.processed++;
        switch (outcome) {
          case "not_job":
            summary.notJobRelated++;
            break;
          case "new_app":
            summary.newApplications++;
            toLabelApplied.push(email.id);
            break;
          case "updated_app":
            summary.updatedApplications++;
            toLabelApplied.push(email.id);
            break;
          case "reply":
            summary.newReplies++;
            toLabelReplies.push(email.id);
            break;
          case "reply_new_app":
            summary.newReplies++;
            summary.newApplications++;
            toLabelReplies.push(email.id);
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error saving email ${email.id}: ${msg}`);
        errors.push(`${email.subject}: ${msg}`);
      }
    }

    // ── 9. Label in bulk (labelling is best-effort; data is already saved) ──
    const labelErrors: string[] = [];
    for (const [labelId, msgIds, name] of [
      [appliedLabelId, toLabelApplied, "Applied"],
      [repliesLabelId, toLabelReplies, "Replies"],
    ] as const) {
      if (msgIds.length === 0) continue;
      try {
        await applyLabel(gmail, labelId, [...msgIds], MARK_AS_READ);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Failed to apply ${name} label:`, msg);
        labelErrors.push(`${name} label: ${msg}`);
      }
    }

    await prisma.user.update({ where: { id: userId }, data: { lastSyncAt: new Date() } });

    return NextResponse.json({
      message: "Sync complete",
      ...summary,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors.slice(0, MAX_ERRORS_RETURNED) : undefined,
      labelErrors: labelErrors.length > 0 ? labelErrors : undefined,
    });
  } catch (error) {
    console.error("Sync failed:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeSyncs.delete(userId);
  }
}
