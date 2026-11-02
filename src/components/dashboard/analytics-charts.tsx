"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3, Filter } from "lucide-react";

interface ApplicationAnalyticsItem {
  id: string;
  status: string;
  hasReply: boolean;
  appliedDate: string;
}

interface AnalyticsChartsProps {
  applications: ApplicationAnalyticsItem[];
}

export function AnalyticsCharts({ applications }: AnalyticsChartsProps) {
  const funnelStages = useMemo(() => {
    const total = applications.length;
    const replies = applications.filter(
      (a) => a.hasReply || a.status !== "applied"
    ).length;
    const interviews = applications.filter(
      (a) => a.status === "interview" || a.status === "offer"
    ).length;
    const offers = applications.filter((a) => a.status === "offer").length;
    const rejected = applications.filter((a) => a.status === "rejected").length;

    const pct = (count: number) =>
      total > 0 ? Math.round((count / total) * 100) : 0;

    return [
      {
        label: "Total Applied",
        count: total,
        percent: total > 0 ? 100 : 0,
        barColor: "bg-blue-500",
        textColor: "text-blue-400",
      },
      {
        label: "Replies / Activity",
        count: replies,
        percent: pct(replies),
        barColor: "bg-emerald-500",
        textColor: "text-emerald-400",
      },
      {
        label: "Interview Stage",
        count: interviews,
        percent: pct(interviews),
        barColor: "bg-violet-500",
        textColor: "text-violet-400",
      },
      {
        label: "Offers Received",
        count: offers,
        percent: pct(offers),
        barColor: "bg-amber-500",
        textColor: "text-amber-400",
      },
      {
        label: "Rejected / Closed",
        count: rejected,
        percent: pct(rejected),
        barColor: "bg-rose-500/80",
        textColor: "text-rose-400",
      },
    ];
  }, [applications]);

  const weeklyBuckets = useMemo(() => {
    const now = new Date();
    const buckets: Array<{ label: string; start: Date; end: Date; count: number }> = [];

    for (let i = 7; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);

      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      start.setHours(0, 0, 0, 0);

      const label = start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      buckets.push({ label, start, end, count: 0 });
    }

    for (const app of applications) {
      const d = new Date(app.appliedDate);
      for (const b of buckets) {
        if (d >= b.start && d <= b.end) {
          b.count++;
          break;
        }
      }
    }

    return buckets;
  }, [applications]);

  if (applications.length === 0) return null;

  const maxWeekly = Math.max(1, ...weeklyBuckets.map((b) => b.count));
  const totalRecent = weeklyBuckets.reduce((acc, b) => acc + b.count, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Conversion Funnel Card */}
      <Card className="lg:col-span-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                Application Conversion Funnel
              </CardTitle>
              <CardDescription className="text-xs">
                Stage-by-stage breakdown across {applications.length} tracked
                application{applications.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {funnelStages.map((stage) => (
            <div key={stage.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  {stage.label}
                </span>
                <span className={`font-semibold ${stage.textColor}`}>
                  {stage.count} ({stage.percent}%)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                <div
                  className={`h-full rounded-full ${stage.barColor} transition-all duration-500`}
                  style={{ width: `${Math.max(stage.count > 0 ? 4 : 0, stage.percent)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 8-Week Velocity Chart Card */}
      <Card className="lg:col-span-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Weekly Application Velocity (Last 8 Weeks)
              </CardTitle>
              <CardDescription className="text-xs">
                {totalRecent} application{totalRecent !== 1 ? "s" : ""} logged
                in the past 8 weeks (~
                {(totalRecent / 8).toFixed(1)}/week)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-40 flex items-end justify-between gap-2 pt-4">
            {weeklyBuckets.map((bucket) => {
              const heightPct = Math.round((bucket.count / maxWeekly) * 100);
              return (
                <div
                  key={bucket.label}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group"
                >
                  <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                    {bucket.count}
                  </span>
                  <div className="w-full bg-secondary/40 rounded-t-md h-24 flex items-end overflow-hidden">
                    <div
                      className="w-full bg-gradient-to-t from-primary/80 to-violet-400 rounded-t-md transition-all duration-500 group-hover:brightness-110"
                      style={{
                        height: `${bucket.count > 0 ? Math.max(12, heightPct) : 3}%`,
                        opacity: bucket.count > 0 ? 1 : 0.25,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate max-w-full">
                    {bucket.label}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
