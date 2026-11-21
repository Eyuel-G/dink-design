import { formatMoney } from "@/lib/format";
import { suggestionChips } from "@/lib/intent/patch";
import type { CostReport } from "@/lib/cost/compute";
import type { LayoutResult } from "@/lib/layout/place";
import type { BuildingSpec } from "@/lib/schemas";

export function localReply(input: {
  spec: BuildingSpec;
  layout: LayoutResult;
  cost: CostReport;
  note: string;
  currency: "ETB" | "USD";
  rate: number;
}): { text: string; chips: string[] } {
  const warnings = input.layout.warnings;
  const lines = [
    input.note,
    `${input.spec.room.width} × ${input.spec.room.length} m, ${input.spec.room.height} m to the roof. ${input.layout.objects.length} objects are placed.`,
    warnings.length ? `Watch-outs: ${warnings.join(" ")}` : "",
    `The bill is ${formatMoney(input.cost.total, input.currency, input.rate)}, ${formatMoney(input.cost.perM2, input.currency, input.rate)} per m², including labor and contingency.`,
    "A price link shows up only when a listing is parsed on that marketplace. Until then the figure is a catalog estimate.",
    input.spec.assumptions.slice(0, 4).map((assumption) => `• ${assumption}`).join("\n"),
  ].filter(Boolean);
  return { text: lines.join("\n\n"), chips: suggestionChips(input.spec) };
}
