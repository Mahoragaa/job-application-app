import { google, gmail_v1 } from "googleapis";
import { prisma } from "./prisma";
import { chunk, mapWithConcurrency } from "./concurrency";
import {
  ATS_SENDER_DOMAINS,
  EXCLUDED_LINKEDIN_SENDERS,
  EXCLUDED_SENDER_DOMAINS,
} from "./senders";

// ─── Token Management ────────────────────────────

/**
 * Retrieves a valid Google access token for the given user.
 * Automatically refreshes expired tokens using the stored refresh_token.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account) {
    throw new Error("No Google account linked. Please sign in again.");
  }

  // Check if token is still valid (with 5-minute buffer)
  const bufferMs = 5 * 60 * 1000;
  const isExpired =
    account.expires_at && account.expires_at * 1000 < Date.now() + bufferMs;

  if (!isExpired && account.access_token) {
    return account.access_token;
  }

  // Token is expired — refresh it
  if (!account.refresh_token) {
    throw new Error(
      "No refresh token available. Please sign out and sign in again."
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  // Persist the new token (Google occasionally rotates the refresh token too)
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    },
  });

  return data.access_token;
}

// ─── Gmail Client ────────────────────────────────

/**
 * Creates an authenticated Gmail API client from an access token.
 */
export function createGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

// ─── Label Management ────────────────────────────

const LABEL_APPLIED = "Job Search/Applied";
const LABEL_REPLIES = "Job Search/Replies";

interface LabelIds {
  appliedLabelId: string;
  repliesLabelId: string;
}

/**
 * Ensures the two job-search labels exist in the user's Gmail.
 * Creates any that are missing and returns their IDs.
 */
export async function ensureLabels(
  gmail: gmail_v1.Gmail
): Promise<LabelIds> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existingLabels = data.labels || [];

  let appliedLabelId = existingLabels.find(
    (l) => l.name === LABEL_APPLIED
  )?.id;
  let repliesLabelId = existingLabels.find(
    (l) => l.name === LABEL_REPLIES
  )?.id;

  if (!appliedLabelId) {
    const res = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: LABEL_APPLIED,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    appliedLabelId = res.data.id!;
    console.log(`✓ Created Gmail label: ${LABEL_APPLIED}`);
  }

  if (!repliesLabelId) {
    const res = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: LABEL_REPLIES,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    repliesLabelId = res.data.id!;
    console.log(`✓ Created Gmail label: ${LABEL_REPLIES}`);
  }

  return { appliedLabelId, repliesLabelId };
}

// ─── Search Query ────────────────────────────────

/**
 * Builds the Gmail search query. `after`/`before` are epoch SECONDS,
 * which Gmail interprets unambiguously (no timezone guessing).
 */
export function buildJobSearchQuery(after: number, before: number): string {
  return [
    `after:${after}`,
    `before:${before}`,
    `{`,
    // Application confirmations
    `subject:(application OR applied OR applying OR candidacy OR candidature OR "thank you for applying" OR "application received" OR "application submitted")`,
    // Recruiter replies
    `subject:(interview OR "next steps" OR offer OR "move forward" OR "shortlisted" OR "selected" OR rejected OR "regret to inform" OR "unfortunately")`,
    // Recruiting teams + ATS platforms
    `from:(careers OR recruiting OR recruitment OR talent OR hiring OR hr OR jobs)`,
    `from:(${ATS_SENDER_DOMAINS.join(" OR ")})`,
    `}`,
    EXCLUDED_SENDER_DOMAINS.map((d) => `-from:${d}`).join(" "),
    EXCLUDED_LINKEDIN_SENDERS.map((d) => `-from:${d}`).join(" "),
    // Job board noise
    `-subject:"job alert" -subject:"jobs for you" -subject:"new jobs" -subject:"is hiring"`,
    // OTP / transactional
    `-subject:OTP -subject:"verify your" -subject:"verification code"`,
    `-subject:"order confirmed" -subject:"order delivered" -subject:"your order"`,
  ].join(" ");
}

// ─── Email Fetching ──────────────────────────────

export interface EmailData {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  /** Gmail internalDate — always present, unlike the Date header. */
  date: Date;
}

/**
 * Lists message IDs matching `q`, following pagination up to `cap` IDs.
 * Gmail returns newest first.
 */
export async function listMessageIds(
  gmail: gmail_v1.Gmail,
  q: string,
  cap = 5000
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(500, cap - ids.length),
      pageToken,
    });
    for (const m of data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < cap);

  return { ids, truncated: Boolean(pageToken) };
}

/** Decodes the HTML entities Gmail leaves in snippets (&#39; &amp; …). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Fetches Subject/From/snippet/internalDate for the given IDs,
 * `concurrency` requests at a time. Failed IDs are returned separately.
 */
export async function getMessagesMetadata(
  gmail: gmail_v1.Gmail,
  ids: string[],
  concurrency = 10
): Promise<{ emails: EmailData[]; failed: string[] }> {
  const failed: string[] = [];

  const results = await mapWithConcurrency(ids, concurrency, async (id) => {
    try {
      const { data: full } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });

      const headers = full.payload?.headers || [];
      const header = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      let date = new Date(Number(full.internalDate));
      if (isNaN(date.getTime())) date = new Date(header("Date"));
      if (isNaN(date.getTime())) date = new Date();

      const email: EmailData = {
        id: full.id || id,
        threadId: full.threadId || id,
        subject: header("Subject") || "(No Subject)",
        from: header("From"),
        snippet: decodeEntities(full.snippet || ""),
        date,
      };
      return email;
    } catch (err) {
      console.error(`Failed to fetch message ${id}:`, err instanceof Error ? err.message : err);
      failed.push(id);
      return null;
    }
  });

  return { emails: results.filter((e): e is EmailData => e !== null), failed };
}

/**
 * Applies a Gmail label (and optionally marks as read) to many messages using
 * batchModify — one API call per 1000 messages instead of one per message.
 */
export async function applyLabel(
  gmail: gmail_v1.Gmail,
  labelId: string,
  messageIds: string[],
  markRead = true
): Promise<void> {
  for (const ids of chunk(messageIds, 1000)) {
    await gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids,
        addLabelIds: [labelId],
        removeLabelIds: markRead ? ["UNREAD"] : [],
      },
    });
  }
}
