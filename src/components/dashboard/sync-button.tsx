"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface SyncButtonProps {
  onSyncComplete: () => void;
  fromDate?: string; // ISO: YYYY-MM-DD
  toDate?: string;   // ISO: YYYY-MM-DD
}

export function SyncButton({ onSyncComplete, fromDate, toDate }: SyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async (isAuto = false) => {
    setIsSyncing(true);
    let toastId;
    if (!isAuto) {
      const rangeDesc =
        fromDate && toDate
          ? `Scanning ${fromDate} → ${toDate}`
          : "Scanning emails and classifying with AI";
      toastId = toast.loading("Syncing your inbox...", {
        description: rangeDesc,
      });
    }

    try {
      const body: Record<string, string> = {};
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;

      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sync failed");
      }

      if (!isAuto) {
        toast.success("Sync complete!", {
          id: toastId,
          description: `${data.newApplications || 0} new application${data.newApplications !== 1 ? "s" : ""}, ${data.newReplies || 0} new repl${data.newReplies !== 1 ? "ies" : "y"}`,
          duration: 5000,
        });
      }

      localStorage.setItem("lastSyncTime", Date.now().toString());
      onSyncComplete();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An error occurred";
      if (!isAuto) {
        toast.error("Sync failed", {
          id: toastId,
          description: message,
          duration: 5000,
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-sync logic (every 6 hours) — skipped when date range is active
  useEffect(() => {
    if (fromDate || toDate) return;

    const checkAutoSync = () => {
      const lastSync = localStorage.getItem("lastSyncTime");
      const sixHoursMs = 6 * 60 * 60 * 1000;

      if (!lastSync || Date.now() - parseInt(lastSync, 10) > sixHoursMs) {
        handleSync(true); // Silent auto-sync
      }
    };

    // Check on mount
    checkAutoSync();

    // Check every minute
    const interval = setInterval(checkAutoSync, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Button
      onClick={() => handleSync(false)}
      disabled={isSyncing}
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
