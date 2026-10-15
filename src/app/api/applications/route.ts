import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
