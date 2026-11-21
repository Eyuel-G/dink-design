"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return <Toaster theme="system" position="bottom-center" toastOptions={{ className: "rounded-2xl border border-line bg-elev text-ink" }} />;
}
