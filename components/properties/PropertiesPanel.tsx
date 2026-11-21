"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CATALOG, getCatalogItem } from "@/lib/catalog";
import { FLOOR_COLORS, WALL_COLORS } from "@/lib/finishes";
import type { PlacedObject } from "@/lib/layout/place";
import { api } from "@/lib/client/api";
import { useDink } from "@/lib/client/store";
import type { ProjectView } from "@/lib/client/types";
import { formatMoney, formatWhen } from "@/lib/format";
import { marketplaceHref, PriceLink } from "@/components/prices/PriceLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PropertiesPanel() {
  const view = useDink((state) => state.view);
  const selectedId = useDink((state) => state.selectedId);
  const compareId = useDink((state) => state.compareId);
  if (view && (selectedId === "__wall" || selectedId === "__floor")) {
    return <FinishEditor projectId={view.project.id} kind={selectedId} color={selectedId === "__wall" ? view.spec?.style.wallColor : view.spec?.style.floorColor} readOnly={view.project.readOnly} />;
  }
  const object = view?.layout?.objects.find((item) => item.id === (compareId || selectedId));
  if (!view || !object) {
    return (
      <p className="p-4 text-sm text-muted">
        Turn on Handles to show Move, Rotate, Resize, and Delete on every piece. Resize opens X, Y, and Z; drag right to grow that axis. Delete removes that piece. The color chip recolors it. Click a wall or the floor to recolor the shell. Shop prices and links are on the Costs tab.
      </p>
    );
  }
  const item = getCatalogItem(object.catalogId);
  const quote = view.quotes[object.catalogId];
  const pin = view.spec?.pins?.[object.id];
  const price = pin?.price ?? quote?.unitPrice ?? item?.basePriceEtb ?? 0;
  const money = formatMoney(price, view.settings.currency, view.settings.usdEtbRate);
  const href = pin ? marketplaceHref(pin.url, pin.price, quote?.sourceBaseUrl || "https://jiji.com.et") : quote?.kind === "marketplace" ? marketplaceHref(quote.url, quote.unitPrice, quote.sourceBaseUrl) : null;
  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-3 text-sm">
      <div>
        <h3 className="font-display text-2xl">{object.name}</h3>
        <p className="text-xs text-muted">{object.id}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Field label="Width" value={`${object.w} m`} />
        <Field label="Length" value={`${object.l} m`} />
        <Field label="Height" value={`${object.h} m`} />
      </dl>
      <p className="text-xs text-muted">Press Resize, then X, Y, or Z, and drag right to grow that axis. Delete removes this piece. Pieces may overlap.</p>
      <AssetColor projectId={view.project.id} object={object} readOnly={view.project.readOnly} />
      <PiecePicker projectId={view.project.id} objectId={object.id} currency={view.settings.currency} rate={view.settings.usdEtbRate} readOnly={view.project.readOnly} />
      <label className="block text-xs text-muted">
        Palette
        <select
          aria-label="Palette"
          className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-2 text-sm text-ink"
          value={view.spec?.style.palette}
          disabled={view.project.readOnly}
          onChange={(event) => void patch(view.project.id, { style: { palette: event.target.value as NonNullable<typeof view.spec>["style"]["palette"] }, note: "Changed the palette" })}
        >
          {["concrete", "clay", "ink", "sage", "sand"].map((palette) => (
            <option key={palette} value={palette}>{palette}</option>
          ))}
        </select>
      </label>
      <div className="rounded-2xl border border-line p-3">
        <p className="font-display text-xl">{money}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge>{pin ? "Pinned" : quote?.kind === "marketplace" ? "Marketplace price" : "Estimate"}</Badge>
          {quote?.confidence ? <Badge>{quote.confidence}</Badge> : null}
          {quote?.failure ? <Badge>{quote.failure}</Badge> : null}
        </div>
        <p className="mt-2 text-xs text-muted">
          {quote?.listingCount ? `${quote.listingCount} listings` : "No verified listing"} · {formatWhen(quote?.checkedAt)}
          {quote?.min && quote.max ? ` · ${formatMoney(quote.min, view.settings.currency, view.settings.usdEtbRate)}–${formatMoney(quote.max, view.settings.currency, view.settings.usdEtbRate)}` : ""}
        </p>
        {href ? (
          <PriceLink className="mt-2 inline-block text-xs underline" url={href} price={price} sourceBaseUrl={quote?.sourceBaseUrl || "https://jiji.com.et"}>
            Open the listing
          </PriceLink>
        ) : (
          <p className="mt-2 text-xs text-muted">No link. A link appears only for a parsed price on the source domain.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => useDink.getState().setCompare(object.id)}>Use price</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={view.project.readOnly}
          onClick={() => void patch(view.project.id, { photoPins: { [object.id]: view.spec?.photoPins?.[object.id] === "on" ? "off" : "on" }, note: "Pinned the reference photo" })}
        >
          {view.spec?.photoPins?.[object.id] === "off" ? "Show reference photo" : "Pin reference photo"}
        </Button>
      </div>
      {compareId === object.id ? <Compare projectId={view.project.id} objectId={object.id} readOnly={view.project.readOnly} /> : null}
    </div>
  );
}

const PIECE_COLORS = ["#f4efe6", "#e7e2d8", "#d7c4a3", "#c48962", "#8d4636", "#3e5348", "#4a463f", "#9fd4e8", "#d5e3ee", "#2c2a28"];

function AssetColor({ projectId, object, readOnly }: { projectId: string; object: PlacedObject; readOnly: boolean }) {
  const current = object.tint || object.color;
  const paint = (hex: string) => void styleObject(projectId, object, hex);
  return (
    <div>
      <p className="text-xs text-muted">Color</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {PIECE_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            disabled={readOnly}
            aria-label={`Color ${hex}`}
            className={`h-7 w-7 rounded-full border ${current.toLowerCase() === hex ? "border-accent" : "border-line"}`}
            style={{ background: hex }}
            onClick={() => paint(hex)}
          />
        ))}
        <input aria-label="Custom piece color" className="h-8 w-10" type="color" value={current} disabled={readOnly} onChange={(event) => paint(event.target.value)} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-chip px-2 py-2">
      <dt className="text-[10px] uppercase text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FinishEditor({ projectId, kind, color, readOnly }: { projectId: string; kind: "__wall" | "__floor"; color: string | undefined; readOnly: boolean }) {
  const swatches = kind === "__wall" ? WALL_COLORS : FLOOR_COLORS;
  const field = kind === "__wall" ? "wallColor" : "floorColor";
  const label = kind === "__wall" ? "Wall color" : "Floor color";
  const paint = (hex: string) => void patch(projectId, { style: { [field]: hex }, note: `Set the ${label.toLowerCase()}` });
  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 py-3 text-sm">
      <h3 className="font-display text-2xl">{label}</h3>
      <p className="text-xs text-muted">These are finish colors for the room shell. They do not change the bill of quantities.</p>
      <div className="grid grid-cols-4 gap-2">
        {swatches.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            disabled={readOnly}
            aria-label={swatch.name}
            title={swatch.name}
            className={`h-10 rounded-xl border ${color === swatch.hex ? "border-accent" : "border-line"}`}
            style={{ background: swatch.hex }}
            onClick={() => paint(swatch.hex)}
          />
        ))}
      </div>
      <label className="block text-xs text-muted">
        Custom
        <input aria-label={`Custom ${label}`} className="mt-1 h-10 w-full" type="color" value={color || swatches[0].hex} disabled={readOnly} onChange={(event) => paint(event.target.value)} />
      </label>
    </div>
  );
}

function PiecePicker({ projectId, objectId, currency, rate, readOnly }: { projectId: string; objectId: string; currency: "ETB" | "USD"; rate: number; readOnly: boolean }) {
  const [query, setQuery] = useState("");
  const pieces = CATALOG.filter((item) => item.placeable && item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-wide text-muted">Swap this piece</h4>
      <p className="text-xs text-muted">Catalog pieces. The Costs tab prices a placed piece from the closest Jiji Ethiopia listing and links to that page.</p>
      <Input aria-label="Search pieces" placeholder="Search desks, chairs, ovens" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {pieces.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={readOnly}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-2 py-2 text-left text-xs hover:bg-chip"
            onClick={() => void patch(projectId, { swap: { objectId, catalogId: item.id }, note: `Placed ${item.name}` })}
          >
            <span>{item.name}</span>
            <span className="shrink-0 text-muted">{formatMoney(item.basePriceEtb, currency, rate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Compare({ projectId, objectId, readOnly }: { projectId: string; objectId: string; readOnly: boolean }) {
  const view = useDink((state) => state.view);
  const object = view?.layout?.objects.find((item) => item.id === objectId);
  const quote = object ? view?.quotes[object.catalogId] : undefined;
  const listings = (quote?.listings ?? []).slice(0, 5);
  if (!listings.length) return <p className="text-xs text-muted">No marketplace matches are cached. The estimate stays, with no invented listings.</p>;
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-wide text-muted">Compare</h4>
      {listings.map((listing) => (
        <div key={listing.url || listing.title} className="rounded-xl border border-line p-2 text-xs">
          <p>{listing.title}</p>
          <p className="text-muted">{listing.price} {listing.currency} · {listing.condition}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={readOnly || !listing.url}
              onClick={() => void pin(projectId, objectId, listing, quote?.sourceBaseUrl || null)}
            >
              Use this price
            </Button>
            <Button size="sm" variant="outline" onClick={() => void recheck(listing.url)}>Re-check</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

async function styleObject(projectId: string, object: PlacedObject, color: string) {
  try {
    const fresh = await api<ProjectView>(`/api/projects/${projectId}/move`, {
      method: "POST",
      body: JSON.stringify({ objectId: object.id, x: object.x, z: object.z, rotationY: object.rotationY, color }),
    });
    useDink.getState().hydrate(fresh);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That color could not be saved.");
  }
}

async function patch(projectId: string, body: unknown) {
  try {
    const fresh = await api<ProjectView>(`/api/projects/${projectId}/patch`, { method: "POST", body: JSON.stringify(body) });
    useDink.getState().hydrate(fresh);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That change was rejected.");
  }
}

async function pin(projectId: string, objectId: string, listing: { price: number; currency: string; title: string; url: string | null }, sourceBaseUrl: string | null) {
  try {
    const fresh = await api<ProjectView>("/api/prices/pin", {
      method: "POST",
      body: JSON.stringify({ projectId, objectId, price: listing.price, currency: listing.currency, title: listing.title, url: listing.url, sourceBaseUrl }),
    });
    useDink.getState().hydrate(fresh);
    toast.success("Pinned. A new version stores that price.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The price was not pinned.");
  }
}

async function recheck(url: string | null) {
  if (!url) {
    toast.message("There is no listing URL to re-check.");
    return;
  }
  try {
    const sources = await api<{ sources: { id: string; name: string }[] }>("/api/prices/sources");
    const source = sources.sources[0];
    if (!source) {
      toast.message("No price source is configured.");
      return;
    }
    const result = await api<{ message: string }>("/api/prices/recheck", {
      method: "POST",
      body: JSON.stringify({ sourceId: source.id, url }),
    });
    toast.message(result.message);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Recheck failed.");
  }
}
