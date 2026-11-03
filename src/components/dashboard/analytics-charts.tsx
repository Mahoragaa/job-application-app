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
        label: "Applied",
        count: total,
        percent: total > 0 ? 100 : 0,
        barColor: "bg-indigo-500",
        textColor: "text-indigo-300",
      },
      {
        label: "Replied",
        count: replies,
        percent: pct(replies),
        barColor: "bg-emerald-500",
        textColor: "text-emerald-300",
      },
      {
        label: "Interview",
        count: interviews,
        percent: pct(interviews),
        barColor: "bg-sky-500",
        textColor: "text-sky-300",
      },
      {
        label: "Offer",
        count: offers,
        percent: pct(offers),
        barColor: "bg-amber-500",
        textColor: "text-amber-300",
      },
      {
        label: "Closed",
        count: rejected,
        percent: pct(rejected),
        barColor: "bg-rose-500/80",
        textColor: "text-rose-300",
      },
    ];
  }, [applications]);

  const weeklyBuckets = useMemo(() => {
    const now = new Date();
    const buckets: Array<{
      label: string;
      start: Date;
      end: Date;
      count: number;
    }> = [];

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
    <div className="grid gap-3.5 lg:grid-cols-12">
      {/* Funnel */}
      <Card className="lg:col-span-6 tactile-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-primary" />
            Pipeline
          </CardTitle>
          <CardDescription>
            Conversion across {applications.length} role
            {applications.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {funnelStages.map((stage) => (
            <div key={stage.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{stage.label}</span>
                <span className={`font-medium ${stage.textColor}`}>
                  {stage.count} · {stage.percent}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary/70 overflow-hidden">
                <div
                  className={`h-full rounded-full ${stage.barColor} transition-all duration-500`}
                  style={{
                    width: `${Math.max(stage.count > 0 ? 4 : 0, stage.percent)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Weekly Velocity */}
      <Card className="lg:col-span-6 tactile-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            8-Week Activity
          </CardTitle>
          <CardDescription>
            {totalRecent} applied · ~{(totalRecent / 8).toFixed(1)}/wk
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-end justify-between gap-2 pt-2">
            {weeklyBuckets.map((bucket) => {
              const heightPct = Math.round((bucket.count / maxWeekly) * 100);
              return (
                <div
                  key={bucket.label}
                  className="flex-1 flex flex-col items-center gap-1 h-full justify-end group"
                >
                  <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {bucket.count}
                  </span>
                  <div className="w-full bg-secondary/45 rounded-t h-20 flex items-end overflow-hidden">
                    <div
                      className="w-full bg-primary/85 rounded-t transition-all duration-300 group-hover:bg-primary"
                      style={{
                        height: `${bucket.count > 0 ? Math.max(12, heightPct) : 4}%`,
                        opacity: bucket.count > 0 ? 1 : 0.2,
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
