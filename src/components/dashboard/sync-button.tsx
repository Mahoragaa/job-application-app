"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { dayRangeToEpoch } from "@/lib/dates";

interface SyncButtonProps {
  onSyncComplete: () => void;
  fromDate: string; // local ISO: YYYY-MM-DD
  toDate: string;   // local ISO: YYYY-MM-DD
  /** Server-side time of the last successful sync (null = never) */
  lastSyncAt: Date | null;
  /** Auto-sync only starts once initial data (incl. lastSyncAt) has loaded */
  autoSyncEnabled: boolean;
  /** Disables manual sync when the selected range is invalid */
  disabled?: boolean;
}

interface SyncResponse {
  error?: string;
  processed?: number;
  newApplications?: number;
  newReplies?: number;
  remaining?: number;
  truncated?: boolean;
  errorCount?: number;
  errors?: string[];
  labelErrors?: string[];
}

const MAX_ROUNDS = 10;                        // up to 10 × 200 emails per click
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_SYNC_MIN_RETRY_MS = 30 * 60 * 1000; // don't retry failed auto-syncs more often
const AUTO_SYNC_CHECK_MS = 60 * 1000;
const DAY_SEC = 24 * 60 * 60;
const DEFAULT_RANGE_SEC = 180 * DAY_SEC;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SyncButton({
  onSyncComplete,
  fromDate,
  toDate,
  lastSyncAt,
  autoSyncEnabled,
  disabled = false,
}: SyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  /**
   * Runs a sync for [after, before) (epoch seconds). Automatically continues
   * in rounds while the server reports remaining unprocessed emails.
   */
  const runSync = async (after: number, before: number, isAuto: boolean) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    const toastId = isAuto
      ? undefined
      : toast.loading("Syncing your inbox...", {
          description: `Scanning ${fromDate} → ${toDate}`,
        });

    const totals = { processed: 0, newApplications: 0, newReplies: 0, errorCount: 0 };
    const errorSamples: string[] = [];
    let remaining = 0;
    let truncated = false;

    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ after, before }),
        });
        const data: SyncResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Sync failed");
        }

        totals.processed += data.processed || 0;
        totals.newApplications += data.newApplications || 0;
        totals.newReplies += data.newReplies || 0;
        totals.errorCount += (data.errorCount || 0) + (data.labelErrors?.length || 0);
        errorSamples.push(...(data.errors || []), ...(data.labelErrors || []));
        remaining = data.remaining || 0;
        truncated = !!data.truncated;

        // Stop when done, or when a round made no progress (e.g. persistent errors)
        if (remaining === 0 || !data.processed) break;

        if (toastId !== undefined) {
          toast.loading("Syncing your inbox...", {
            id: toastId,
            description: `Processed ${totals.processed} so far, ${remaining} remaining…`,
          });
        }
      }

      if (!isAuto) {
        const parts = [
          plural(totals.newApplications, "new application", "new applications"),
          plural(totals.newReplies, "new reply", "new replies"),
        ];
        if (remaining > 0) parts.push(`${remaining} more remaining — sync again to continue`);
        if (truncated) parts.push("range has 5000+ matches — narrow it to scan everything");

        toast.success("Sync complete!", {
          id: toastId,
          description: parts.join(", "),
          duration: 6000,
        });

        if (totals.errorCount > 0) {
          toast.warning(
            `${plural(totals.errorCount, "email", "emails")} couldn't be processed`,
            {
              description: `${errorSamples[0] ?? "Unknown error"}${totals.errorCount > 1 ? " (and others)" : ""}. They'll be retried on the next sync.`,
              duration: 8000,
            }
          );
        }
      }

      onSyncComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      if (!isAuto) {
        toast.error("Sync failed", { id: toastId, description: message, duration: 5000 });
      } else {
        console.warn("Auto-sync failed:", message);
      }
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  };

  const handleManualSync = () => {
    const range = dayRangeToEpoch(fromDate, toDate);
    if (!range) {
      toast.error("Invalid date range", { description: "Check the From / To dates." });
      return;
    }
    runSync(range.after, range.before, false);
  };

  // Always call the latest closure from the interval (avoids stale props)
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  const lastSyncRef = useRef(lastSyncAt);
  lastSyncRef.current = lastSyncAt;

  // ── Incremental auto-sync (independent of the date-range picker) ──
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const checkAutoSync = () => {
      if (isSyncingRef.current) return;

      const now = Date.now();
      const lastAttempt = Number(localStorage.getItem("lastAutoSyncAttempt") || 0);
      if (now - lastAttempt < AUTO_SYNC_MIN_RETRY_MS) return;

      const last = lastSyncRef.current;
      if (last && now - last.getTime() < AUTO_SYNC_INTERVAL_MS) return;

      localStorage.setItem("lastAutoSyncAttempt", String(now));
      const nowSec = Math.floor(now / 1000);
      // Re-scan one day of overlap since the last sync; first-ever sync uses the default range
      const after = last
        ? Math.floor(last.getTime() / 1000) - DAY_SEC
        : nowSec - DEFAULT_RANGE_SEC;
      runSyncRef.current(after, nowSec + 60, true);
    };

    checkAutoSync();
    const interval = setInterval(checkAutoSync, AUTO_SYNC_CHECK_MS);
    return () => clearInterval(interval);
  }, [autoSyncEnabled]);

  return (
    <Button
      id="sync-inbox-button"
      onClick={handleManualSync}
      disabled={isSyncing || disabled}
      className="relative group gap-2 px-5"
    >
      <RefreshCw
        className={`h-4 w-4 transition-transform duration-700 ${
          isSyncing ? "animate-spin" : "group-hover:rotate-180"
        }`}
      />
      {isSyncing ? "Syncing..." : "Sync Inbox"}

      {/* Animated gradient border on hover */}
      {!isSyncing && (
        <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-violet-600/20 via-purple-600/20 to-violet-600/20 -z-10 blur-sm" />
      )}
    </Button>
  );
}
