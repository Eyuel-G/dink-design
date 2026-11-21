import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn("h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", className)}
    {...props}
  />
));
Input.displayName = "Input";
