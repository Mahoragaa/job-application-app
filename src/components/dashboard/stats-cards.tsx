"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Briefcase,
  MessageSquareText,
  TrendingUp,
  Clock,
} from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";

interface Application {
  id: string;
  status: string;
  hasReply: boolean;
  appliedDate: string;
  updatedAt: string;
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
      title: "Total Applications",
      value: totalApplications,
      icon: Briefcase,
      description: "Jobs tracked",
      gradient: "from-violet-500/20 to-purple-600/20",
      iconColor: "text-violet-400",
      borderGlow: "hover:border-violet-500/30",
    },
    {
      title: "Replies Received",
      value: totalReplies,
      icon: MessageSquareText,
      description: totalReplies > 0 ? "Conversations started" : "Awaiting responses",
      gradient: "from-emerald-500/20 to-green-600/20",
      iconColor: "text-emerald-400",
      borderGlow: "hover:border-emerald-500/30",
    },
    {
      title: "Interview Rate",
      value: `${interviewRate}%`,
      icon: TrendingUp,
      description: "Interview + offer conversion",
      gradient: "from-amber-500/20 to-orange-600/20",
      iconColor: "text-amber-400",
      borderGlow: "hover:border-amber-500/30",
    },
    {
      title: "Last Sync",
      value: lastSyncTime ? formatRelativeDate(lastSyncTime) : "Never",
      icon: Clock,
      description: lastSyncTime
        ? lastSyncTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Click Sync to start",
      gradient: "from-blue-500/20 to-cyan-600/20",
      iconColor: "text-blue-400",
      borderGlow: "hover:border-blue-500/30",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.title}
          className={`relative overflow-hidden transition-all duration-300 ${stat.borderGlow} hover:shadow-lg group`}
        >
          {/* Gradient background glow */}
          <div
            className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
          />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <div
              className={`p-2 rounded-lg bg-background/50 ${stat.iconColor}`}
            >
              <stat.icon className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold tracking-tight">
              {stat.value}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stat.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
