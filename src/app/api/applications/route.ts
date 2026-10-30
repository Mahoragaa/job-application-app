import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cleanCompanyName, normalizeCompany } from "@/lib/company";
import { cleanRole } from "@/lib/ai-classifier";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "applied",
  "reply_received",
  "interview",
  "rejected",
  "offer",
] as const;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [applications, user] = await Promise.all([
      prisma.application.findMany({
        where: { userId: session.user.id },
        orderBy: { appliedDate: "desc" },
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
      }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { lastSyncAt: true },
      }),
    ]);

    return NextResponse.json({
      applications,
      lastSyncAt: user?.lastSyncAt ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch applications:", error);
    return NextResponse.json(
      { error: "Failed to fetch applications" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const rawCompany = typeof body.company === "string" ? body.company.trim() : "";
    const rawRole = typeof body.role === "string" ? body.role.trim() : "";

    if (!rawCompany || !rawRole) {
      return NextResponse.json(
        { error: "Company and role are required" },
        { status: 400 }
      );
    }

    const company = cleanCompanyName(rawCompany) || rawCompany;
    const companyKey = normalizeCompany(company);
    const role = cleanRole(rawRole) || rawRole;
    const status = (VALID_STATUSES as readonly string[]).includes(body.status as string)
      ? (body.status as string)
      : "applied";

    const appliedDate =
      typeof body.appliedDate === "string" && !isNaN(Date.parse(body.appliedDate))
        ? new Date(body.appliedDate)
        : new Date();

    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const jobDescription =
      typeof body.jobDescription === "string" ? body.jobDescription.trim() || null : null;

    const application = await prisma.application.create({
      data: {
        userId: session.user.id,
        company,
        companyKey,
        role,
        status,
        appliedDate,
        hasReply: status !== "applied",
        replyDate: status !== "applied" ? new Date() : null,
        notes,
        jobDescription,
      },
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

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    console.error("Failed to create application:", error);
    return NextResponse.json(
      { error: "Failed to create application" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Clear both tables atomically so a partial failure can't leave
    // applications without their processed-email markers (or vice versa)
    const [deletedEmails, deletedApps] = await prisma.$transaction([
      prisma.processedEmail.deleteMany({ where: { userId } }),
      prisma.application.deleteMany({ where: { userId } }),
    ]);

    return NextResponse.json({
      message: "All data cleared",
      deletedApplications: deletedApps.count,
      deletedProcessedEmails: deletedEmails.count,
    });
  } catch (error) {
    console.error("Failed to clear applications:", error);
    return NextResponse.json(
      { error: "Failed to clear applications" },
      { status: 500 }
    );
  }
}
