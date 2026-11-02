"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DashboardHeader } from "@/components/dashboard/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Printer,
  Download,
  Copy,
  SplitSquareVertical,
  FileText,
  Target,
  History,
  Send,
  Check,
  X,
  ArrowRight,
  Wand2,
  Mail,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateDynamicCoverLetter,
  structuredResumeToMarkdown,
  type CoverLetterTone,
  type ResumeChangeItem,
  type RevisionHistoryEntry,
  type StructuredResume,
} from "@/lib/ai-resume";
import { downloadResumeAsDocx } from "@/lib/docx-export";

interface TailoredResumeDetail {
  id: string;
  baseResumeId: string;
  applicationId: string | null;
  company: string;
  role: string;
  jobDescription: string;
  tailorMode: string;
  originalContent: StructuredResume;
  tailoredContent: StructuredResume;
  changeSummary: ResumeChangeItem[];
  keywordsMatched: string[];
  keywordsMissing: string[];
  matchScoreBefore: number;
  matchScoreAfter: number;
  status: "draft" | "accepted_new" | "kept_original";
  revisionHistory: RevisionHistoryEntry[];
  updatedAt: string;
  baseResume?: { id: string; title: string; fileName: string | null };
  application?: { id: string; company: string; role: string; status: string } | null;
}

const QUICK_PROMPTS = [
  "Make experience bullets more concise and metric-driven",
  "Keep my original Professional Summary but keep the new skills",
  "Emphasize leadership, system design, and scalability",
  "Tone down buzzwords and make the phrasing sound more natural",
];

/**
 * Computes a simple word-level diff between `before` and `after` strings for visual highlighting.
 */
function renderWordDiff(before: string, after: string, mode: "before" | "after") {
  const beforeWords = before.split(/(\s+)/);
  const afterWords = after.split(/(\s+)/);

  const beforeSet = new Set(
    beforeWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  );
  const afterSet = new Set(
    afterWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  );

  if (mode === "before") {
    return beforeWords.map((token, idx) => {
      const clean = token.trim().toLowerCase();
      const removed = clean && !afterSet.has(clean);
      return (
        <span
          key={idx}
          className={
            removed
              ? "bg-red-500/25 text-red-200 line-through rounded px-0.5"
              : ""
          }
        >
          {token}
        </span>
      );
    });
  }

  return afterWords.map((token, idx) => {
    const clean = token.trim().toLowerCase();
    const added = clean && !beforeSet.has(clean);
    return (
      <span
        key={idx}
        className={
          added
            ? "bg-emerald-500/25 text-emerald-200 font-medium rounded px-0.5"
            : ""
        }
      >
        {token}
      </span>
    );
  });
}

export default function ResumePreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [record, setRecord] = useState<TailoredResumeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Active tab: "diff" | "document" | "side_by_side" | "jd" | "cover_letter"
  const [activeTab, setActiveTab] = useState<
    "diff" | "document" | "side_by_side" | "jd" | "cover_letter"
  >("diff");

  // Cover letter tone & editable text
  const [coverLetterTone, setCoverLetterTone] =
    useState<CoverLetterTone>("professional");
  const [customCoverLetter, setCustomCoverLetter] = useState<string>("");

  // Which version is rendered in Document Preview ("tailored" vs "original")
  const [previewVersion, setPreviewVersion] = useState<"tailored" | "original">(
    "tailored"
  );

  // AI Specific Refinement Controls
  const [aiInstruction, setAiInstruction] = useState("");
  const [sectionTarget, setSectionTarget] = useState<string>("");
  const [isRefining, setIsRefining] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  const fetchRecord = useCallback(async () => {
    try {
      const res = await fetch(`/api/resume/tailor/${params.id}`);
      if (!res.ok) {
        toast.error("Could not load tailored resume preview");
        router.push("/resume");
        return;
      }
      const data = await res.json();
      setRecord(data.tailoredResume);
      if (data.tailoredResume.status === "kept_original") {
        setPreviewVersion("original");
      }
    } catch (error) {
      console.error("Error loading tailored resume:", error);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    fetchRecord();
  }, [fetchRecord]);

  /**
   * Computes the effective tailored resume by applying any user-rejected individual changes
   * back to their original values.
   */
  const effectiveTailoredResume = useMemo<StructuredResume | null>(() => {
    if (!record) return null;
    const base = record.originalContent;
    const tailored: StructuredResume = JSON.parse(
      JSON.stringify(record.tailoredContent)
    );

    for (const chg of record.changeSummary) {
      if (chg.accepted === false) {
        if (chg.section === "summary") {
          tailored.summary = base.summary;
        } else if (chg.section === "skills") {
          tailored.skills = JSON.parse(JSON.stringify(base.skills));
        } else if (chg.section === "experience" && chg.before && chg.after) {
          for (const exp of tailored.experience) {
            exp.bullets = exp.bullets.map((b) =>
              b.trim() === chg.after.trim() ? chg.before : b
            );
          }
        } else if (chg.section === "projects" && chg.before && chg.after) {
          for (const proj of tailored.projects) {
            proj.bullets = proj.bullets.map((b) =>
              b.trim() === chg.after.trim() ? chg.before : b
            );
          }
        }
      }
    }
    return tailored;
  }, [record]);

  const activeDocumentResume =
    previewVersion === "original"
      ? record?.originalContent
      : effectiveTailoredResume;

  // Keep dynamic cover letter synced when resume or tone changes
  useEffect(() => {
    if (!record || !effectiveTailoredResume) return;
    const generated = generateDynamicCoverLetter({
      resume: effectiveTailoredResume,
      company: record.company,
      role: record.role,
      jobDescription: record.jobDescription,
      keywordsMatched: record.keywordsMatched,
      tone: coverLetterTone,
    });
    setCustomCoverLetter(generated);
  }, [record, effectiveTailoredResume, coverLetterTone]);

  // ── Decision Handlers: Use New vs Stick to Old vs Make Specific Changes ──
  const handleDecision = async (
    nextStatus: "accepted_new" | "kept_original"
  ) => {
    if (!record || !effectiveTailoredResume) return;
    setIsSavingDecision(true);
    try {
      const res = await fetch(`/api/resume/tailor/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          status: nextStatus,
          tailoredContent: effectiveTailoredResume,
          changeSummary: record.changeSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save decision");

      setRecord(data.tailoredResume);
      setPreviewVersion(
        nextStatus === "kept_original" ? "original" : "tailored"
      );

      if (nextStatus === "accepted_new") {
        toast.success("Tailored resume accepted!", {
          description: `Marked as your active resume for ${record.role} at ${record.company}.`,
        });
      } else {
        toast.info("Sticking with your original base resume", {
          description:
            "Switched preview to your original resume. You can switch back or refine with AI anytime.",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSavingDecision(false);
    }
  };

  // ── Toggle individual change item on/off ──
  const handleToggleChangeItem = async (changeId: string) => {
    if (!record) return;
    const updatedChanges = record.changeSummary.map((c) =>
      c.id === changeId ? { ...c, accepted: !c.accepted } : c
    );
    setRecord({ ...record, changeSummary: updatedChanges });

    try {
      await fetch(`/api/resume/tailor/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          status: record.status,
          changeSummary: updatedChanges,
        }),
      });
    } catch {
      // Optimistic local state already updated
    }
  };

  // ── Make Specific Changes via AI ──
  const handleAiRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record || !aiInstruction.trim()) {
      toast.error("Please enter what specific changes you want the AI to make.");
      return;
    }

    setIsRefining(true);
    const toastId = toast.loading("AI is applying your specific changes...");

    try {
      const res = await fetch(`/api/resume/tailor/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refine",
          instruction: aiInstruction.trim(),
          sectionTarget: sectionTarget || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refinement failed");

      setRecord(data.tailoredResume);
      setPreviewVersion("tailored");
      setAiInstruction("");
      toast.success("Resume updated by AI!", {
        id: toastId,
        description: data.message,
      });
    } catch (err) {
      toast.error("AI refinement failed", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!record) return;
    const toastId = toast.loading("Restoring selected version...");
    try {
      const res = await fetch(`/api/resume/tailor/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore_revision",
          revisionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Restore failed");
      setRecord(data.tailoredResume);
      toast.success("Version restored!", { id: toastId });
    } catch (err) {
      toast.error("Could not restore version", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleDownloadMarkdown = () => {
    if (!activeDocumentResume || !record) return;
    const md = structuredResumeToMarkdown(activeDocumentResume);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const suffix = previewVersion === "original" ? "original" : "tailored";
    link.download = `${record.company
      .toLowerCase()
      .replace(/\s+/g, "-")}-${suffix}-resume.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDocx = () => {
    if (!activeDocumentResume || !record) return;
    const suffix = previewVersion === "original" ? "original" : "tailored";
    const fileName = `${record.company
      .toLowerCase()
      .replace(/\s+/g, "-")}-${suffix}-resume.docx`;
    downloadResumeAsDocx(activeDocumentResume, fileName);
    toast.success(`Downloaded ${fileName}`);
  };

  const handleCopyMarkdown = async () => {
    if (!activeDocumentResume) return;
    const md = structuredResumeToMarkdown(activeDocumentResume);
    await navigator.clipboard.writeText(md);
    toast.success(
      `Copied ${
        previewVersion === "original" ? "original" : "tailored"
      } resume to clipboard!`
    );
  };

  const handlePrintPdf = () => {
    setActiveTab("document");
    setTimeout(() => {
      window.print();
    }, 150);
  };

  if (isLoading || !record || !effectiveTailoredResume) {
    return (
      <div className="min-h-screen bg-background mesh-gradient">
        <DashboardHeader />
        <main className="container py-8 space-y-6">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-12">
            <Skeleton className="h-[600px] lg:col-span-8 rounded-xl" />
            <Skeleton className="h-[600px] lg:col-span-4 rounded-xl" />
          </div>
        </main>
      </div>
    );
  }

  const acceptedCount = record.changeSummary.filter(
    (c) => c.accepted !== false
  ).length;

  return (
    <div className="min-h-screen bg-background mesh-gradient print:bg-white print:text-black">
      <DashboardHeader />

      <main className="container py-6 space-y-6 print:p-0 print:max-w-none">
        {/* ── Top Navigation & Decision Banner (Hidden when printing PDF) ── */}
        <div className="print:hidden space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/resume"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to AI Resume Studio
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyMarkdown}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Text
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadDocx}
                className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download .DOCX
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadMarkdown}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download .MD
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintPdf}
                className="gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" />
                Print / Save PDF
              </Button>
            </div>
          </div>

          {/* Decision Card */}
          <Card className="border-primary/30 bg-card/90 shadow-xl">
            <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-xl font-bold tracking-tight">
                    {record.role} @ {record.company}
                  </h2>
                  {record.status === "accepted_new" ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Decision: Going with Tailored Resume
                    </Badge>
                  ) : record.status === "kept_original" ? (
                    <Badge variant="secondary">
                      Decision: Sticking with Original Resume
                    </Badge>
                  ) : (
                    <Badge variant="purple">Reviewing Changes</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    Base Resume:{" "}
                    <strong className="text-foreground">
                      {record.baseResume?.title || "Master Resume"}
                    </strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    ATS Fit Score:
                    <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      Before: {record.matchScoreBefore}%
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                      After: {record.matchScoreAfter}%
                    </span>
                  </span>
                  <span>
                    {acceptedCount} of {record.changeSummary.length} AI edits
                    active
                  </span>
                </div>
              </div>

              {/* 3 Core User Decisions */}
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  onClick={() => handleDecision("accepted_new")}
                  disabled={isSavingDecision}
                  variant={
                    record.status === "accepted_new" ? "default" : "outline"
                  }
                  className={
                    record.status === "accepted_new"
                      ? "gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "gap-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15"
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Go With This Tailored Resume
                </Button>

                <Button
                  onClick={() => handleDecision("kept_original")}
                  disabled={isSavingDecision}
                  variant={
                    record.status === "kept_original" ? "secondary" : "outline"
                  }
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Stick to Old Resume
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const el = document.getElementById("ai-refine-input");
                    el?.focus();
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Wand2 className="h-4 w-4" />
                  Make Specific AI Changes
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* View Mode Selector Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-secondary/50 p-1 border border-border/60">
              <button
                onClick={() => setActiveTab("diff")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === "diff"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="h-4 w-4" />
                AI Changes & Diff ({record.changeSummary.length})
              </button>
              <button
                onClick={() => setActiveTab("side_by_side")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === "side_by_side"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SplitSquareVertical className="h-4 w-4" />
                Side-by-Side Comparison
              </button>
              <button
                onClick={() => setActiveTab("document")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === "document"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-4 w-4" />
                Full Resume Preview
              </button>
              <button
                onClick={() => setActiveTab("jd")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === "jd"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Target className="h-4 w-4" />
                JD Keywords & Fit
              </button>
              <button
                onClick={() => setActiveTab("cover_letter")}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTab === "cover_letter"
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Mail className="h-4 w-4" />
                Cover Letter
              </button>
            </div>

            {activeTab === "document" && (
              <div className="flex items-center gap-1 rounded-lg bg-secondary/40 p-1 border border-border/50 text-xs">
                <button
                  onClick={() => setPreviewVersion("tailored")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    previewVersion === "tailored"
                      ? "bg-emerald-600 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Viewing: Tailored Resume
                </button>
                <button
                  onClick={() => setPreviewVersion("original")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    previewVersion === "original"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Viewing: Old (Original) Resume
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content Grid: Left (Preview / Diff) + Right (AI Refinement Chat & Keywords) ── */}
        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* LEFT 8 COLUMNS: Active Preview / Diff View */}
          <div className="lg:col-span-8 space-y-4 print:col-span-12">
            {/* TAB 1: CHANGE-BY-CHANGE DIFF CARDS */}
            {activeTab === "diff" && (
              <div className="space-y-4 print:hidden">
                {record.changeSummary.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      No structured change cards recorded. Switch to
                      Side-by-Side Comparison or Full Resume Preview, or use the
                      AI Refinement box on the right to request edits.
                    </CardContent>
                  </Card>
                ) : (
                  record.changeSummary.map((chg, idx) => {
                    const isAccepted = chg.accepted !== false;
                    return (
                      <Card
                        key={chg.id || idx}
                        className={`transition-all ${
                          isAccepted
                            ? "border-emerald-500/30"
                            : "border-border/40 opacity-65"
                        }`}
                      >
                        <CardHeader className="py-3.5 px-5 border-b border-border/40 flex flex-row items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <Badge
                              variant={isAccepted ? "success" : "secondary"}
                              className="uppercase text-[10px]"
                            >
                              {chg.section}
                            </Badge>
                            <span className="font-semibold text-sm">
                              {chg.targetLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSectionTarget(chg.targetLabel);
                                const el =
                                  document.getElementById("ai-refine-input");
                                el?.focus();
                              }}
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              <Wand2 className="h-3 w-3" />
                              Ask AI to tweak this
                            </button>

                            <Button
                              type="button"
                              size="sm"
                              variant={isAccepted ? "outline" : "secondary"}
                              onClick={() => handleToggleChangeItem(chg.id)}
                              className="h-7 px-2.5 text-xs gap-1"
                            >
                              {isAccepted ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  Keep Edit
                                </>
                              ) : (
                                <>
                                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                                  Reverted to Old
                                </>
                              )}
                            </Button>
                          </div>
                        </CardHeader>

                        <CardContent className="p-5 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* BEFORE */}
                            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3.5 space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
                                Old Resume (Original)
                              </div>
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {chg.before
                                  ? renderWordDiff(
                                      chg.before,
                                      chg.after,
                                      "before"
                                    )
                                  : "(Not present in original)"}
                              </p>
                            </div>

                            {/* AFTER */}
                            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5 space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                                Tailored for {record.company}
                              </div>
                              <p className="text-xs leading-relaxed text-foreground">
                                {renderWordDiff(chg.before, chg.after, "after")}
                              </p>
                            </div>
                          </div>

                          {chg.reason && (
                            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/30 px-3 py-2 rounded-md">
                              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                              <span>
                                <strong className="text-foreground">
                                  Why AI changed this:
                                </strong>{" "}
                                {chg.reason}
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}

            {/* TAB 2: SIDE-BY-SIDE FULL COMPARISON */}
            {activeTab === "side_by_side" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
                {/* Original Column */}
                <Card className="border-border/60">
                  <CardHeader className="py-3 px-4 border-b border-border/40 bg-secondary/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-muted-foreground">
                        Old Resume (Original Base)
                      </CardTitle>
                      <Badge variant="secondary">
                        {record.matchScoreBefore}% Fit
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4 text-xs">
                    <div>
                      <h4 className="font-bold text-sm">
                        {record.originalContent.fullName}
                      </h4>
                      <p className="text-muted-foreground">
                        {record.originalContent.contactInfo}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-muted-foreground mb-1">
                        Summary
                      </h5>
                      <p className="leading-relaxed">
                        {record.originalContent.summary}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-muted-foreground mb-1">
                        Skills
                      </h5>
                      {record.originalContent.skills.map((g, i) => (
                        <p key={i} className="mb-1">
                          <strong>{g.category}:</strong> {g.items.join(", ")}
                        </p>
                      ))}
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-muted-foreground mb-1">
                        Experience
                      </h5>
                      <div className="space-y-3">
                        {record.originalContent.experience.map((exp, i) => (
                          <div key={i} className="space-y-1">
                            <div className="font-semibold">
                              {exp.role} — {exp.company}{" "}
                              <span className="text-muted-foreground font-normal">
                                ({exp.dates})
                              </span>
                            </div>
                            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                              {exp.bullets.map((b, bi) => (
                                <li key={bi}>{b}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tailored Column */}
                <Card className="border-emerald-500/30">
                  <CardHeader className="py-3 px-4 border-b border-emerald-500/20 bg-emerald-500/5">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-emerald-300">
                        Tailored Resume ({record.company})
                      </CardTitle>
                      <Badge variant="success">
                        {record.matchScoreAfter}% Fit
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4 text-xs">
                    <div>
                      <h4 className="font-bold text-sm">
                        {effectiveTailoredResume.fullName}
                      </h4>
                      <p className="text-muted-foreground">
                        {effectiveTailoredResume.contactInfo}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-emerald-400 mb-1">
                        Summary
                      </h5>
                      <p className="leading-relaxed">
                        {renderWordDiff(
                          record.originalContent.summary,
                          effectiveTailoredResume.summary,
                          "after"
                        )}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-emerald-400 mb-1">
                        Skills
                      </h5>
                      {effectiveTailoredResume.skills.map((g, i) => (
                        <p key={i} className="mb-1">
                          <strong>{g.category}:</strong> {g.items.join(", ")}
                        </p>
                      ))}
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[11px] text-emerald-400 mb-1">
                        Experience
                      </h5>
                      <div className="space-y-3">
                        {effectiveTailoredResume.experience.map((exp, i) => {
                          const origExp = record.originalContent.experience[i];
                          return (
                            <div key={i} className="space-y-1">
                              <div className="font-semibold">
                                {exp.role} — {exp.company}{" "}
                                <span className="text-muted-foreground font-normal">
                                  ({exp.dates})
                                </span>
                              </div>
                              <ul className="list-disc pl-4 space-y-1">
                                {exp.bullets.map((b, bi) => {
                                  const origB = origExp?.bullets?.[bi] || "";
                                  return (
                                    <li key={bi}>
                                      {origB
                                        ? renderWordDiff(origB, b, "after")
                                        : b}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB 3: CLEAN ATS DOCUMENT PREVIEW (Also used when printing PDF) */}
            {activeTab === "document" && activeDocumentResume && (
              <div className="rounded-xl border border-border bg-white text-slate-900 p-8 sm:p-10 shadow-2xl print:border-0 print:shadow-none print:p-0 space-y-5">
                {/* Resume Header */}
                <div className="border-b border-slate-300 pb-4 text-center">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    {activeDocumentResume.fullName}
                  </h1>
                  {activeDocumentResume.contactInfo && (
                    <p className="text-xs text-slate-600 mt-1">
                      {activeDocumentResume.contactInfo}
                    </p>
                  )}
                </div>

                {/* Professional Summary */}
                {activeDocumentResume.summary && (
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1 flex-1">
                        Professional Summary
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Professional Summary");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden ml-3 text-[11px] text-violet-600 hover:underline flex items-center gap-1"
                      >
                        <Wand2 className="h-3 w-3" />
                        Edit with AI
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-800">
                      {activeDocumentResume.summary}
                    </p>
                  </section>
                )}

                {/* Technical Skills */}
                {activeDocumentResume.skills.length > 0 && (
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1 flex-1">
                        Technical Skills
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Technical Skills");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden ml-3 text-[11px] text-violet-600 hover:underline flex items-center gap-1"
                      >
                        <Wand2 className="h-3 w-3" />
                        Edit with AI
                      </button>
                    </div>
                    <div className="space-y-1 text-xs text-slate-800">
                      {activeDocumentResume.skills.map((group, idx) => (
                        <div key={idx}>
                          <span className="font-semibold">{group.category}: </span>
                          <span>{group.items.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Professional Experience */}
                {activeDocumentResume.experience.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1 flex-1">
                        Professional Experience
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Professional Experience");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden ml-3 text-[11px] text-violet-600 hover:underline flex items-center gap-1"
                      >
                        <Wand2 className="h-3 w-3" />
                        Edit with AI
                      </button>
                    </div>
                    <div className="space-y-3.5">
                      {activeDocumentResume.experience.map((exp, idx) => (
                        <div key={exp.id || idx} className="space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <span className="font-bold text-sm text-slate-900">
                                {exp.role}
                              </span>
                              <span className="text-xs font-semibold text-slate-700">
                                {" "}
                                — {exp.company}
                              </span>
                            </div>
                            <span className="text-xs text-slate-600">
                              {[exp.location, exp.dates]
                                .filter(Boolean)
                                .join(" | ")}
                            </span>
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-xs text-slate-800 leading-relaxed">
                            {exp.bullets.map((b, bi) => (
                              <li key={bi}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Projects */}
                {activeDocumentResume.projects.length > 0 && (
                  <section className="space-y-2.5">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1">
                      Projects
                    </h2>
                    <div className="space-y-2.5">
                      {activeDocumentResume.projects.map((proj, idx) => (
                        <div key={proj.id || idx} className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="font-bold text-xs text-slate-900">
                              {proj.name}
                            </span>
                            {proj.techStack && (
                              <span className="text-[11px] italic text-slate-600">
                                {proj.techStack}
                              </span>
                            )}
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-xs text-slate-800">
                            {proj.bullets.map((b, bi) => (
                              <li key={bi}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Education */}
                {activeDocumentResume.education.length > 0 && (
                  <section className="space-y-1.5">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1">
                      Education
                    </h2>
                    <div className="space-y-1.5 text-xs text-slate-800">
                      {activeDocumentResume.education.map((edu, idx) => (
                        <div
                          key={edu.id || idx}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <div>
                            <span className="font-semibold">
                              {edu.degree || edu.institution}
                            </span>
                            {edu.degree && <span> — {edu.institution}</span>}
                            {edu.details && (
                              <span className="text-slate-600">
                                {" "}
                                ({edu.details})
                              </span>
                            )}
                          </div>
                          <span className="text-slate-600">{edu.dates}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB 4: JOB DESCRIPTION & KEYWORD ANALYSIS */}
            {activeTab === "jd" && (
              <Card className="print:hidden">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Target Job Description & ATS Keywords
                  </CardTitle>
                  <CardDescription>
                    Keywords extracted from {record.company}&apos;s job
                    description for {record.role}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                        Matched Keywords ({record.keywordsMatched.length})
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {record.keywordsMatched.map((kw) => (
                          <Badge key={kw} variant="success">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                        Unmatched / Optional Keywords (
                        {record.keywordsMissing.length})
                      </h4>
                      {record.keywordsMissing.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          All primary JD keywords are covered!
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {record.keywordsMissing.map((kw) => (
                            <button
                              key={kw}
                              type="button"
                              onClick={() => {
                                setAiInstruction(
                                  `Naturally incorporate my experience with ${kw} into my skills and relevant experience bullet points.`
                                );
                                document
                                  .getElementById("ai-refine-input")
                                  ?.focus();
                              }}
                              className="px-2.5 py-0.5 rounded-full text-xs border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 transition-colors"
                              title="Click to ask AI to add this keyword"
                            >
                              + {kw}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Original Job Description
                    </h4>
                    <pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-secondary/20 p-4 text-xs text-muted-foreground font-sans leading-relaxed max-h-[420px] overflow-y-auto">
                      {record.jobDescription}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* TAB 5: DYNAMIC COVER LETTER GENERATOR */}
            {activeTab === "cover_letter" && (
              <Card className="print:hidden">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        Tailored Cover Letter for {record.company}
                      </CardTitle>
                      <CardDescription>
                        Dynamically synthesized from your tailored resume and{" "}
                        {record.company}&apos;s job description.
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={coverLetterTone}
                        onChange={(e) =>
                          setCoverLetterTone(e.target.value as CoverLetterTone)
                        }
                        className="h-8 px-2.5 rounded-md border border-input bg-background text-xs"
                      >
                        <option value="professional">Professional Tone</option>
                        <option value="enthusiastic">Enthusiastic Tone</option>
                        <option value="technical">Deep Technical Tone</option>
                      </select>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await navigator.clipboard.writeText(customCoverLetter);
                          toast.success("Cover letter copied to clipboard!");
                        }}
                        className="gap-1.5"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const blob = new Blob([customCoverLetter], {
                            type: "text/plain;charset=utf-8;",
                          });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `${record.company
                            .toLowerCase()
                            .replace(/\s+/g, "-")}-cover-letter.txt`;
                          link.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download .TXT
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <textarea
                    rows={18}
                    value={customCoverLetter}
                    onChange={(e) => setCustomCoverLetter(e.target.value)}
                    className="w-full p-4 rounded-lg border border-input bg-background/80 text-xs sm:text-sm leading-relaxed font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT 4 COLUMNS: Interactive AI Refinement Box & Revision History */}
          <div className="lg:col-span-4 space-y-6 print:hidden">
            {/* Make Specific Changes via AI Card */}
            <Card className="border-primary/40 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-primary" />
                  Make Specific Changes with AI
                </CardTitle>
                <CardDescription className="text-xs">
                  Tell the AI exactly what you want changed, toned down, added,
                  or restored.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleAiRefine} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Target Section
                    </label>
                    <select
                      value={sectionTarget}
                      onChange={(e) => setSectionTarget(e.target.value)}
                      className="w-full h-8 px-2.5 rounded-md border border-input bg-background text-xs"
                    >
                      <option value="">Entire Resume (Auto-detect)</option>
                      <option value="Professional Summary">
                        Professional Summary Only
                      </option>
                      <option value="Technical Skills">
                        Technical Skills Only
                      </option>
                      <option value="Professional Experience">
                        Work Experience Bullets
                      </option>
                      <option value="Projects">Projects Section</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Your Instruction for AI
                    </label>
                    <textarea
                      id="ai-refine-input"
                      rows={4}
                      value={aiInstruction}
                      onChange={(e) => setAiInstruction(e.target.value)}
                      placeholder="e.g. 'Rewrite my summary to highlight 4+ years of TypeScript & Next.js', or 'Make the 2nd bullet at my latest role shorter'..."
                      className="w-full p-2.5 rounded-md border border-input bg-background text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="sm"
                    disabled={isRefining}
                    className="w-full gap-2"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {isRefining
                      ? "AI is Updating Resume..."
                      : "Apply Specific AI Changes"}
                  </Button>
                </form>

                {/* Quick Prompt Suggestions */}
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Quick AI Refinement Prompts:
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setAiInstruction(q)}
                        className="text-left text-[11px] px-2.5 py-1.5 rounded-md bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      >
                        &ldquo;{q}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Revision History Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  AI Revision History ({record.revisionHistory.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Every AI edit is saved as a snapshot so you can restore any
                  version.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto">
                {record.revisionHistory
                  .slice()
                  .reverse()
                  .map((rev, idx) => (
                    <div
                      key={rev.id}
                      className="p-3 rounded-lg border border-border/60 bg-secondary/20 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground truncate">
                          {idx === 0 ? "Latest Version" : `Revision`}
                        </span>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRestoreRevision(rev.id)}
                            className="text-[11px] text-primary hover:underline shrink-0"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                      <p className="text-muted-foreground italic line-clamp-2">
                        &ldquo;{rev.prompt}&rdquo;
                      </p>
                      <p className="text-[11px] text-emerald-400/90">
                        {rev.summaryOfChanges}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

