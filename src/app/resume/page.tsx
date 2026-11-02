"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter, useSearchParams } from "next/navigation";
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
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Briefcase,
  Eye,
  Clock,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import type { StructuredResume, TailorMode } from "@/lib/ai-resume";
import { formatRelativeDate } from "@/lib/utils";

interface BaseResumeRecord {
  id: string;
  title: string;
  fileName: string | null;
  rawText: string;
  structuredData: StructuredResume | null;
  isDefault: boolean;
  updatedAt: string;
}

interface TailoredResumeSummaryItem {
  id: string;
  baseResumeId: string;
  applicationId: string | null;
  company: string;
  role: string;
  tailorMode: string;
  matchScoreBefore: number;
  matchScoreAfter: number;
  status: "draft" | "accepted_new" | "kept_original";
  updatedAt: string;
  keywordsMatched: string[];
}

interface ApplicationOption {
  id: string;
  company: string;
  role: string;
  jobDescription?: string | null;
}

function ResumeStudioContent() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [resumes, setResumes] = useState<BaseResumeRecord[]>([]);
  const [tailoredList, setTailoredList] = useState<TailoredResumeSummaryItem[]>(
    []
  );
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Selected Base Resume
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");

  // Upload / Paste New Resume State
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pastedResumeText, setPastedResumeText] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Job Description & Tailoring Form State
  const [selectedAppId, setSelectedAppId] = useState<string>(
    searchParams.get("applicationId") || ""
  );
  const [company, setCompany] = useState<string>(
    searchParams.get("company") || ""
  );
  const [role, setRole] = useState<string>(searchParams.get("role") || "");
  const [jobDescription, setJobDescription] = useState<string>("");
  const [mode, setMode] = useState<TailorMode>("balanced");
  const [isTailoring, setIsTailoring] = useState(false);
  const [jobUrl, setJobUrl] = useState<string>("");
  const [isScrapingUrl, setIsScrapingUrl] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [resResume, resApps] = await Promise.all([
        fetch("/api/resume"),
        fetch("/api/applications"),
      ]);

      if (resResume.ok) {
        const data = await resResume.json();
        const list: BaseResumeRecord[] = data.resumes || [];
        setResumes(list);
        setTailoredList(data.tailoredResumes || []);
        if (list.length > 0 && !selectedResumeId) {
          const def = list.find((r) => r.isDefault) || list[0];
          setSelectedResumeId(def.id);
        }
        if (list.length === 0) {
          setShowUploadPanel(true);
        }
      }

      if (resApps.ok) {
        const appData = await resApps.json();
        const appList: ApplicationOption[] = appData.applications || [];
        setApplications(appList);

        const paramAppId = searchParams.get("applicationId");
        if (paramAppId) {
          const matched = appList.find((a) => a.id === paramAppId);
          if (matched) {
            setCompany(matched.company);
            setRole(matched.role);
            if (matched.jobDescription) {
              setJobDescription(matched.jobDescription);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to load resume studio data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [searchParams, selectedResumeId]);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      redirect("/");
    }
    if (authStatus === "authenticated") {
      loadData();
    }
  }, [authStatus, loadData]);

  const handleApplicationSelect = (appId: string) => {
    setSelectedAppId(appId);
    if (!appId) return;
    const found = applications.find((a) => a.id === appId);
    if (found) {
      setCompany(found.company);
      setRole(found.role);
      if (found.jobDescription) {
        setJobDescription(found.jobDescription);
      }
    }
  };

  const handleScrapeJobUrl = async () => {
    if (!jobUrl.trim()) {
      toast.error("Please enter a job posting URL first.");
      return;
    }
    setIsScrapingUrl(true);
    const toastId = toast.loading("Fetching job details from URL...");
    try {
      const res = await fetch("/api/resume/scrape-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not extract job description");
      }
      if (data.company) setCompany(data.company);
      if (data.role) setRole(data.role);
      if (data.jobDescription) setJobDescription(data.jobDescription);
      toast.success("Job posting extracted!", {
        id: toastId,
        description: `Loaded ${data.role || "Role"} at ${data.company || "Company"}.`,
      });
    } catch (err) {
      toast.error("Could not auto-fetch URL", {
        id: toastId,
        description:
          err instanceof Error
            ? err.message
            : "Please paste the job description manually.",
      });
    } finally {
      setIsScrapingUrl(false);
    }
  };

  const handleUploadBaseResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile && !pastedResumeText.trim()) {
      toast.error("Please select a file (PDF/DOCX/TXT/MD) or paste your resume text.");
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading("Parsing your resume into structured sections...");

    try {
      const formData = new FormData();
      if (uploadTitle.trim()) formData.append("title", uploadTitle.trim());
      if (uploadFile) formData.append("file", uploadFile);
      if (pastedResumeText.trim()) formData.append("rawText", pastedResumeText.trim());

      const res = await fetch("/api/resume", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse resume");
      }

      toast.success("Resume parsed & saved!", {
        id: toastId,
        description: `Ready to tailor "${data.resume.title}" for any job description.`,
      });

      setUploadTitle("");
      setUploadFile(null);
      setPastedResumeText("");
      setShowUploadPanel(false);
      setSelectedResumeId(data.resume.id);
      await loadData();
    } catch (err) {
      toast.error("Failed to upload resume", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteBaseResume = async (id: string) => {
    if (!window.confirm("Delete this saved base resume?")) return;
    try {
      const res = await fetch(`/api/resume?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete resume");
      toast.success("Resume deleted");
      if (selectedResumeId === id) setSelectedResumeId("");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleTailorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResumeId) {
      toast.error("Please upload or select a base resume first.");
      setShowUploadPanel(true);
      return;
    }
    if (!company.trim() || !role.trim() || !jobDescription.trim()) {
      toast.error("Please enter the target Company, Role, and Job Description.");
      return;
    }

    setIsTailoring(true);
    const toastId = toast.loading(
      `AI is tailoring your resume for ${role.trim()} at ${company.trim()}...`
    );

    try {
      const res = await fetch("/api/resume/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseResumeId: selectedResumeId,
          applicationId: selectedAppId || null,
          company: company.trim(),
          role: role.trim(),
          jobDescription: jobDescription.trim(),
          mode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Tailoring failed");
      }

      toast.success("Tailored resume ready for preview!", {
        id: toastId,
        description: "Opening side-by-side comparison and AI refinement studio...",
      });

      router.push(`/resume/preview/${data.tailoredResumeId}`);
    } catch (err) {
      toast.error("Could not tailor resume", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setIsTailoring(false);
    }
  };

  const selectedResume = resumes.find((r) => r.id === selectedResumeId);

  return (
    <div className="min-h-screen bg-background mesh-gradient">
      <DashboardHeader />

      <main className="container py-8 space-y-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <Sparkles className="h-6 w-6 text-primary" />
              AI Resume Tailor & Fit Studio
            </h2>
            <p className="text-muted-foreground">
              Upload your base resume, paste a job description, and preview
              every AI edit side-by-side before deciding.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowUploadPanel((v) => !v)}
            className="gap-2 self-start sm:self-auto"
          >
            <Upload className="h-4 w-4" />
            {showUploadPanel ? "Hide Uploader" : "Upload New Base Resume"}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-6 lg:grid-cols-12">
            <Skeleton className="h-[420px] lg:col-span-5 rounded-xl" />
            <Skeleton className="h-[420px] lg:col-span-7 rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12 items-start">
            {/* LEFT COLUMN: Base Resume Library & Uploader */}
            <div className="lg:col-span-5 space-y-6">
              {/* Upload / Paste Card */}
              {(showUploadPanel || resumes.length === 0) && (
                <Card className="border-primary/30 shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Upload className="h-4 w-4 text-primary" />
                      Provide Your Base Resume
                    </CardTitle>
                    <CardDescription>
                      Upload a PDF, DOCX, TXT, or Markdown file — or paste your
                      resume text below.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleUploadBaseResume} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Resume Label
                        </label>
                        <input
                          type="text"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          placeholder="e.g. Full Stack Master Resume 2026"
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Upload File (.pdf, .docx, .txt, .md)
                        </label>
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,.md"
                          onChange={(e) =>
                            setUploadFile(e.target.files?.[0] || null)
                          }
                          className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary/15 file:text-primary hover:file:bg-primary/25 cursor-pointer"
                        />
                      </div>

                      <div className="relative flex items-center py-1">
                        <div className="flex-grow border-t border-border" />
                        <span className="flex-shrink mx-3 text-[11px] uppercase text-muted-foreground">
                          or paste resume text
                        </span>
                        <div className="flex-grow border-t border-border" />
                      </div>

                      <textarea
                        rows={7}
                        value={pastedResumeText}
                        onChange={(e) => setPastedResumeText(e.target.value)}
                        placeholder="Paste your full resume text here (Name, Summary, Skills, Experience, Projects, Education)..."
                        className="w-full p-3 rounded-md border border-input bg-background text-xs font-mono resize-y"
                      />

                      <div className="flex justify-end gap-2">
                        {resumes.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowUploadPanel(false)}
                          >
                            Cancel
                          </Button>
                        )}
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isUploading}
                          className="gap-1.5"
                        >
                          <Sparkles className="h-4 w-4" />
                          {isUploading
                            ? "Parsing Resume..."
                            : "Save & Parse Resume"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}

              {/* Saved Base Resumes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    1. Select Base Resume
                  </CardTitle>
                  <CardDescription>
                    Choose which master resume the AI should use as your factual
                    foundation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {resumes.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No base resume uploaded yet. Use the form above to add one.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {resumes.map((r) => {
                        const isSelected = r.id === selectedResumeId;
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedResumeId(r.id)}
                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                              isSelected
                                ? "border-primary bg-primary/10 shadow-sm"
                                : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">
                                  {r.title}
                                </span>
                                {isSelected && (
                                  <Badge variant="info" className="text-[10px]">
                                    Selected
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {r.structuredData?.fullName || "Parsed Resume"} •{" "}
                                {r.structuredData?.experience?.length || 0} roles •{" "}
                                {r.structuredData?.skills?.reduce(
                                  (acc, s) => acc + s.items.length,
                                  0
                                ) || 0}{" "}
                                skills
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBaseResume(r.id);
                              }}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                              title="Delete resume"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Quick Snapshot of Selected Base Resume */}
                  {selectedResume?.structuredData && (
                    <div className="rounded-lg border border-border/60 bg-background/50 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">
                          {selectedResume.structuredData.fullName}
                        </span>
                        <span className="text-muted-foreground">
                          Base Snapshot
                        </span>
                      </div>
                      {selectedResume.structuredData.summary && (
                        <p className="text-muted-foreground line-clamp-3">
                          {selectedResume.structuredData.summary}
                        </p>
                      )}
                      {selectedResume.structuredData.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {selectedResume.structuredData.skills
                            .flatMap((g) => g.items)
                            .slice(0, 10)
                            .map((sk) => (
                              <span
                                key={sk}
                                className="px-2 py-0.5 rounded bg-secondary text-[11px] text-secondary-foreground"
                              >
                                {sk}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* RIGHT COLUMN: Job Description Input & Tailoring Controls */}
            <div className="lg:col-span-7 space-y-6">
              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    2. Target Job Description & AI Tailoring
                  </CardTitle>
                  <CardDescription>
                    Link to an existing tracked application or paste any job
                    description to generate a tailored resume and diff preview.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleTailorSubmit} className="space-y-4">
                    {/* Auto-Fetch from Job Posting URL */}
                    <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-primary" />
                        Auto-Fill from Job Posting URL (Greenhouse, Lever, Ashby, Career Pages)
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="url"
                          value={jobUrl}
                          onChange={(e) => setJobUrl(e.target.value)}
                          placeholder="https://boards.greenhouse.io/company/jobs/..."
                          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-xs"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={isScrapingUrl}
                          onClick={handleScrapeJobUrl}
                          className="h-9 px-4 shrink-0"
                        >
                          {isScrapingUrl ? "Fetching..." : "Auto-Fetch JD"}
                        </Button>
                      </div>
                    </div>

                    {/* Optional Link to Tracked Application */}
                    {applications.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Link to Tracked Application (Optional)
                        </label>
                        <select
                          value={selectedAppId}
                          onChange={(e) =>
                            handleApplicationSelect(e.target.value)
                          }
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                        >
                          <option value="">
                            — Standalone / New Job Application —
                          </option>
                          {applications.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.company} — {app.role}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Target Company *
                        </label>
                        <input
                          type="text"
                          required
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          placeholder="e.g. Anthropic"
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                          Target Role *
                        </label>
                        <input
                          type="text"
                          required
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          placeholder="e.g. Full Stack Product Engineer"
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                        />
                      </div>
                    </div>

                    {/* Tailoring Intensity Mode */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Tailoring Strategy
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {(
                          [
                            {
                              id: "conservative",
                              title: "Conservative",
                              desc: "Summary + skill ordering & light keyword polish",
                            },
                            {
                              id: "balanced",
                              title: "Balanced (Recommended)",
                              desc: "Summary, ATS skills & high-impact bullet rewrites",
                            },
                            {
                              id: "aggressive",
                              title: "Deep Alignment",
                              desc: "Reframe all relevant bullets & skills around JD",
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            onClick={() => setMode(opt.id)}
                            className={`text-left p-3 rounded-lg border transition-all ${
                              mode === opt.id
                                ? "border-primary bg-primary/10 shadow-sm"
                                : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
                            }`}
                          >
                            <div className="text-xs font-semibold">
                              {opt.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {opt.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Job Description Textarea */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Job Description *
                      </label>
                      <textarea
                        required
                        rows={9}
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste the full Job Description (responsibilities, requirements, preferred qualifications, tech stack)..."
                        className="w-full p-3 rounded-md border border-input bg-background text-sm resize-y"
                      />
                    </div>

                    <div className="flex items-center justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={isTailoring || !selectedResumeId}
                        className="gap-2 px-6"
                      >
                        <Sparkles className="h-4 w-4" />
                        {isTailoring
                          ? "Tailoring Resume & Building Diff..."
                          : "Tailor Resume & Open Preview"}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Recent Tailored Resumes History */}
        {tailoredList.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Tailored Resumes & Preview Sessions
              </CardTitle>
              <CardDescription>
                Re-open any tailored resume to inspect diffs, make specific AI
                edits, or switch between the new and original version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tailoredList.map((item) => (
                  <Link
                    key={item.id}
                    href={`/resume/preview/${item.id}`}
                    className="group flex flex-col justify-between p-4 rounded-xl border border-border/60 bg-secondary/20 hover:border-primary/50 hover:bg-secondary/40 transition-all"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-sm group-hover:text-primary transition-colors">
                            {item.company}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {item.role}
                          </p>
                        </div>
                        {item.status === "accepted_new" ? (
                          <Badge variant="success" className="text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Using New
                          </Badge>
                        ) : item.status === "kept_original" ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Using Old
                          </Badge>
                        ) : (
                          <Badge variant="purple" className="text-[10px]">
                            In Review
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs pt-1">
                        <span className="text-muted-foreground">ATS Match:</span>
                        <span className="text-muted-foreground line-through">
                          {item.matchScoreBefore}%
                        </span>
                        <ArrowRight className="h-3 w-3 text-emerald-400" />
                        <span className="font-bold text-emerald-400">
                          {item.matchScoreAfter}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 mt-3 border-t border-border/40 text-xs text-muted-foreground">
                      <span>{formatRelativeDate(new Date(item.updatedAt))}</span>
                      <span className="inline-flex items-center gap-1 text-primary font-medium">
                        <Eye className="h-3.5 w-3.5" />
                        Preview & Edit
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function ResumePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ResumeStudioContent />
    </Suspense>
  );
}
