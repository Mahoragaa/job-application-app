"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "hsl(222 47.4% 11.2%)",
            border: "1px solid hsl(215 27.9% 16.9%)",
            color: "hsl(210 20% 98%)",
          },
        }}
      />
    </SessionProvider>
  );
}
