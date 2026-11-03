import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/15 text-indigo-300",
        secondary:
          "border-white/[0.08] bg-secondary/80 text-muted-foreground",
        destructive:
          "border-rose-500/25 bg-rose-500/12 text-rose-300",
        outline: "border-white/[0.12] text-foreground",
        success:
          "border-emerald-500/25 bg-emerald-500/12 text-emerald-300",
        warning:
          "border-amber-500/25 bg-amber-500/12 text-amber-300",
        info:
          "border-sky-500/25 bg-sky-500/12 text-sky-300",
        purple:
          "border-indigo-500/25 bg-indigo-500/12 text-indigo-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
