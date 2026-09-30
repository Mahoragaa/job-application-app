import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  createGmailClient,
  ensureLabels,
  fetchEmails,
  applyLabelAndMarkRead,
} from "@/lib/gmail";
import { classifyEmail } from "@/lib/ai-classifier";

export async function POST(request: Request) {
  try {
    // Parse optional date range from body
    let fromDate: string | undefined;
    let toDate: string | undefined;
    try {
      const body = await request.json();
      fromDate = body.fromDate;
      toDate = body.toDate;
    } catch {
      // No body or invalid JSON — use defaults
    }

    // ── 1. Authenticate ──────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // ── 2. Get a valid access token (refresh if needed)
    const accessToken = await getValidAccessToken(userId);

    // ── 3. Create Gmail client ───────────────────
    const gmail = createGmailClient(accessToken);

    // ── 4. Ensure labels exist ───────────────────
    const { appliedLabelId, repliesLabelId } = await ensureLabels(gmail);

    // ── 5. Fetch emails in the given date range ──
    const emails = await fetchEmails(gmail, 100, fromDate, toDate);

    if (emails.length === 0) {
      return NextResponse.json({
        message: "No unread emails found.",
        processed: 0,
        newApplications: 0,
        newReplies: 0,
      });
    }

    // ── 6. Process each email ────────────────────
    let newApplications = 0;
    let newReplies = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const email of emails) {
      try {
        // Check if already processed
        const alreadyProcessed = await prisma.processedEmail.findUnique({
          where: {
            userId_emailId: { userId, emailId: email.id },
          },
        });

        if (alreadyProcessed) {
          skipped++;
          continue;
        }

        // Classify with AI
        const classification = await classifyEmail(
          email.subject,
          email.from,
          email.snippet
        );

        // Mark as processed regardless of job-relatedness
        await prisma.processedEmail.create({
          data: { userId, emailId: email.id },
        });

        if (!classification.isJobRelated) {
          skipped++;
          continue;
        }

        const company = classification.company || "Unknown Company";
        const role = classification.role || "Unknown Role";
        const status = classification.status || "applied";

        if (classification.category === "applied") {
          // ── New Application ──────────────────
          // Check for existing application by threadId or company+role
          const existing = await prisma.application.findFirst({
            where: {
              userId,
              OR: [
                { threadId: email.threadId },
                { company: { equals: company }, role: { equals: role } },
              ],
            },
          });

          if (!existing) {
            await prisma.application.create({
              data: {
                userId,
                company,
                role,
                status: "applied",
                appliedDate: new Date(email.date),
                emailId: email.id,
                threadId: email.threadId,
                snippet: email.snippet,
                senderEmail: email.from,
              },
            });
            newApplications++;
          }

          // Apply Gmail label
          await applyLabelAndMarkRead(gmail, email.id, appliedLabelId);
        } else if (classification.category === "reply") {
          // ── Reply to Existing Application ────
          // Try to find the original application
          const existingApp = await prisma.application.findFirst({
            where: {
              userId,
              OR: [
                { threadId: email.threadId },
                { company: { equals: company } },
              ],
            },
          });

          if (existingApp) {
            // Update existing application with reply info
            await prisma.application.update({
              where: { id: existingApp.id },
              data: {
                hasReply: true,
                replyDate: new Date(email.date),
                replySnippet: email.snippet,
                status,
              },
            });
            newReplies++;
          } else {
            // No matching application — create one with reply
            await prisma.application.create({
              data: {
                userId,
                company,
                role,
                status,
                appliedDate: new Date(email.date),
                emailId: email.id,
                threadId: email.threadId,
                snippet: email.snippet,
                senderEmail: email.from,
                hasReply: true,
                replyDate: new Date(email.date),
                replySnippet: email.snippet,
              },
            });
            newReplies++;
            newApplications++;
          }

          // Apply Gmail label
          await applyLabelAndMarkRead(gmail, email.id, repliesLabelId);
        }
      } catch (emailError) {
        const errMsg =
          emailError instanceof Error ? emailError.message : "Unknown error";
        console.error(
          `Error processing email ${email.id}: ${errMsg}`
        );
        errors.push(`${email.subject}: ${errMsg}`);
      }
    }

    return NextResponse.json({
      message: "Sync complete",
      processed: emails.length - skipped,
      newApplications,
      newReplies,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Sync failed:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
