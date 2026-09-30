import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const applications = await prisma.application.findMany({
      where: { userId: session.user.id },
      orderBy: { appliedDate: "desc" },
    });

    return NextResponse.json(applications);
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

    // Delete ProcessedEmail first (no FK constraint issue), then Applications
    const [deletedEmails, deletedApps] = await Promise.all([
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
