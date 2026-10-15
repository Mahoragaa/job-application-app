"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { ApplicationTable } from "@/components/dashboard/application-table";
import { SyncButton } from "@/components/dashboard/sync-button";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { localISODateDaysAgo, toLocalISODate, validateDateRange } from "@/lib/dates";

interface Application {
  id: string;
  company: string;
  role: string;
  status: string;
  appliedDate: string;
  hasReply: boolean;
  replyDate: string | null;
  replySnippet: string | null;
  snippet: string | null;
  emailId: string | null;
  threadId: string | null;
  updatedAt: string;
}

export default function DashboardPage() {
  const { status: sessionStatus } = useSession();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // Date range state (local calendar dates) — default: last 6 months → today
  const [fromDate, setFromDate] = useState(() => localISODateDaysAgo(180));
  const [toDate, setToDate] = useState(() => toLocalISODate());
  const rangeError = useMemo(() => validateDateRange(fromDate, toDate), [fromDate, toDate]);

  const fetchApplications = useCallback(async () => {
    try {
      const response = await fetch("/api/applications", { cache: "no-store" });
      if (response.ok) {
        const data: { applications: Application[]; lastSyncAt: string | null } =
          await response.json();
        setApplications(data.applications);
        setLastSyncTime(data.lastSyncAt ? new Date(data.lastSyncAt) : null);
      }
    } catch (error) {
      console.error("Failed to fetch applications:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      fetchApplications();
    }
  }, [sessionStatus, fetchApplications]);

  // Redirect to home if not authenticated
  if (sessionStatus === "unauthenticated") {
    redirect("/");
  }

  // Loading session
  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const handleSyncComplete = () => {
    fetchApplications(); // also refreshes lastSyncAt from the server
  };

  const handleClearAll = async () => {
    if (
      !window.confirm(
        `This will permanently delete all ${applications.length} tracked application${applications.length !== 1 ? "s" : ""} and reset your processed email history. Are you sure?`
      )
    ) {
      return;
    }

    setIsClearing(true);
    const toastId = toast.loading("Clearing all data...");

    try {
      const response = await fetch("/api/applications", { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Clear failed");
      }

      toast.success("All data cleared", {
        id: toastId,
        description: `Removed ${data.deletedApplications} application${data.deletedApplications !== 1 ? "s" : ""}. Sync again to re-import.`,
        duration: 5000,
      });

      fetchApplications(); // will now return []
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      toast.error("Clear failed", { id: toastId, description: message, duration: 5000 });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background mesh-gradient">
      <DashboardHeader />

      <main className="container py-8 space-y-8">
        {/* ── Top Bar: Title + Controls ─────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">
              Track and manage your job applications
            </p>
          </div>

          {/* Controls row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {/* Date Range Picker */}
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onFromChange={setFromDate}
              onToChange={setToDate}
              error={rangeError}
            />

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <SyncButton
                onSyncComplete={handleSyncComplete}
                fromDate={fromDate}
                toDate={toDate}
                lastSyncAt={lastSyncTime}
                autoSyncEnabled={!isLoading}
                disabled={!!rangeError}
              />

              {applications.length > 0 && (
                <Button
                  id="clear-all-button"
                  variant="outline"
                  onClick={handleClearAll}
                  disabled={isClearing}
                  className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/60 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {isClearing ? "Clearing..." : "Clear"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats Cards ────────────────────────── */}
        <StatsCards
          applications={applications}
          lastSyncTime={lastSyncTime}
        />

        {/* ── Application Table ──────────────────── */}
        <ApplicationTable
          applications={applications}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}
