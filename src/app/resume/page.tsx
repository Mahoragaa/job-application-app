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
  ArrowRight,
  Sparkles,
  Briefcase,
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

  const [selectedResumeId, setSelectedResumeId] = useState<string>("");

  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pastedResumeText, setPastedResumeText] = useState("");
  const [isUploading, setIsUploading] = useState(false);

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
      toast.error("Paste a job URL first");
      return;
    }
    setIsScrapingUrl(true);
    const toastId = toast.loading("Fetching job details...");
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
      toast.success("Job details imported", {
        id: toastId,
        description: `${data.role || "Role"} · ${data.company || "Company"}`,
      });
    } catch (err) {
      toast.error("Could not fetch URL", {
        id: toastId,
        description:
          err instanceof Error
            ? err.message
            : "Paste the job description below instead.",
      });
    } finally {
      setIsScrapingUrl(false);
    }
  };

  const handleUploadBaseResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile && !pastedResumeText.trim()) {
      toast.error("Choose a file or paste your resume text");
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading("Parsing resume...");

    try {
      const formData = new FormData();
      if (uploadTitle.trim()) formData.append("title", uploadTitle.trim());
      if (uploadFile) formData.append("file", uploadFile);
      if (pastedResumeText.trim())
        formData.append("rawText", pastedResumeText.trim());

      const res = await fetch("/api/resume", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse resume");
      }

      toast.success("Resume saved", { id: toastId });

      setUploadTitle("");
      setUploadFile(null);
      setPastedResumeText("");
      setShowUploadPanel(false);
      setSelectedResumeId(data.resume.id);
      await loadData();
    } catch (err) {
      toast.error("Upload failed", {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteBaseResume = async (id: string) => {
    if (!window.confirm("Remove this base resume?")) return;
    try {
      const res = await fetch(`/api/resume?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Resume removed");
      if (selectedResumeId === id) setSelectedResumeId("");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleTailorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResumeId) {
      toast.error("Select or upload a base resume first");
      setShowUploadPanel(true);
      return;
    }
    if (!company.trim() || !role.trim() || !jobDescription.trim()) {
      toast.error("Company, role, and job description are required");
      return;
    }

    setIsTailoring(true);
    const toastId = toast.loading("Tailoring resume...");

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

      toast.success("Ready for review", { id: toastId });
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

      <main className="container py-7 space-y-6">
        {/* Minimal Header */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Resume Studio
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Align your resume to any job description and inspect every edit
              before exporting.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUploadPanel((v) => !v)}
            className="gap-1.5 self-start sm:self-auto"
          >
            <Upload className="h-3.5 w-3.5" />
            {showUploadPanel ? "Close Uploader" : "New Base Resume"}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-5 lg:grid-cols-12">
            <Skeleton className="h-[380px] lg:col-span-5 rounded-xl" />
            <Skeleton className="h-[380px] lg:col-span-7 rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-12 items-start">
            {/* LEFT: Base Resume Library */}
            <div className="lg:col-span-5 space-y-5 min-w-0">
              {(showUploadPanel || resumes.length === 0) && (
                <Card className="border-primary/25">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Upload className="h-4 w-4 text-primary" />
                      Add Base Resume
                    </CardTitle>
                    <CardDescription>
                      Upload PDF, DOCX, TXT, or Markdown — or paste text.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleUploadBaseResume} className="space-y-3.5">
                      <input
                        type="text"
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        placeholder="Label (e.g. Software Engineer Resume)"
                        className="w-full h-8 px-3 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />

                      <input
                        type="file"
                        accept=".pdf,.docx,.txt,.md"
                        onChange={(e) =>
                          setUploadFile(e.target.files?.[0] || null)
                        }
                        className="w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/15 file:text-indigo-300 hover:file:bg-primary/25 cursor-pointer"
                      />

                      <div className="relative flex items-center py-0.5">
                        <div className="flex-grow border-t border-white/[0.07]" />
                        <span className="mx-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          or paste text
                        </span>
                        <div className="flex-grow border-t border-white/[0.07]" />
                      </div>

                      <textarea
                        rows={5}
                        value={pastedResumeText}
                        onChange={(e) => setPastedResumeText(e.target.value)}
                        placeholder="Paste full resume text..."
                        className="w-full p-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                          <Sparkles className="h-3.5 w-3.5" />
                          {isUploading ? "Parsing..." : "Save Resume"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Base Resume
                  </CardTitle>
                  <CardDescription>
                    Select the master resume to tailor from.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3.5">
                  {resumes.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      Upload a base resume above to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {resumes.map((r) => {
                        const isSelected = r.id === selectedResumeId;
                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedResumeId(r.id)}
                            className={`tactile-pill flex items-center justify-between p-3 rounded-lg border cursor-pointer ${
                              isSelected
                                ? "border-primary/50 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                                : "border-white/[0.07] bg-secondary/25 hover:bg-secondary/50"
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-xs sm:text-sm truncate">
                                  {r.title}
                                </span>
                                {isSelected && (
                                  <Badge variant="purple">Active</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {r.structuredData?.fullName || "Resume"} ·{" "}
                                {r.structuredData?.experience?.length || 0} roles ·{" "}
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
                              className="tactile-pill p-1.5 rounded-md text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedResume?.structuredData && (
                    <div className="rounded-lg border border-white/[0.07] bg-secondary/25 p-3.5 space-y-2.5 text-xs min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground truncate">
                          {selectedResume.structuredData.fullName}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                          Snapshot
                        </span>
                      </div>
                      {selectedResume.structuredData.summary && (
                        <p className="text-muted-foreground text-[11px] leading-relaxed line-clamp-3 break-words [overflow-wrap:anywhere]">
                          {selectedResume.structuredData.summary}
                        </p>
                      )}
                      {selectedResume.structuredData.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {selectedResume.structuredData.skills
                            .flatMap((g) => g.items)
                            .slice(0, 9)
                            .map((sk) => (
                              <span
                                key={sk}
                                className="px-2 py-0.5 rounded-md bg-secondary/80 border border-white/[0.05] text-[10px] text-muted-foreground"
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

            {/* RIGHT: Target Job Description */}
            <div className="lg:col-span-7 min-w-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    Target Role & Job Description
                  </CardTitle>
                  <CardDescription>
                    Import from a URL, pick a tracked role, or paste the job
                    description.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleTailorSubmit} className="space-y-4">
                    {/* Compact URL Auto-Fill */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="url"
                          value={jobUrl}
                          onChange={(e) => setJobUrl(e.target.value)}
                          placeholder="Paste job posting URL to auto-fill (optional)..."
                          className="w-full h-8 pl-8 pr-3 rounded-lg border border-white/[0.08] bg-secondary/35 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isScrapingUrl}
                        onClick={handleScrapeJobUrl}
                        className="shrink-0"
                      >
                        {isScrapingUrl ? "Fetching..." : "Auto-Fill"}
                      </Button>
                    </div>

                    {applications.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Link Tracked Application (Optional)
                        </label>
                        <select
                          value={selectedAppId}
                          onChange={(e) =>
                            handleApplicationSelect(e.target.value)
                          }
                          className="w-full h-8 px-2.5 rounded-lg border border-white/[0.08] bg-secondary/35 text-xs"
                        >
                          <option value="">Standalone Role</option>
                          {applications.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.company} — {app.role}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Company
                        </label>
                        <input
                          type="text"
                          required
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          placeholder="Smartsheet"
                          className="w-full h-8 px-2.5 rounded-lg border border-white/[0.08] bg-secondary/35 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Role
                        </label>
                        <input
                          type="text"
                          required
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          placeholder="Software Engineer"
                          className="w-full h-8 px-2.5 rounded-lg border border-white/[0.08] bg-secondary/35 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    </div>

                    {/* Concise Tactile Mode Selector */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Tailoring Depth
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            {
                              id: "conservative",
                              title: "Light",
                              desc: "Summary & skill order",
                            },
                            {
                              id: "balanced",
                              title: "Balanced",
                              desc: "Summary, skills & key bullets",
                            },
                            {
                              id: "aggressive",
                              title: "Deep",
                              desc: "Full role alignment",
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            onClick={() => setMode(opt.id)}
                            className={`tactile-pill text-left p-2.5 rounded-lg border ${
                              mode === opt.id
                                ? "border-primary/50 bg-primary/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                                : "border-white/[0.07] bg-secondary/25 hover:bg-secondary/45"
                            }`}
                          >
                            <div className="text-xs font-medium">
                              {opt.title}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {opt.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Job Description
                      </label>
                      <textarea
                        required
                        rows={8}
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste responsibilities, requirements, and tech stack..."
                        className="w-full p-3 rounded-lg border border-white/[0.08] bg-secondary/35 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="flex justify-end pt-1">
                      <Button
                        type="submit"
                        disabled={isTailoring || !selectedResumeId}
                        className="gap-2 px-5"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isTailoring ? "Tailoring..." : "Tailor & Preview"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        {tailoredList.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Recent Sessions</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tailoredList.map((item) => (
                <Link
                  key={item.id}
                  href={`/resume/preview/${item.id}`}
                  className="tactile-card group flex flex-col justify-between p-4 rounded-xl border border-white/[0.07] bg-card/85 hover:border-white/[0.16]"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm truncate group-hover:text-indigo-300 transition-colors">
                          {item.company}
                        </h4>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.role}
                        </p>
                      </div>
                      {item.status === "accepted_new" ? (
                        <Badge variant="success">Tailored</Badge>
                      ) : item.status === "kept_original" ? (
                        <Badge variant="secondary">Original</Badge>
                      ) : (
                        <Badge variant="purple">Draft</Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs pt-0.5">
                      <span className="text-muted-foreground">
                        {item.matchScoreBefore}%
                      </span>
                      <ArrowRight className="h-3 w-3 text-emerald-400" />
                      <span className="font-semibold text-emerald-400">
                        {item.matchScoreAfter}% Fit
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/[0.05] text-[11px] text-muted-foreground">
                    <span>{formatRelativeDate(new Date(item.updatedAt))}</span>
                    <span className="text-foreground/80 group-hover:text-foreground font-medium">
                      Open →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
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
