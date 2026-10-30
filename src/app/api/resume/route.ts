import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  extractTextFromUploadedFile,
  parseResumeText,
  sanitizeStructuredResume,
  structuredResumeToMarkdown,
  type StructuredResume,
} from "@/lib/ai-resume";

export const dynamic = "force-dynamic";

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const [resumesRaw, tailoredRaw] = await Promise.all([
      prisma.resume.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.tailoredResume.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          baseResume: { select: { id: true, title: true } },
          application: { select: { id: true, company: true, role: true, status: true } },
        },
      }),
    ]);

    const resumes = resumesRaw.map((r) => ({
      ...r,
      structuredData: safeParseJson<StructuredResume | null>(r.structuredData, null),
    }));

    const tailoredResumes = tailoredRaw.map((t) => ({
      id: t.id,
      baseResumeId: t.baseResumeId,
      applicationId: t.applicationId,
      company: t.company,
      role: t.role,
      tailorMode: t.tailorMode,
      matchScoreBefore: t.matchScoreBefore,
      matchScoreAfter: t.matchScoreAfter,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      baseResume: t.baseResume,
      application: t.application,
      keywordsMatched: safeParseJson<string[]>(t.keywordsMatched, []),
    }));

    return NextResponse.json({ resumes, tailoredResumes });
  } catch (error) {
    console.error("Failed to fetch resumes:", error);
    return NextResponse.json({ error: "Failed to fetch resumes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const contentType = request.headers.get("content-type") || "";
    let title = "My Master Resume";
    let fileName: string | null = null;
    let rawText = "";
    let inlinePdf: { data: string; mimeType: string } | undefined;
    let preStructured: StructuredResume | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;
      const pastedText = formData.get("rawText") as string | null;

      if (customTitle?.trim()) title = customTitle.trim();

      if (file && file.size > 0) {
        fileName = file.name;
        if (!customTitle?.trim()) {
          title = file.name.replace(/\.[^.]+$/, "");
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const extracted = await extractTextFromUploadedFile(
          buffer,
          file.name,
          file.type || "application/octet-stream"
        );
        rawText = extracted.text;
        inlinePdf = extracted.inlinePdf;
      } else if (pastedText?.trim()) {
        rawText = pastedText.trim();
      }
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.title === "string" && body.title.trim()) {
        title = body.title.trim();
      }
      if (typeof body.fileName === "string") {
        fileName = body.fileName;
      }
      if (typeof body.rawText === "string") {
        rawText = body.rawText.trim();
      }
      if (body.structuredData && typeof body.structuredData === "object") {
        preStructured = sanitizeStructuredResume(body.structuredData);
        if (!rawText) rawText = structuredResumeToMarkdown(preStructured);
      }
    }

    if (!rawText && !inlinePdf && !preStructured) {
      return NextResponse.json(
        { error: "Please provide resume text or upload a PDF, DOCX, TXT, or MD file." },
        { status: 400 }
      );
    }

    const parsed = preStructured
      ? { rawText, structured: preStructured }
      : await parseResumeText(rawText, inlinePdf);

    // Make this the default resume if the user has no resumes yet
    const existingCount = await prisma.resume.count({ where: { userId } });

    const created = await prisma.resume.create({
      data: {
        userId,
        title,
        fileName,
        rawText: parsed.rawText,
        structuredData: JSON.stringify(parsed.structured),
        isDefault: existingCount === 0,
      },
    });

    return NextResponse.json(
      {
        resume: {
          ...created,
          structuredData: parsed.structured,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to upload/parse resume:", error);
    const msg = error instanceof Error ? error.message : "Failed to parse resume";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";

    const existing = await prisma.resume.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    let structured: StructuredResume = safeParseJson(
      existing.structuredData,
      sanitizeStructuredResume({})
    );
    let rawText = existing.rawText;

    if (body.structuredData && typeof body.structuredData === "object") {
      structured = sanitizeStructuredResume(body.structuredData);
      rawText = structuredResumeToMarkdown(structured);
    } else if (typeof body.rawText === "string" && body.rawText.trim()) {
      const reparsed = await parseResumeText(body.rawText.trim());
      rawText = reparsed.rawText;
      structured = reparsed.structured;
    }

    const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : existing.isDefault;
    if (isDefault) {
      await prisma.resume.updateMany({
        where: { userId, id: { not: existing.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.resume.update({
      where: { id: existing.id },
      data: {
        title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing.title,
        rawText,
        structuredData: JSON.stringify(structured),
        isDefault,
      },
    });

    return NextResponse.json({
      resume: {
        ...updated,
        structuredData: structured,
      },
    });
  } catch (error) {
    console.error("Failed to update resume:", error);
    return NextResponse.json({ error: "Failed to update resume" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing resume id" }, { status: 400 });
    }

    const existing = await prisma.resume.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    await prisma.resume.delete({ where: { id: existing.id } });
    return NextResponse.json({ message: "Resume deleted" });
  } catch (error) {
    console.error("Failed to delete resume:", error);
    return NextResponse.json({ error: "Failed to delete resume" }, { status: 500 });
  }
}

