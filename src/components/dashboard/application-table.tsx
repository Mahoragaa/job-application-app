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
  { value: "reply_received", label: "Replied" },
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
    reply_received: { label: "Replied", variant: "success" },
    interview: { label: "Interview", variant: "purple" },
    rejected: { label: "Rejected", variant: "destructive" },
    offer: { label: "Offer", variant: "warning" },
  };

  const config = statusMap[status] || {
    label: status,
    variant: "secondary" as const,
  };

  return <Badge variant={config.variant}>{config.label}</Badge>;
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
      toast.error("Company and role are required");
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
        throw new Error(err.error || "Failed to save");
      }

      toast.success(editingApp ? "Updated" : "Application added");
      setIsModalOpen(false);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRow = async (app: ApplicationRow) => {
    if (!window.confirm(`Remove "${app.role}" at ${app.company}?`)) return;
    try {
      const res = await fetch(`/api/applications/${app.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success(`Removed ${app.company}`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleExportCsv = () => {
    if (filteredApplications.length === 0) return;
    const headers = ["Company", "Role", "Status", "Replied", "Date", "Notes"];
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
    link.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
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
              <CardTitle className="text-base">Applications</CardTitle>
              <CardDescription>
                {filteredApplications.length} of {applications.length} tracked
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={openAddModal} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add Job
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/resume")}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Tailor Resume
              </Button>
              {applications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportCsv}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              )}
            </div>
          </div>

          {applications.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by company, role, or notes..."
                    className="w-full h-8 pl-8 pr-8 rounded-lg border border-white/[0.08] bg-secondary/40 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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

                {/* Sort */}
                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "date_desc" | "date_asc" | "company_asc"
                      )
                    }
                    className="h-8 rounded-lg border border-white/[0.08] bg-secondary/40 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="date_desc">Newest</option>
                    <option value="date_asc">Oldest</option>
                    <option value="company_asc">Company A–Z</option>
                  </select>
                </div>
              </div>

              {/* Tactile Filter Pills */}
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((tab) => {
                  const count = statusCounts[tab.value] || 0;
                  const active = statusFilter === tab.value;
                  return (
                    <button
                      key={tab.value}
                      onClick={() => setStatusFilter(tab.value)}
                      className={`tactile-pill px-2.5 py-1 rounded-md text-[11px] font-medium border ${
                        active
                          ? "bg-primary text-primary-foreground border-primary/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                          : "bg-secondary/35 text-muted-foreground border-white/[0.06] hover:text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      {tab.label} · {count}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {applications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="rounded-xl bg-secondary/60 border border-white/[0.06] p-3.5 mb-3">
                <Inbox className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold mb-1">No applications yet</h3>
              <p className="text-xs text-muted-foreground text-center max-w-xs mb-4">
                Sync your Gmail inbox or log a role manually to start tracking.
              </p>
              <Button variant="outline" size="sm" onClick={openAddModal}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Application
              </Button>
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">
              No matching applications found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/[0.06]">
                  <TableHead className="w-[210px] text-xs">Company</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="w-[115px] text-xs">Status</TableHead>
                  <TableHead className="w-[145px] text-xs">Resume</TableHead>
                  <TableHead className="text-right w-[100px] text-xs">
                    Applied
                  </TableHead>
                  <TableHead className="w-[105px] text-right text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedApplications.map((app) => {
                  const latestResume = app.tailoredResumes?.[0];
                  return (
                    <TableRow
                      key={app.id}
                      className="group border-white/[0.05] hover:bg-white/[0.02]"
                    >
                      {/* Company */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary/80 border border-white/[0.08] text-foreground font-semibold text-xs shrink-0">
                            {app.company.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-sm leading-none truncate">
                                {app.company}
                              </p>
                              {app.hasReply && (
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"
                                  title="Reply received"
                                />
                              )}
                            </div>
                            {(app.notes || app.snippet) && (
                              <p className="text-[11px] text-muted-foreground truncate max-w-[155px] mt-1">
                                {app.notes || app.snippet}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      {/* Role */}
                      <TableCell className="py-3">
                        <span className="text-xs sm:text-sm font-medium text-foreground/90">
                          {app.role}
                        </span>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-3">
                        {getStatusBadge(app.status)}
                      </TableCell>

                      {/* Resume Fit / Tailor Action */}
                      <TableCell className="py-3">
                        {latestResume ? (
                          <Link
                            href={`/resume/preview/${latestResume.id}`}
                            className="tactile-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-500/12 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/20"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>{latestResume.matchScoreAfter}% Fit</span>
                          </Link>
                        ) : (
                          <Link
                            href={`/resume?applicationId=${
                              app.id
                            }&company=${encodeURIComponent(
                              app.company
                            )}&role=${encodeURIComponent(app.role)}`}
                            className="tactile-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-secondary/50 text-muted-foreground hover:text-foreground border border-white/[0.07] hover:border-white/[0.15]"
                          >
                            <Sparkles className="h-3 w-3 text-primary" />
                            Tailor
                          </Link>
                        )}
                      </TableCell>

                      {/* Date */}
                      <TableCell className="py-3 text-right text-muted-foreground text-xs">
                        {formatRelativeDate(new Date(app.appliedDate))}
                      </TableCell>

                      {/* Row Actions */}
                      <TableCell className="py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                          {(app.threadId || app.emailId) && (
                            <a
                              href={`https://mail.google.com/mail/u/0/#all/${
                                app.threadId || app.emailId
                              }`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tactile-pill inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/[0.07] text-muted-foreground hover:text-foreground"
                              title="Open in Gmail"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => openEditModal(app)}
                            className="tactile-pill inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-white/[0.07] text-muted-foreground hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRow(app)}
                            className="tactile-pill inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-rose-500/15 text-muted-foreground hover:text-rose-400"
                            title="Delete"
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

          {/* Pagination */}
          {filteredApplications.length > pageSize && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-3 border-t border-white/[0.06] text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-7 rounded-md border border-white/[0.08] bg-secondary/50 px-2 text-xs text-foreground"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span>
                  {(safePage - 1) * pageSize + 1}–
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
                  Prev
                </Button>
                <span className="px-2 font-medium text-foreground">
                  {safePage} / {totalPages}
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

      {/* Clean Add / Edit Application Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-white/[0.1] bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingApp ? "Edit Application" : "New Application"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="tactile-pill p-1 rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveApplication} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Company
                  </label>
                  <input
                    type="text"
                    required
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="Stripe"
                    className="w-full h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Role
                  </label>
                  <input
                    type="text"
                    required
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    placeholder="Software Engineer"
                    className="w-full h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs"
                  >
                    <option value="applied">Applied</option>
                    <option value="reply_received">Replied</option>
                    <option value="interview">Interview</option>
                    <option value="offer">Offer</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Notes
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional recruiter or interview notes..."
                  className="w-full h-8 px-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Job Description (Optional)
                </label>
                <textarea
                  rows={3}
                  value={formJd}
                  onChange={(e) => setFormJd(e.target.value)}
                  placeholder="Paste JD to tailor your resume..."
                  className="w-full p-2.5 rounded-lg border border-white/[0.1] bg-secondary/40 text-xs resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSaving}>
                  {isSaving ? "Saving..." : editingApp ? "Save" : "Add"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
