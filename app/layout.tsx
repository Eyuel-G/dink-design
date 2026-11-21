import type { Metadata } from "next";
import { AppToaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dink Design",
  description: "Describe a factory or room and walk through a priced 3D layout.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="stylesheet" href="/dink.css" />
      </head>
      <body className="antialiased">
        <TooltipProvider>
          {children}
          <AppToaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
