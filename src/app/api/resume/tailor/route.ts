import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  sanitizeStructuredResume,
  tailorResumeToJob,
  type TailorMode,
} from "@/lib/ai-resume";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = (await request.json()) as Record<string, unknown>;
    const baseResumeId = typeof body.baseResumeId === "string" ? body.baseResumeId : "";
    const applicationId =
      typeof body.applicationId === "string" && body.applicationId.trim()
        ? body.applicationId.trim()
        : null;
    const company = typeof body.company === "string" ? body.company.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const jobDescription =
      typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    const mode: TailorMode =
      body.mode === "conservative" || body.mode === "aggressive" || body.mode === "balanced"
        ? body.mode
        : "balanced";

    if (!baseResumeId) {
      return NextResponse.json({ error: "Please select or upload a base resume first." }, { status: 400 });
    }
    if (!company || !role || !jobDescription) {
      return NextResponse.json(
        { error: "Company, role, and job description are required." },
        { status: 400 }
      );
    }

    const baseResumeRecord = await prisma.resume.findFirst({
      where: { id: baseResumeId, userId },
    });
    if (!baseResumeRecord) {
      return NextResponse.json({ error: "Base resume not found." }, { status: 404 });
    }

    let baseStructured;
    try {
      baseStructured = sanitizeStructuredResume(JSON.parse(baseResumeRecord.structuredData));
    } catch {
      return NextResponse.json({ error: "Corrupted base resume data." }, { status: 500 });
    }

    const tailorResult = await tailorResumeToJob({
      baseResume: baseStructured,
      jobDescription,
      company,
      role,
      mode,
    });

    // Save the job description onto the linked application if provided
    if (applicationId) {
      await prisma.application
        .updateMany({
          where: { id: applicationId, userId },
          data: { jobDescription },
        })
        .catch(() => undefined);
    }

    const created = await prisma.tailoredResume.create({
      data: {
        userId,
        baseResumeId: baseResumeRecord.id,
        applicationId,
        company,
        role,
        jobDescription,
        tailorMode: mode,
        originalContent: JSON.stringify(baseStructured),
        tailoredContent: JSON.stringify(tailorResult.tailoredContent),
        changeSummary: JSON.stringify(tailorResult.changeSummary),
        keywordsMatched: JSON.stringify(tailorResult.keywordsMatched),
        keywordsMissing: JSON.stringify(tailorResult.keywordsMissing),
        matchScoreBefore: tailorResult.matchScoreBefore,
        matchScoreAfter: tailorResult.matchScoreAfter,
        status: "draft",
        revisionHistory: JSON.stringify([
          {
            id: `rev-init-${Date.now()}`,
            timestamp: new Date().toISOString(),
            prompt: `Initial AI tailoring (${mode} mode) for ${role} at ${company}`,
            summaryOfChanges: `Generated ${tailorResult.changeSummary.length} targeted optimization(s); ATS match improved from ${tailorResult.matchScoreBefore}% to ${tailorResult.matchScoreAfter}%.`,
            snapshot: tailorResult.tailoredContent,
          },
        ]),
      },
    });

    return NextResponse.json({ tailoredResumeId: created.id, tailoredResume: created }, { status: 201 });
  } catch (error) {
    console.error("Failed to tailor resume:", error);
    const msg = error instanceof Error ? error.message : "Failed to tailor resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

