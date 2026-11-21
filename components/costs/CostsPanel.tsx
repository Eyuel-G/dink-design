"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { marketplaceHref } from "@/components/prices/PriceLink";
import { api } from "@/lib/client/api";
import { useDink } from "@/lib/client/store";
import { formatMoney, formatWhen } from "@/lib/format";
import type { UserSettings } from "@/lib/schemas";
import { SourceWizard } from "@/components/wizard/SourceWizard";

export function CostsPanel() {
  const view = useDink((state) => state.view);
  if (!view?.cost || !view.spec) return <p className="p-4 text-sm text-muted">The bill of quantities appears after the first layout.</p>;
  const { cost, settings } = view;
  const money = (value: number) => formatMoney(value, settings.currency, settings.usdEtbRate);
  const chart = ["structure", "openings", "finishes", "utilities", "equipment", "furniture"].map((category) => ({
    category,
    total: Math.round(cost.lines.filter((line) => line.category === category).reduce((sum, line) => sum + line.total, 0)),
  }));

  async function save(patch: Partial<UserSettings>) {
    const next = { ...settings, ...patch };
    useDink.getState().applySettings(next);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Settings were not saved.");
    }
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto px-3 py-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total" value={money(cost.total)} />
        <Stat label="Per m²" value={money(cost.perM2)} />
        <Stat label="Construction" value={money(cost.construction)} />
        <Stat label="Interior & equipment" value={money(cost.interior)} />
      </div>
      <div className="h-40 rounded-2xl border border-line bg-bg p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart}>
            <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} />
            <YAxis hide />
            <Tooltip formatter={(value) => money(Number(value))} />
            <Bar dataKey="total" fill="#e08a4f" radius={6} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <label className="block text-xs text-muted">
        Labor {settings.laborPct}% of materials
        <Slider className="mt-2" min={0} max={40} step={1} value={[settings.laborPct]} disabled={view.project.readOnly} onValueChange={([value]) => useDink.getState().applySettings({ ...settings, laborPct: value })} onValueCommit={([value]) => void save({ laborPct: value })} />
      </label>
      <label className="block text-xs text-muted">
        Contingency {settings.contingencyPct}%
        <Slider className="mt-2" min={0} max={25} step={1} value={[settings.contingencyPct]} disabled={view.project.readOnly} onValueChange={([value]) => useDink.getState().applySettings({ ...settings, contingencyPct: value })} onValueCommit={([value]) => void save({ contingencyPct: value })} />
      </label>
      <div className="flex flex-wrap gap-2">
        {(["estimate", "lowest", "median", "pinned"] as const).map((mode) => (
          <button key={mode} type="button" disabled={view.project.readOnly} className={`rounded-full px-3 py-1 text-xs capitalize ${settings.priceMode === mode ? "bg-accent text-accent-ink" : "bg-chip"}`} onClick={() => void save({ priceMode: mode }).then(() => reload(view.project.id))}>
            {mode === "estimate" ? "Catalog estimate" : mode}
          </button>
        ))}
      </div>
      {["construction", "interior"].map((group) => (
        <section key={group}>
          <h3 className="mb-2 font-display text-lg capitalize">{group === "interior" ? "Interior & equipment" : "Construction"}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1">Item</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Tag</th>
                </tr>
              </thead>
              <tbody>
                {cost.lines.filter((line) => line.group === group).map((line) => {
                  const href = line.priceKind === "marketplace" || line.priceKind === "pinned" ? marketplaceHref(line.url, line.unitPrice, quoteBase(view.quotes, line.id)) : null;
                  return (
                    <tr key={line.id} className="cursor-pointer border-t border-line hover:bg-chip" onClick={() => fly(line.objectIds[0])}>
                      <td className="py-2 pr-2">
                        {line.name}
                        {line.shopTitle ? <div className="text-[10px] text-muted">{line.shopTitle}</div> : null}
                        <div className="text-[10px] text-muted">{line.note}</div>
                      </td>
                      <td>{line.quantity} {line.unit}</td>
                      <td>{money(line.total)}</td>
                      <td>
                        {href ? (
                          <a className="underline" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                            {line.priceKind === "pinned" ? "Pinned" : line.sourceName || "Jiji Ethiopia"}
                          </a>
                        ) : (
                          <Badge>{line.failure === "blocked" ? "Blocked" : line.failure === "slow" ? "Slow" : line.stale ? "Stale" : "Estimate"}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-muted">
        Materials {money(cost.materials)} · labor {money(cost.labor)} · contingency {money(cost.contingency)}. Wall area {cost.wallArea} m² after openings. A linked price is the closest matching listing on that Ethiopian shop, using the piece’s design and color. Prices without a link are catalog estimates.
      </p>
      <p className="text-xs text-muted">Checked {formatWhen(Object.values(view.quotes)[0]?.checkedAt)}</p>
      {view.project.readOnly ? null : <SourceWizard />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-bg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-xl">{value}</p>
    </div>
  );
}

function fly(objectId?: string) {
  if (!objectId) return;
  const object = useDink.getState().view?.layout?.objects.find((item) => item.id === objectId);
  if (!object) return;
  useDink.getState().select(object.id);
  useDink.getState().setFocus([object.x, object.y + object.h / 2, object.z]);
  useDink.getState().setMode("orbit");
}

function quoteBase(quotes: ProjectViewQuotes, lineId: string): string | null {
  const catalogId = lineId.split(":")[0];
  return quotes[catalogId]?.sourceBaseUrl ?? quotes[lineId]?.sourceBaseUrl ?? null;
}

type ProjectViewQuotes = ReturnType<typeof useDink.getState>["view"] extends infer V ? V extends { quotes: infer Q } ? Q : never : never;

async function reload(projectId: string) {
  try {
    const fresh = await api<NonNullable<ReturnType<typeof useDink.getState>["view"]>>(`/api/projects/${projectId}`);
    useDink.getState().hydrate(fresh);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not refresh prices.");
  }
}
