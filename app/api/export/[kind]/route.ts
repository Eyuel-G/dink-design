import { jsPDF } from "jspdf";
import { guard, ownerKey } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { buildProjectView } from "@/lib/project-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const identity = await guard(request);
  if (identity instanceof Response) return identity;
  const kind = (await context.params).kind;
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  const store = await getStore();
  const view = await buildProjectView(store, ownerKey(identity), projectId);
  if (!view?.cost || !view.spec) {
    return Response.json({ error: "Build a scene before exporting." }, { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const safeName = view.project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "dink";
  if (kind === "csv") return csv(view.cost, view.settings, safeName);
  if (kind === "json") {
    return new Response(JSON.stringify({ spec: view.spec, layout: view.layout, cost: view.cost }, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${safeName}-spec.json"`,
        "cache-control": "private, no-store",
      },
    });
  }
  if (kind === "pdf") return pdf(view.project.name, view.spec, view.cost, view.settings, safeName);
  return Response.json({ error: "Export pdf, csv, or json." }, { status: 404 });
}

function money(value: number, currency: "ETB" | "USD", rate: number) {
  return formatMoney(value, currency, rate);
}

function csv(cost: NonNullable<Awaited<ReturnType<typeof buildProjectView>>>["cost"], settings: { currency: "ETB" | "USD"; usdEtbRate: number }, name: string) {
  if (!cost) return new Response("empty", { status: 404 });
  const header = ["Group", "Category", "Item", "Quantity", "Unit", "Unit price ETB", "Total ETB", "Price type", "Link"];
  const rows = cost.lines.map((line) => [line.group, line.category, line.name, String(line.quantity), line.unit, String(line.unitPrice), String(line.total), line.priceKind, line.url ?? ""]);
  rows.push(["", "", "Materials", "", "", "", String(cost.materials), "", ""]);
  rows.push(["", "", "Labor", "", "", String(cost.laborPct), String(cost.labor), "", ""]);
  rows.push(["", "", "Contingency", "", "", String(cost.contingencyPct), String(cost.contingency), "", ""]);
  rows.push(["", "", "Total", "", "", "", String(cost.total), "", ""]);
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-boq.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function pdf(
  name: string,
  spec: NonNullable<Awaited<ReturnType<typeof buildProjectView>>>["spec"],
  cost: NonNullable<Awaited<ReturnType<typeof buildProjectView>>>["cost"],
  settings: { currency: "ETB" | "USD"; usdEtbRate: number; laborPct: number; contingencyPct: number },
  file: string,
) {
  if (!spec || !cost) return new Response("empty", { status: 404 });
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 48;
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.text("Dink Design — bill of quantities", 40, y);
  y += 22;
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc.text(name, 40, y);
  y += 16;
  doc.text(`${spec.room.width} × ${spec.room.length} × ${spec.room.height} m`, 40, y);
  y += 16;
  doc.setFontSize(9);
  const lines = [
    ...cost.lines.map((line) => `${line.name}  ${line.quantity} ${line.unit}  ×  ${line.unitPrice}  =  ${line.total} ETB  (${line.priceKind})`),
    `Materials ${cost.materials} ETB`,
    `Labor ${settings.laborPct}%  ${cost.labor} ETB`,
    `Contingency ${settings.contingencyPct}%  ${cost.contingency} ETB`,
    `Total ${money(cost.total, settings.currency, settings.usdEtbRate)}`,
    "Models are stand-ins. A link is included only for a parsed listing on the source domain.",
  ];
  for (const line of lines) {
    if (y > 780) {
      doc.addPage();
      y = 48;
    }
    doc.text(line.slice(0, 110), 40, y);
    y += 14;
  }
  const bytes = doc.output("arraybuffer");
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${file}-boq.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
