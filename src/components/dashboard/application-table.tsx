"use client";

import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";

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
}

interface ApplicationTableProps {
  applications: Application[];
  isLoading: boolean;
}

function getStatusBadge(status: string) {
  const statusMap: Record<
    string,
    { label: string; variant: "success" | "warning" | "destructive" | "info" | "purple" | "secondary" }
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

function ApplicationLogged() {
  return (
    <div className="flex items-center gap-1.5 text-blue-400">
      <CheckCircle2 className="h-4 w-4" />
      <span className="text-sm font-medium">Logged</span>
    </div>
  );
}

export function ApplicationTable({
  applications,
  isLoading,
}: ApplicationTableProps) {
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

  if (applications.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="rounded-full bg-muted p-4 mb-4">
            <Inbox className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No applications yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Click <strong>&quot;Sync Inbox&quot;</strong> to scan your Gmail for
            job application emails. They&apos;ll appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Applications</CardTitle>
            <CardDescription>
              {applications.length} job{applications.length !== 1 ? "s" : ""}{" "}
              tracked from your Gmail
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[220px]">Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-[120px]">Application</TableHead>
              <TableHead className="w-[180px]">Reply Status</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="text-right w-[120px]">Date</TableHead>
              <TableHead className="w-[60px] text-center">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((app) => (
              <TableRow
                key={app.id}
                className="group cursor-default"
              >
                {/* Company */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 text-primary font-bold text-sm">
                      {app.company.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium leading-none mb-0.5">
                        {app.company}
                      </p>
                      {app.snippet && (
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                          {app.snippet}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* Role */}
                <TableCell>
                  <span className="font-medium">{app.role}</span>
                </TableCell>

                {/* Application Logged */}
                <TableCell>
                  <ApplicationLogged />
                </TableCell>

                {/* Reply Status */}
                <TableCell>{getReplyIndicator(app.hasReply)}</TableCell>

                {/* Status Badge */}
                <TableCell>{getStatusBadge(app.status)}</TableCell>

                {/* Date */}
                <TableCell className="text-right text-muted-foreground">
                  {formatRelativeDate(new Date(app.appliedDate))}
                </TableCell>

                {/* View Email — #all/ searches across inbox+archive+labels */}
                <TableCell className="text-center">
                  {(app.threadId || app.emailId) ? (
                    <a
                      href={`https://mail.google.com/mail/u/0/#all/${app.threadId || app.emailId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="Open thread in Gmail"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
