import { google, gmail_v1 } from "googleapis";
import { prisma } from "./prisma";

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

  // Persist the new token
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
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

// ─── Email Fetching ──────────────────────────────

export interface EmailData {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
}

/**
 * Fetches up to `maxResults` emails within an optional date range.
 * fromDate / toDate are ISO date strings (YYYY-MM-DD).
 * If omitted, defaults to the last 6 months up to today.
 */
export async function fetchEmails(
  gmail: gmail_v1.Gmail,
  maxResults = 100,
  fromDate?: string,
  toDate?: string
): Promise<EmailData[]> {
  // Build date range for Gmail query
  const after = fromDate ? new Date(fromDate) : (() => { const d = new Date(); d.setDate(d.getDate() - 180); return d; })();
  const before = toDate ? new Date(toDate) : new Date();
  // Gmail before: is exclusive, so add 1 day so the selected "to" date is included
  const beforePlusOne = new Date(before);
  beforePlusOne.setDate(beforePlusOne.getDate() + 1);

  const fmt = (d: Date) =>
    `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

  const afterStr = fmt(after);
  const beforeStr = fmt(beforePlusOne);

  // Gmail search query that pre-filters for likely job-related emails
  const jobSearchQuery = [
    `after:${afterStr}`,
    `before:${beforeStr}`,
    `{`,
    // Application confirmations
    `subject:(application OR applied OR "thank you for applying" OR "application received" OR "application submitted")`,
    // Recruiter replies
    `subject:(interview OR "next steps" OR offer OR "move forward" OR "shortlisted" OR "selected" OR rejected OR "regret to inform" OR "unfortunately")`,
    // Common job-related from addresses
    `from:(careers OR recruiting OR talent OR hiring OR hr OR jobs OR noreply)`,
    `}`,
    // Exclude known consumer services (broad domain matching)
    `-from:uber.com -from:ubereats.com -from:zomato.com -from:swiggy.com`,
    `-from:amazon.in -from:amazon.com -from:flipkart.com -from:myntra.com`,
    `-from:paytm.com -from:phonepe.com -from:razorpay.com`,
    // Exclude course/education platforms
    `-from:internshala.com -from:coursera.org -from:udemy.com -from:edx.org`,
    `-from:upgrad.com -from:simplilearn.com -from:unacademy.com`,
    // Exclude job board noise
    `-from:linkedin.com -from:naukri.com -from:indeed.com -from:glassdoor.com`,
    `-subject:"job alert" -subject:"jobs for you" -subject:"new jobs"`,
    // Exclude OTP/transactional
    `-subject:OTP -subject:"verify your" -subject:"verification code"`,
    `-subject:"order confirmed" -subject:"order delivered" -subject:"your order"`,
  ].join(" ");

  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: jobSearchQuery,
    maxResults,
  });

  if (!data.messages || data.messages.length === 0) {
    return [];
  }

  const emails: EmailData[] = [];

  for (const msg of data.messages) {
    const { data: full } = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = full.payload?.headers || [];
    const subject =
      headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
    const from = headers.find((h) => h.name === "From")?.value || "";
    const date = headers.find((h) => h.name === "Date")?.value || "";

    emails.push({
      id: full.id!,
      threadId: full.threadId!,
      subject,
      from,
      snippet: full.snippet || "",
      date,
    });
  }

  return emails;
}

/**
 * Applies a Gmail label to a message and marks it as read.
 */
export async function applyLabelAndMarkRead(
  gmail: gmail_v1.Gmail,
  messageId: string,
  labelId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds: ["UNREAD"],
    },
  });
}
