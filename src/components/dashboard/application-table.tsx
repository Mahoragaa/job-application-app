"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  MessageSquare,
  Minus,
  Inbox,
  ExternalLink,
  Search,
  Plus,
  Download,
  Pencil,
  Trash2,
  Sparkles,
  ArrowUpDown,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatRelativeDate } from "@/lib/utils";

export interface TailoredResumeSummary {
  id: string;
  status: string;
  matchScoreBefore: number;
  matchScoreAfter: number;
  updatedAt: string;
}

export interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  status: string;
  appliedDate: string;
  updatedAt?: string;
  hasReply: boolean;
  replyDate: string | null;
  replySnippet: string | null;
  snippet: string | null;
  emailId: string | null;
  threadId: string | null;
  notes?: string | null;
  jobDescription?: string | null;
  tailoredResumes?: TailoredResumeSummary[];
}

interface ApplicationTableProps {
  applications: ApplicationRow[];
  isLoading: boolean;
  onRefresh: () => void;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "applied", label: "Applied" },
  { value: "reply_received", label: "Reply Received" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
] as const;

function getStatusBadge(status: string) {
  const statusMap: Record<
    string,
    {
      label: string;
      variant:
        | "success"
        | "warning"
        | "destructive"
        | "info"
        | "purple"
        | "secondary";
    }
  > = {
    applied: { label: "Applied", variant: "info" },
    reply_received: { label: "Reply Received", variant: "success" },
    interview: { label: "Interview", variant: "purple" },
    rejected: { label: "Rejected", variant: "destructive" },
    offer: { label: "Offer! 🎉", variant: "warning" },
  };

  const config = statusMap[status] || {
    label: status,
    variant: "secondary" as const,
  };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function getReplyIndicator(hasReply: boolean) {
  if (hasReply) {
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="reply-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <span className="text-emerald-400 font-medium text-sm flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          Reply Received
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" />
      <span className="text-sm">Awaiting</span>
    </div>
  );
}

export function ApplicationTable({
  applications,
  isLoading,
  onRefresh,
}: ApplicationTableProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "company_asc">(
    "date_desc"
  );
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sortBy, pageSize]);

  // Add / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<ApplicationRow | null>(null);
  const [formCompany, setFormCompany] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formStatus, setFormStatus] = useState("applied");
  const [formDate, setFormDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [formNotes, setFormNotes] = useState("");
  const [formJd, setFormJd] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: applications.length };
    for (const app of applications) {
      counts[app.status] = (counts[app.status] || 0) + 1;
    }
    return counts;
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = applications.filter((app) => {
      if (statusFilter !== "all" && app.status !== statusFilter) return false;
      if (!q) return true;
      return (
        app.company.toLowerCase().includes(q) ||
        app.role.toLowerCase().includes(q) ||
        (app.snippet && app.snippet.toLowerCase().includes(q)) ||
        (app.notes && app.notes.toLowerCase().includes(q))
      );
    });

    list.sort((a, b) => {
      if (sortBy === "company_asc") {
        return a.company.localeCompare(b.company);
      }
      const tA = new Date(a.appliedDate).getTime();
      const tB = new Date(b.appliedDate).getTime();
      return sortBy === "date_asc" ? tA - tB : tB - tA;
    });

    return list;
  }, [applications, searchQuery, statusFilter, sortBy]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredApplications.length / pageSize)
  );
  const safePage = Math.min(currentPage, totalPages);
  const paginatedApplications = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredApplications.slice(start, start + pageSize);
  }, [filteredApplications, safePage, pageSize]);

  const openAddModal = () => {
    setEditingApp(null);
    setFormCompany("");
    setFormRole("");
    setFormStatus("applied");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes("");
    setFormJd("");
    setIsModalOpen(true);
  };

  const openEditModal = (app: ApplicationRow) => {
    setEditingApp(app);
    setFormCompany(app.company);
    setFormRole(app.role);
    setFormStatus(app.status);
    setFormDate(new Date(app.appliedDate).toISOString().slice(0, 10));
    setFormNotes(app.notes || "");
    setFormJd(app.jobDescription || "");
    setIsModalOpen(true);
  };

  const handleSaveApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCompany.trim() || !formRole.trim()) {
      toast.error("Company and Role are required");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        company: formCompany.trim(),
        role: formRole.trim(),
        status: formStatus,
        appliedDate: formDate,
        notes: formNotes.trim(),
        jobDescription: formJd.trim(),
      };

      const res = await fetch(
        editingApp ? `/api/applications/${editingApp.id}` : "/api/applications",
        {
          method: editingApp ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save application");
      }

      toast.success(
        editingApp ? "Application updated" : "Application added to tracker"
      );
      setIsModalOpen(false);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRow = async (app: ApplicationRow) => {
    if (!window.confirm(`Delete "${app.role}" at ${app.company}?`)) return;
    try {
      const res = await fetch(`/api/applications/${app.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete application");
      toast.success(`Removed ${app.company}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleExportCsv = () => {
    if (filteredApplications.length === 0) return;
    const headers = [
      "Company",
      "Role",
      "Status",
      "Reply Received",
      "Applied Date",
      "Notes",
    ];
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const rows = filteredApplications.map((a) => [
      escapeCsv(a.company),
      escapeCsv(a.role),
      escapeCsv(a.status),
      escapeCsv(a.hasReply ? "Yes" : "No"),
      escapeCsv(new Date(a.appliedDate).toISOString().slice(0, 10)),
      escapeCsv(a.notes || ""),
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>Loading your job applications...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-[200px]" />
                  <Skeleton className="h-3 w-[300px]" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl">Applications</CardTitle>
              <CardDescription>
                {filteredApplications.length} of {applications.length} job
                {applications.length !== 1 ? "s" : ""} shown
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openAddModal}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add Application
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/resume")}
                className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
              >
                <Sparkles className="h-4 w-4" />
                AI Resume Tailor
              </Button>
              {applications.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  className="gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              )}
            </div>
          </div>

          {/* Search + Sort + Filter Bar */}
          {applications.length > 0 && (
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Search Box */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by company, role, snippet, or notes..."
                    className="w-full h-9 pl-9 pr-8 rounded-md border border-input bg-background/60 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Sort Select */}
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "date_desc" | "date_asc" | "company_asc"
                      )
                    }
                    className="h-9 rounded-md border border-input bg-background/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="date_desc">Newest First</option>
                    <option value="date_asc">Oldest First</option>
                    <option value="company_asc">Company (A–Z)</option>
                  </select>
                </div>
              </div>

              {/* Status Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((tab) => {
                  const count = statusCounts[tab.value] || 0;
                  const active = statusFilter === tab.value;
                  return (
                    <button
                      key={tab.value}
                      onClick={() => setStatusFilter(tab.value)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary/40 text-muted-foreground border-border/50 hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {applications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Inbox className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">
                No applications yet
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
                Click <strong>&quot;Sync Inbox&quot;</strong> to scan your Gmail
                for job application emails, or add one manually.
              </p>
              <Button variant="outline" size="sm" onClick={openAddModal}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add First Application
              </Button>
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No applications match your current filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[220px]">Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[150px]">Reply Status</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[170px]">Tailored Resume</TableHead>
                  <TableHead className="text-right w-[110px]">Date</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedApplications.map((app) => {
                  const latestResume = app.tailoredResumes?.[0];
                  return (
                    <TableRow key={app.id} className="group cursor-default">
                      {/* Company */}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 text-primary font-bold text-sm shrink-0">
                            {app.company.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium leading-none mb-0.5 truncate">
                              {app.company}
                            </p>
                            {(app.notes || app.snippet) && (
                              <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                                {app.notes ? `📝 ${app.notes}` : app.snippet}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      {/* Role */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{app.role}</span>
                          <span className="text-xs text-blue-400 flex items-center gap-1 mt-0.5">
                            <CheckCircle2 className="h-3 w-3" />
                            {app.emailId ? "Synced from Gmail" : "Manual entry"}
                          </span>
                        </div>
                      </TableCell>

                      {/* Reply Status */}
                      <TableCell>{getReplyIndicator(app.hasReply)}</TableCell>

                      {/* Status Badge */}
                      <TableCell>{getStatusBadge(app.status)}</TableCell>

                      {/* Tailored Resume Action / Preview Link */}
                      <TableCell>
                        {latestResume ? (
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/resume/preview/${latestResume.id}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 transition-colors"
                              title="Open Resume Diff & Preview"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>{latestResume.matchScoreAfter}% Fit</span>
                              <span className="text-[10px] opacity-75">
                                (
                                {latestResume.status === "accepted_new"
                                  ? "Accepted"
                                  : latestResume.status === "kept_original"
                                  ? "Old Resume"
                                  : "Preview"}
                                )
                              </span>
                            </Link>
                          </div>
                        ) : (
                          <Link
                            href={`/resume?applicationId=${
                              app.id
                            }&company=${encodeURIComponent(
                              app.company
                            )}&role=${encodeURIComponent(app.role)}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-secondary/60 text-muted-foreground hover:text-primary hover:bg-primary/10 border border-border/50 transition-colors"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Tailor Resume
                          </Link>
                        )}
                      </TableCell>

                      {/* Date */}
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatRelativeDate(new Date(app.appliedDate))}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(app.threadId || app.emailId) && (
                            <a
                              href={`https://mail.google.com/mail/u/0/#all/${
                                app.threadId || app.emailId
                              }`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                              title="Open thread in Gmail"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => openEditModal(app)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit application"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRow(app)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Delete application"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Pagination Footer */}
          {filteredApplications.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-4 border-t border-border/40 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-7 rounded border border-input bg-background px-2 text-xs text-foreground"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span>
                  Showing {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, filteredApplications.length)}{" "}
                  of {filteredApplications.length}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="h-7 px-2.5 text-xs gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <span className="px-2 font-medium text-foreground">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  className="h-7 px-2.5 text-xs gap-1"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Application Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editingApp ? "Edit Application" : "Add Job Application"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveApplication} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Company *
                  </label>
                  <input
                    type="text"
                    required
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="e.g. Stripe"
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Role *
                  </label>
                  <input
                    type="text"
                    required
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    placeholder="e.g. Full Stack Engineer"
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="applied">Applied</option>
                    <option value="reply_received">Reply Received</option>
                    <option value="interview">Interview</option>
                    <option value="offer">Offer</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Applied Date
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Notes (Recruiter name, salary range, next steps)
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional personal notes..."
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Job Description (Optional — used by AI Resume Tailor)
                </label>
                <textarea
                  rows={4}
                  value={formJd}
                  onChange={(e) => setFormJd(e.target.value)}
                  placeholder="Paste the job description here to tailor your resume for this role..."
                  className="w-full p-3 rounded-md border border-input bg-background text-sm resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving
                    ? "Saving..."
                    : editingApp
                    ? "Save Changes"
                    : "Add Application"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
