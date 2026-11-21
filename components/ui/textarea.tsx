import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("min-h-28 w-full resize-none rounded-2xl border border-line bg-transparent px-4 py-3 text-base text-ink outline-none placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
