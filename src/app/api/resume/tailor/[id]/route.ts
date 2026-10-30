import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  refineTailoredResume,
  sanitizeStructuredResume,
  type ResumeChangeItem,
  type RevisionHistoryEntry,
  type StructuredResume,
} from "@/lib/ai-resume";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function safeJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function serializeRecord(record: {
  id: string;
  userId: string;
  baseResumeId: string;
  applicationId: string | null;
  company: string;
  role: string;
  jobDescription: string;
  tailorMode: string;
  originalContent: string;
  tailoredContent: string;
  changeSummary: string;
  keywordsMatched: string;
  keywordsMissing: string;
  matchScoreBefore: number;
  matchScoreAfter: number;
  status: string;
  revisionHistory: string;
  createdAt: Date;
  updatedAt: Date;
  baseResume?: { id: string; title: string; fileName: string | null };
  application?: { id: string; company: string; role: string; status: string } | null;
}) {
  return {
    ...record,
    originalContent: safeJson<StructuredResume>(
      record.originalContent,
      sanitizeStructuredResume({})
    ),
    tailoredContent: safeJson<StructuredResume>(
      record.tailoredContent,
      sanitizeStructuredResume({})
    ),
    changeSummary: safeJson<ResumeChangeItem[]>(record.changeSummary, []),
    keywordsMatched: safeJson<string[]>(record.keywordsMatched, []),
    keywordsMissing: safeJson<string[]>(record.keywordsMissing, []),
    revisionHistory: safeJson<RevisionHistoryEntry[]>(record.revisionHistory, []),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const record = await prisma.tailoredResume.findFirst({
      where: { id: params.id, userId: session.user.id },
      include: {
        baseResume: { select: { id: true, title: true, fileName: true } },
        application: { select: { id: true, company: true, role: true, status: true } },
      },
    });

    if (!record) {
      return NextResponse.json({ error: "Tailored resume not found" }, { status: 404 });
    }

    return NextResponse.json({ tailoredResume: serializeRecord(record) });
  } catch (error) {
    console.error("Failed to load tailored resume:", error);
    return NextResponse.json({ error: "Failed to load tailored resume" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.tailoredResume.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Tailored resume not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "decide";

    const originalContent = safeJson<StructuredResume>(
      existing.originalContent,
      sanitizeStructuredResume({})
    );
    const currentTailored = safeJson<StructuredResume>(
      existing.tailoredContent,
      originalContent
    );
    const currentChanges = safeJson<ResumeChangeItem[]>(existing.changeSummary, []);
    const history = safeJson<RevisionHistoryEntry[]>(existing.revisionHistory, []);

    // ── Action 1: AI Refinement ("make specific changes which is done through AI") ──
    if (action === "refine") {
      const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
      const sectionTarget =
        typeof body.sectionTarget === "string" && body.sectionTarget.trim()
          ? body.sectionTarget.trim()
          : undefined;

      if (!instruction) {
        return NextResponse.json(
          { error: "Please enter an instruction for the AI." },
          { status: 400 }
        );
      }

      const refined = await refineTailoredResume({
        currentResume: currentTailored,
        baseResume: originalContent,
        jobDescription: existing.jobDescription,
        company: existing.company,
        role: existing.role,
        instruction,
        sectionTarget,
      });

      const newHistoryEntry: RevisionHistoryEntry = {
        id: `rev-${Date.now()}`,
        timestamp: new Date().toISOString(),
        prompt: instruction,
        sectionTarget,
        summaryOfChanges: refined.summaryOfChanges,
        snapshot: refined.updatedResume,
      };

      const updatedChanges = [...refined.newChanges, ...currentChanges];
      const updatedHistory = [...history, newHistoryEntry];

      const saved = await prisma.tailoredResume.update({
        where: { id: existing.id },
        data: {
          tailoredContent: JSON.stringify(refined.updatedResume),
          changeSummary: JSON.stringify(updatedChanges),
          revisionHistory: JSON.stringify(updatedHistory),
        },
        include: {
          baseResume: { select: { id: true, title: true, fileName: true } },
          application: { select: { id: true, company: true, role: true, status: true } },
        },
      });

      return NextResponse.json({
        tailoredResume: serializeRecord(saved),
        message: refined.summaryOfChanges,
      });
    }

    // ── Action 2: Restore a previous version snapshot from revisionHistory ──
    if (action === "restore_revision") {
      const revisionId = typeof body.revisionId === "string" ? body.revisionId : "";
      const targetRev = history.find((h) => h.id === revisionId);
      if (!targetRev) {
        return NextResponse.json({ error: "Revision not found" }, { status: 404 });
      }

      const saved = await prisma.tailoredResume.update({
        where: { id: existing.id },
        data: {
          tailoredContent: JSON.stringify(targetRev.snapshot),
        },
        include: {
          baseResume: { select: { id: true, title: true, fileName: true } },
          application: { select: { id: true, company: true, role: true, status: true } },
        },
      });

      return NextResponse.json({
        tailoredResume: serializeRecord(saved),
        message: "Restored selected revision.",
      });
    }

    // ── Action 3: Decide ("accepted_new" | "kept_original" | "draft") or update content/toggles ──
    const nextStatus =
      body.status === "accepted_new" || body.status === "kept_original" || body.status === "draft"
        ? body.status
        : existing.status;

    const nextTailored =
      body.tailoredContent && typeof body.tailoredContent === "object"
        ? sanitizeStructuredResume(body.tailoredContent)
        : currentTailored;

    const nextChanges = Array.isArray(body.changeSummary)
      ? (body.changeSummary as ResumeChangeItem[])
      : currentChanges;

    const saved = await prisma.tailoredResume.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        tailoredContent: JSON.stringify(nextTailored),
        changeSummary: JSON.stringify(nextChanges),
      },
      include: {
        baseResume: { select: { id: true, title: true, fileName: true } },
        application: { select: { id: true, company: true, role: true, status: true } },
      },
    });

    return NextResponse.json({
      tailoredResume: serializeRecord(saved),
    });
  } catch (error) {
    console.error("Failed to update tailored resume:", error);
    const msg = error instanceof Error ? error.message : "Failed to update tailored resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.tailoredResume.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Tailored resume not found" }, { status: 404 });
    }

    await prisma.tailoredResume.delete({ where: { id: existing.id } });
    return NextResponse.json({ message: "Tailored resume deleted" });
  } catch (error) {
    console.error("Failed to delete tailored resume:", error);
    return NextResponse.json({ error: "Failed to delete tailored resume" }, { status: 500 });
  }
}

