"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "tactile-btn inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_6px_rgba(0,0,0,0.4)] hover:bg-primary/95 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_18px_-3px_rgba(99,102,241,0.45)]",
        emerald:
          "bg-emerald-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_6px_rgba(0,0,0,0.4)] hover:bg-emerald-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_18px_-3px_rgba(16,185,129,0.4)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_3px_rgba(0,0,0,0.35)] hover:bg-destructive/90",
        outline:
          "border border-white/[0.1] bg-secondary/45 text-foreground/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.3)] hover:bg-secondary/80 hover:border-white/[0.18] hover:text-foreground hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_5px_14px_-3px_rgba(0,0,0,0.45)]",
        secondary:
          "bg-secondary text-secondary-foreground border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-secondary/85 hover:border-white/[0.12]",
        ghost:
          "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 text-xs sm:text-sm",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-6 text-sm",
        icon: "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
