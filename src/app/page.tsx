import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignInButton } from "@/components/sign-in-button";
import {
  Sparkles,
  CheckCircle2,
  Mail,
  Brain,
  FolderOpen,
  BarChart3,
} from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  // Already signed in → go to dashboard
  if (session) {
    redirect("/dashboard");
  }

  const features = [
    { icon: Mail, text: "Gmail Integration" },
    { icon: Brain, text: "AI Classification" },
    { icon: FolderOpen, text: "Auto-Labeling" },
    { icon: BarChart3, text: "Status Tracking" },
  ];

  const highlights = [
    "Automatically detects job-related emails",
    "Classifies applications vs. recruiter replies",
    "Creates Gmail labels for organization",
    "Tracks company, role, and reply status",
    "AI-powered with OpenAI or Gemini",
    "SQLite database — your data stays local",
  ];

  return (
    <main className="min-h-screen relative overflow-hidden bg-background">
      {/* ── Animated Mesh Background ─────────────── */}
      <div className="absolute inset-0 mesh-gradient" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.3)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.3)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      {/* ── Floating Orbs ────────────────────────── */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full bg-violet-600/10 blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 rounded-full bg-indigo-600/10 blur-3xl animate-pulse [animation-delay:1s]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-purple-600/5 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-16">
        {/* ── Hero Badge ─────────────────────────── */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Sparkles className="w-4 h-4" />
          AI-Powered Job Tracking
        </div>

        {/* ── Title ──────────────────────────────── */}
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-center mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:100ms]">
          <span className="gradient-text">Job Tracker</span>
        </h1>

        {/* ── Subtitle ───────────────────────────── */}
        <p className="text-lg md:text-xl text-muted-foreground text-center max-w-lg mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:200ms]">
          Automatically organize your job applications from Gmail. AI-powered
          categorization, smart labeling, and real-time tracking.
        </p>

        {/* ── Sign In Button ─────────────────────── */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:300ms]">
          <SignInButton />
        </div>

        {/* ── Feature Pills ──────────────────────── */}
        <div className="mt-16 flex flex-wrap justify-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:400ms]">
          {features.map(({ icon: Icon, text }) => (
            <div
              key={text}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full glass text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="w-4 h-4 text-primary" />
              {text}
            </div>
          ))}
        </div>

        {/* ── Highlights Grid ────────────────────── */}
        <div className="mt-20 grid md:grid-cols-2 gap-3 max-w-xl w-full animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:500ms]">
          {highlights.map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card/30 border border-border/50 hover:border-primary/20 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm text-muted-foreground">{item}</span>
            </div>
          ))}
        </div>

        {/* ── Footer ─────────────────────────────── */}
        <p className="mt-16 text-xs text-muted-foreground/50">
          Your data stays on your machine · Powered by Gmail API · Built with
          Next.js
        </p>
      </div>
    </main>
  );
}
