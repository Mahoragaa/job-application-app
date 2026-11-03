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
  application?: {
    id: string;
    company: string;
    role: string;
    status: string;
  } | null;
}

const QUICK_CHIPS = [
  {
    label: "Shorter bullets",
    prompt: "Make experience bullets shorter and more concise",
  },
  {
    label: "Add metrics",
    prompt: "Make experience bullets more metric-driven and quantified",
  },
  {
    label: "Keep old summary",
    prompt: "Keep my original Professional Summary",
  },
  {
    label: "Natural tone",
    prompt: "Tone down buzzwords and make phrasing sound natural",
  },
];

function renderWordDiff(
  before: string,
  after: string,
  mode: "before" | "after"
) {
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
              ? "bg-rose-500/20 text-rose-200 line-through rounded px-0.5"
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
            ? "bg-emerald-500/20 text-emerald-200 font-medium rounded px-0.5"
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

  const [activeTab, setActiveTab] = useState<
    "diff" | "document" | "side_by_side" | "jd" | "cover_letter"
  >("diff");

  const [previewVersion, setPreviewVersion] = useState<"tailored" | "original">(
    "tailored"
  );

  const [coverLetterTone, setCoverLetterTone] =
    useState<CoverLetterTone>("professional");
  const [customCoverLetter, setCustomCoverLetter] = useState<string>("");

  const [aiInstruction, setAiInstruction] = useState("");
  const [sectionTarget, setSectionTarget] = useState<string>("");
  const [isRefining, setIsRefining] = useState(false);
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  const fetchRecord = useCallback(async () => {
    try {
      const res = await fetch(`/api/resume/tailor/${params.id}`);
      if (!res.ok) {
        toast.error("Could not load preview");
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
      if (!res.ok) throw new Error(data.error || "Failed to save");

      setRecord(data.tailoredResume);
      setPreviewVersion(
        nextStatus === "kept_original" ? "original" : "tailored"
      );

      toast.success(
        nextStatus === "accepted_new"
          ? "Using tailored resume"
          : "Reverted to original resume"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSavingDecision(false);
    }
  };

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
      // Local state updated optimistically
    }
  };

  const handleAiRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record || !aiInstruction.trim()) {
      toast.error("Enter an instruction first");
      return;
    }

    setIsRefining(true);
    const toastId = toast.loading("Applying edits...");

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
      toast.success("Updated", { id: toastId, description: data.message });
    } catch (err) {
      toast.error("Update failed", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!record) return;
    const toastId = toast.loading("Restoring...");
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
      toast.success("Version restored", { id: toastId });
    } catch (err) {
      toast.error("Restore failed", {
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
    toast.success("Copied to clipboard");
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
        <main className="container py-7 space-y-5">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-5 lg:grid-cols-12">
            <Skeleton className="h-[520px] lg:col-span-8 rounded-xl" />
            <Skeleton className="h-[520px] lg:col-span-4 rounded-xl" />
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

      <main className="container py-6 space-y-5 print:p-0 print:max-w-none">
        {/* ── Top Controls (Hidden in Print) ── */}
        <div className="print:hidden space-y-4">
          {/* Utility Row: Back + Compact Exports */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/resume"
              className="tactile-pill inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground py-1 px-2 -ml-2 rounded-md"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Studio
            </Link>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadDocx}
                className="h-7 px-2.5 gap-1.5"
              >
                <FileDown className="h-3.5 w-3.5 text-primary" />
                DOCX
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintPdf}
                className="h-7 px-2.5 gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadMarkdown}
                className="h-7 px-2.5 gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                MD
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyMarkdown}
                className="h-7 px-2.5 gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </div>

          {/* Concise Decision Header Card */}
          <Card>
            <CardContent className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                    {record.role}
                  </h2>
                  <span className="text-muted-foreground text-sm">·</span>
                  <span className="text-sm font-medium text-indigo-300">
                    {record.company}
                  </span>

                  {record.status === "accepted_new" ? (
                    <Badge variant="success">Using Tailored</Badge>
                  ) : record.status === "kept_original" ? (
                    <Badge variant="secondary">Using Original</Badge>
                  ) : (
                    <Badge variant="purple">Draft</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    Fit:
                    <span>{record.matchScoreBefore}%</span>
                    <ArrowRight className="h-3 w-3 text-emerald-400" />
                    <span className="font-semibold text-emerald-400">
                      {record.matchScoreAfter}%
                    </span>
                  </span>
                  <span>·</span>
                  <span>
                    {acceptedCount}/{record.changeSummary.length} edits active
                  </span>
                  {record.baseResume?.title && (
                    <>
                      <span>·</span>
                      <span>Base: {record.baseResume.title}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Three Concise, Tactile Decision Buttons */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant={
                    record.status === "accepted_new" ? "emerald" : "outline"
                  }
                  onClick={() => handleDecision("accepted_new")}
                  disabled={isSavingDecision}
                  className={
                    record.status === "accepted_new"
                      ? "gap-1.5"
                      : "gap-1.5 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/15"
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Use Tailored
                </Button>

                <Button
                  size="sm"
                  variant={
                    record.status === "kept_original" ? "secondary" : "outline"
                  }
                  onClick={() => handleDecision("kept_original")}
                  disabled={isSavingDecision}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Keep Original
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => {
                    const el = document.getElementById("ai-refine-input");
                    el?.focus();
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="gap-1.5"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Refine
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Segmented View Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-secondary/50 p-1 border border-white/[0.06]">
              {(
                [
                  {
                    id: "diff",
                    label: `Changes (${record.changeSummary.length})`,
                    icon: Sparkles,
                  },
                  {
                    id: "side_by_side",
                    label: "Side-by-Side",
                    icon: SplitSquareVertical,
                  },
                  { id: "document", label: "Preview", icon: FileText },
                  { id: "jd", label: "Keywords", icon: Target },
                  { id: "cover_letter", label: "Cover Letter", icon: Mail },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`tactile-pill flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                      active
                        ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_6px_rgba(99,102,241,0.3)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === "document" && (
              <div className="flex items-center gap-1 rounded-lg bg-secondary/50 p-1 border border-white/[0.06] text-xs">
                <button
                  onClick={() => setPreviewVersion("tailored")}
                  className={`tactile-pill px-2.5 py-1 rounded-md font-medium ${
                    previewVersion === "tailored"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Tailored
                </button>
                <button
                  onClick={() => setPreviewVersion("original")}
                  className={`tactile-pill px-2.5 py-1 rounded-md font-medium ${
                    previewVersion === "original"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Original
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content Grid ── */}
        <div className="grid gap-5 lg:grid-cols-12 items-start">
          {/* LEFT 8 COLS: Active Workspace */}
          <div className="lg:col-span-8 space-y-3.5 min-w-0 print:col-span-12">
            {/* TAB 1: DIFF CARDS */}
            {activeTab === "diff" && (
              <div className="space-y-3.5 print:hidden">
                {record.changeSummary.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-xs text-muted-foreground">
                      No edits yet. Use the Refine panel on the right to make
                      specific adjustments.
                    </CardContent>
                  </Card>
                ) : (
                  record.changeSummary.map((chg, idx) => {
                    const isAccepted = chg.accepted !== false;
                    return (
                      <Card
                        key={chg.id || idx}
                        className={`overflow-hidden transition-opacity ${
                          isAccepted ? "" : "opacity-55"
                        }`}
                      >
                        <div className="py-2.5 px-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 bg-white/[0.015]">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge
                              variant={isAccepted ? "success" : "secondary"}
                              className="uppercase text-[10px]"
                            >
                              {chg.section}
                            </Badge>
                            <span className="font-medium text-xs sm:text-sm truncate">
                              {chg.targetLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setSectionTarget(chg.targetLabel);
                                document
                                  .getElementById("ai-refine-input")
                                  ?.focus();
                              }}
                              className="tactile-pill text-[11px] text-indigo-300 hover:text-indigo-200 px-2 py-1 rounded-md hover:bg-primary/10 flex items-center gap-1"
                            >
                              <Wand2 className="h-3 w-3" />
                              Tweak
                            </button>

                            <Button
                              type="button"
                              size="sm"
                              variant={isAccepted ? "outline" : "secondary"}
                              onClick={() => handleToggleChangeItem(chg.id)}
                              className="h-7 px-2.5 text-[11px] gap-1"
                            >
                              {isAccepted ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  Kept
                                </>
                              ) : (
                                <>
                                  <X className="h-3 w-3 text-muted-foreground" />
                                  Reverted
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        <CardContent className="p-4 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* BEFORE */}
                            <div className="min-w-0 rounded-lg border border-rose-500/15 bg-rose-500/[0.04] p-3 space-y-1">
                              <div className="text-[10px] font-medium uppercase tracking-wider text-rose-400/90">
                                Original
                              </div>
                              <p className="text-xs leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">
                                {chg.before
                                  ? renderWordDiff(
                                      chg.before,
                                      chg.after,
                                      "before"
                                    )
                                  : "—"}
                              </p>
                            </div>

                            {/* AFTER */}
                            <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-1">
                              <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400/90">
                                Tailored
                              </div>
                              <p className="text-xs leading-relaxed text-foreground break-words [overflow-wrap:anywhere]">
                                {renderWordDiff(chg.before, chg.after, "after")}
                              </p>
                            </div>
                          </div>

                          {chg.reason && (
                            <p className="text-[11px] text-muted-foreground pl-1 break-words">
                              <span className="text-foreground/80 font-medium">
                                Rationale:
                              </span>{" "}
                              {chg.reason}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}

            {/* TAB 2: SIDE-BY-SIDE */}
            {activeTab === "side_by_side" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 print:hidden">
                {/* Original */}
                <Card className="min-w-0 overflow-hidden">
                  <div className="py-2.5 px-4 border-b border-white/[0.06] bg-secondary/30 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Original Resume
                    </span>
                    <Badge variant="secondary">
                      {record.matchScoreBefore}%
                    </Badge>
                  </div>
                  <CardContent className="p-4 space-y-3.5 text-xs break-words [overflow-wrap:anywhere]">
                    <div>
                      <h4 className="font-semibold text-sm">
                        {record.originalContent.fullName}
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {record.originalContent.contactInfo}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">
                        Summary
                      </h5>
                      <p className="leading-relaxed text-muted-foreground">
                        {record.originalContent.summary}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">
                        Skills
                      </h5>
                      {record.originalContent.skills.map((g, i) => (
                        <p key={i} className="mb-1 text-muted-foreground">
                          <strong className="text-foreground/85">
                            {g.category}:
                          </strong>{" "}
                          {g.items.join(", ")}
                        </p>
                      ))}
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-1.5">
                        Experience
                      </h5>
                      <div className="space-y-3">
                        {record.originalContent.experience.map((exp, i) => (
                          <div key={i} className="space-y-1">
                            <div className="font-medium text-foreground/90">
                              {exp.role} · {exp.company}{" "}
                              {exp.dates && (
                                <span className="text-muted-foreground font-normal">
                                  ({exp.dates})
                                </span>
                              )}
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

                {/* Tailored */}
                <Card className="min-w-0 overflow-hidden border-emerald-500/25">
                  <div className="py-2.5 px-4 border-b border-emerald-500/15 bg-emerald-500/[0.05] flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-300">
                      Tailored ({record.company})
                    </span>
                    <Badge variant="success">
                      {record.matchScoreAfter}%
                    </Badge>
                  </div>
                  <CardContent className="p-4 space-y-3.5 text-xs break-words [overflow-wrap:anywhere]">
                    <div>
                      <h4 className="font-semibold text-sm">
                        {effectiveTailoredResume.fullName}
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {effectiveTailoredResume.contactInfo}
                      </p>
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-emerald-400 mb-1">
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
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-emerald-400 mb-1">
                        Skills
                      </h5>
                      {effectiveTailoredResume.skills.map((g, i) => (
                        <p key={i} className="mb-1">
                          <strong>{g.category}:</strong> {g.items.join(", ")}
                        </p>
                      ))}
                    </div>
                    <div>
                      <h5 className="font-semibold uppercase tracking-wider text-[10px] text-emerald-400 mb-1.5">
                        Experience
                      </h5>
                      <div className="space-y-3">
                        {effectiveTailoredResume.experience.map((exp, i) => {
                          const origExp = record.originalContent.experience[i];
                          return (
                            <div key={i} className="space-y-1">
                              <div className="font-medium">
                                {exp.role} · {exp.company}{" "}
                                {exp.dates && (
                                  <span className="text-muted-foreground font-normal">
                                    ({exp.dates})
                                  </span>
                                )}
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

            {/* TAB 3: CLEAN PRINT / PAPER RESUME PREVIEW */}
            {activeTab === "document" && activeDocumentResume && (
              <div className="min-w-0 rounded-xl border border-white/[0.1] bg-white text-slate-900 p-7 sm:p-10 shadow-2xl print:border-0 print:shadow-none print:p-0 space-y-4 break-words [overflow-wrap:anywhere]">
                {/* Header */}
                <div className="border-b border-slate-200 pb-3.5 text-center">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                    {activeDocumentResume.fullName}
                  </h1>
                  {activeDocumentResume.contactInfo && (
                    <p className="text-xs text-slate-600 mt-1">
                      {activeDocumentResume.contactInfo}
                    </p>
                  )}
                </div>

                {/* Summary */}
                {activeDocumentResume.summary && (
                  <section className="space-y-1.5 group">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-0.5">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Professional Summary
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Professional Summary");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden text-[11px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                      >
                        Refine
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-800">
                      {activeDocumentResume.summary}
                    </p>
                  </section>
                )}

                {/* Skills */}
                {activeDocumentResume.skills.length > 0 && (
                  <section className="space-y-1.5 group">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-0.5">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Technical Skills
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Technical Skills");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden text-[11px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                      >
                        Refine
                      </button>
                    </div>
                    <div className="space-y-1 text-xs text-slate-800">
                      {activeDocumentResume.skills.map((group, idx) => (
                        <div key={idx}>
                          <span className="font-semibold text-slate-900">
                            {group.category}:{" "}
                          </span>
                          <span>{group.items.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Experience */}
                {activeDocumentResume.experience.length > 0 && (
                  <section className="space-y-2.5 group">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-0.5">
                      <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Professional Experience
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSectionTarget("Professional Experience");
                          document.getElementById("ai-refine-input")?.focus();
                        }}
                        className="print:hidden text-[11px] text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                      >
                        Refine
                      </button>
                    </div>
                    <div className="space-y-3">
                      {activeDocumentResume.experience.map((exp, idx) => (
                        <div key={exp.id || idx} className="space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <span className="font-semibold text-xs sm:text-sm text-slate-900">
                                {exp.role}
                              </span>
                              <span className="text-xs font-medium text-slate-700">
                                {" "}
                                · {exp.company}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {[exp.location, exp.dates]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-xs text-slate-800 leading-relaxed">
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
                  <section className="space-y-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-0.5">
                      Projects
                    </h2>
                    <div className="space-y-2.5">
                      {activeDocumentResume.projects.map((proj, idx) => (
                        <div key={proj.id || idx} className="space-y-0.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-semibold text-xs text-slate-900">
                              {proj.name}
                            </span>
                            {proj.techStack && (
                              <span className="text-[11px] text-slate-500">
                                {proj.techStack}
                              </span>
                            )}
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-xs text-slate-800 leading-relaxed">
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
                    <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-0.5">
                      Education
                    </h2>
                    <div className="space-y-1 text-xs text-slate-800">
                      {activeDocumentResume.education.map((edu, idx) => (
                        <div
                          key={edu.id || idx}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">
                              {edu.degree || edu.institution}
                            </span>
                            {edu.degree && edu.institution && (
                              <span> · {edu.institution}</span>
                            )}
                            {edu.details && (
                              <span className="text-slate-600">
                                {" "}
                                ({edu.details})
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500">
                            {edu.dates}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB 4: KEYWORDS & JD */}
            {activeTab === "jd" && (
              <Card className="print:hidden">
                <CardHeader>
                  <CardTitle className="text-sm">Keyword Coverage</CardTitle>
                  <CardDescription>
                    Click any unmatched skill to incorporate it into your
                    resume.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5 space-y-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                        Matched ({record.keywordsMatched.length})
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {record.keywordsMatched.map((kw) => (
                          <Badge key={kw} variant="success">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 space-y-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                        Optional / Unmatched ({record.keywordsMissing.length})
                      </h4>
                      {record.keywordsMissing.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          All core JD skills covered.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {record.keywordsMissing.map((kw) => (
                            <button
                              key={kw}
                              type="button"
                              onClick={() => {
                                setAiInstruction(`Add ${kw}`);
                                document
                                  .getElementById("ai-refine-input")
                                  ?.focus();
                              }}
                              className="tactile-pill px-2 py-0.5 rounded-md text-[11px] border border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                            >
                              + {kw}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-[11px] font-medium text-muted-foreground">
                      Job Description
                    </h4>
                    <pre className="whitespace-pre-wrap break-words rounded-lg border border-white/[0.07] bg-secondary/25 p-3.5 text-xs text-muted-foreground font-sans leading-relaxed max-h-[380px] overflow-y-auto">
                      {record.jobDescription}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* TAB 5: COVER LETTER */}
            {activeTab === "cover_letter" && (
              <Card className="print:hidden">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                    <div>
                      <CardTitle className="text-sm">Cover Letter</CardTitle>
                      <CardDescription>
                        Tailored to {record.company} from your resume.
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={coverLetterTone}
                        onChange={(e) =>
                          setCoverLetterTone(e.target.value as CoverLetterTone)
                        }
                        className="h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs"
                      >
                        <option value="professional">Professional</option>
                        <option value="enthusiastic">Enthusiastic</option>
                        <option value="technical">Technical</option>
                      </select>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await navigator.clipboard.writeText(
                            customCoverLetter
                          );
                          toast.success("Copied");
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
                        TXT
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <textarea
                    rows={16}
                    value={customCoverLetter}
                    onChange={(e) => setCustomCoverLetter(e.target.value)}
                    className="w-full p-3.5 rounded-lg border border-white/[0.08] bg-secondary/30 text-xs sm:text-sm leading-relaxed font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT 4 COLS: Concise Refine & History */}
          <div className="lg:col-span-4 space-y-4 min-w-0 print:hidden">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-primary" />
                  Refine Resume
                </CardTitle>
                <CardDescription>
                  Request targeted edits to any section.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5">
                <form onSubmit={handleAiRefine} className="space-y-2.5">
                  <select
                    value={sectionTarget}
                    onChange={(e) => setSectionTarget(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border border-white/[0.08] bg-secondary/40 text-xs"
                  >
                    <option value="">All Sections</option>
                    <option value="Professional Summary">Summary</option>
                    <option value="Technical Skills">Skills</option>
                    <option value="Professional Experience">Experience</option>
                    <option value="Projects">Projects</option>
                  </select>

                  <textarea
                    id="ai-refine-input"
                    rows={3}
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    placeholder="e.g. Add Docker & AWS, or replace Built with Architected..."
                    className="w-full p-2.5 rounded-lg border border-white/[0.08] bg-secondary/40 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />

                  <Button
                    type="submit"
                    size="sm"
                    disabled={isRefining}
                    className="w-full"
                  >
                    {isRefining ? "Applying..." : "Apply Edit"}
                  </Button>
                </form>

                {/* Concise Quick Chips */}
                <div className="pt-2 border-t border-white/[0.06] flex flex-wrap gap-1.5">
                  {QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setAiInstruction(chip.prompt)}
                      className="tactile-pill px-2.5 py-1 rounded-md text-[11px] bg-secondary/50 border border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-secondary"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Compact History */}
            <Card>
              <CardHeader className="pb-2.5">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  History ({record.revisionHistory.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[260px] overflow-y-auto">
                {record.revisionHistory
                  .slice()
                  .reverse()
                  .map((rev, idx) => (
                    <div
                      key={rev.id}
                      className="p-2.5 rounded-lg border border-white/[0.06] bg-secondary/25 space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground/90 text-[11px]">
                          {idx === 0 ? "Current" : "Saved snapshot"}
                        </span>
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRestoreRevision(rev.id)}
                            className="tactile-pill text-[11px] text-indigo-300 hover:text-indigo-200 font-medium"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 break-words">
                        {rev.prompt}
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
