"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Briefcase, Sparkles, LayoutDashboard, LogOut, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardHeader() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user;

  const navItems = [
    {
      href: "/dashboard",
      label: "Applications",
      icon: LayoutDashboard,
      active: pathname === "/dashboard",
    },
    {
      href: "/resume",
      label: "Resume Studio",
      icon: Sparkles,
      active: pathname?.startsWith("/resume"),
    },
  ];

  return (
    <header className="sticky top-0 z-50 w-full glass print:hidden">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          {/* Brand */}
          <Link
            href="/dashboard"
            className="tactile-pill flex items-center gap-2.5 group"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] group-hover:bg-primary/20 transition-colors">
              <Briefcase className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              JobFlow
            </span>
          </Link>

          <div className="h-4 w-px bg-white/[0.08] hidden sm:block" />

          {/* Tactile Segmented Nav */}
          <nav className="flex items-center gap-1 rounded-lg bg-secondary/50 p-1 border border-white/[0.06]">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "tactile-pill flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium",
                    item.active
                      ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_8px_rgba(99,102,241,0.35)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="tactile-pill flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3 bg-secondary/40 border border-white/[0.06] hover:border-white/[0.14] outline-none">
              <Avatar className="h-6 w-6">
                <AvatarImage src={user?.image || ""} alt={user?.name || ""} />
                <AvatarFallback className="text-[10px] font-semibold bg-primary/20 text-indigo-200">
                  {user?.name
                    ?.split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium text-foreground/90 hidden sm:inline-block">
                {user?.name || "Account"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-0.5">
                <p className="text-xs font-semibold leading-none">
                  {user?.name}
                </p>
                <p className="text-[11px] leading-none text-muted-foreground pt-1 truncate">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs text-muted-foreground">
              <Mail className="mr-2 h-3.5 w-3.5 text-emerald-400" />
              Gmail Connected
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-xs text-rose-400 focus:text-rose-300 focus:bg-rose-500/10 cursor-pointer"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
