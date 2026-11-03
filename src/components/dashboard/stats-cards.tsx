"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, MessageSquareText, TrendingUp, Clock } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";

interface Application {
  id: string;
  status: string;
  hasReply: boolean;
  appliedDate: string;
  updatedAt?: string;
}

interface StatsCardsProps {
  applications: Application[];
  lastSyncTime: Date | null;
}

export function StatsCards({ applications, lastSyncTime }: StatsCardsProps) {
  const totalApplications = applications.length;
  const totalReplies = applications.filter((a) => a.hasReply).length;
  const interviewRate =
    totalApplications > 0
      ? Math.round(
          (applications.filter(
            (a) => a.status === "interview" || a.status === "offer"
          ).length /
            totalApplications) *
            100
        )
      : 0;

  const stats = [
    {
      title: "Applied",
      value: totalApplications,
      icon: Briefcase,
      sub: "Total tracked",
      accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    },
    {
      title: "Replies",
      value: totalReplies,
      icon: MessageSquareText,
      sub: totalReplies > 0 ? "Active threads" : "Awaiting updates",
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    },
    {
      title: "Interview Rate",
      value: `${interviewRate}%`,
      icon: TrendingUp,
      sub: "Interviews & offers",
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      title: "Last Sync",
      value: lastSyncTime ? formatRelativeDate(lastSyncTime) : "Never",
      icon: Clock,
      sub: lastSyncTime
        ? lastSyncTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Ready to sync",
      accent: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    },
  ];

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.title}
          className="tactile-card hover:border-white/[0.14]"
        >
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {stat.title}
              </p>
              <p className="text-2xl font-semibold tracking-tight text-foreground truncate">
                {stat.value}
              </p>
              <p className="text-[11px] text-muted-foreground/80 truncate">
                {stat.sub}
              </p>
            </div>
            <div
              className={`p-2.5 rounded-lg border shrink-0 ${stat.accent}`}
            >
              <stat.icon className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
