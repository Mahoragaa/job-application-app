import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanCompanyName, normalizeCompany } from "@/lib/company";
import { cleanRole } from "@/lib/ai-classifier";

const VALID_STATUSES = [
  "applied",
  "reply_received",
  "interview",
  "rejected",
  "offer",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.application.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (typeof body.company === "string" && body.company.trim()) {
      const cleaned = cleanCompanyName(body.company.trim()) || body.company.trim();
      data.company = cleaned;
      data.companyKey = normalizeCompany(cleaned);
    }

    if (typeof body.role === "string" && body.role.trim()) {
      data.role = cleanRole(body.role.trim()) || body.role.trim();
    }

    if (
      typeof body.status === "string" &&
      (VALID_STATUSES as readonly string[]).includes(body.status)
    ) {
      data.status = body.status;
      if (body.status !== "applied" && !existing.hasReply) {
        data.hasReply = true;
        data.replyDate = existing.replyDate ?? new Date();
      }
    }

    if (typeof body.hasReply === "boolean") {
      data.hasReply = body.hasReply;
    }

    if (typeof body.appliedDate === "string" && !isNaN(Date.parse(body.appliedDate))) {
      data.appliedDate = new Date(body.appliedDate);
    }

    if (body.notes !== undefined) {
      data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    }

    if (body.jobDescription !== undefined) {
      data.jobDescription =
        typeof body.jobDescription === "string" ? body.jobDescription.trim() || null : null;
    }

    const updated = await prisma.application.update({
      where: { id: existing.id },
      data,
      include: {
        tailoredResumes: {
          select: {
            id: true,
            status: true,
            matchScoreBefore: true,
            matchScoreAfter: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({ application: updated });
  } catch (error) {
    console.error("Failed to update application:", error);
    return NextResponse.json(
      { error: "Failed to update application" },
      { status: 500 }
    );
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

    const existing = await prisma.application.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    await prisma.application.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ message: "Application deleted" });
  } catch (error) {
    console.error("Failed to delete application:", error);
    return NextResponse.json(
      { error: "Failed to delete application" },
      { status: 500 }
    );
  }
}

