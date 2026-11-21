"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Detected {
  status: string;
  strategy?: string;
  template?: string;
  message?: string;
}

interface TestResult {
  status: string;
  message?: string;
  results?: { title: string; price: number; currency: string; url: string | null }[];
}

export function SourceWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("https://jiji.com.et/search?query=chair");
  const [detected, setDetected] = useState<Detected | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("ETB");
  const [busy, setBusy] = useState(false);

  async function detect() {
    setBusy(true);
    try {
      const result = await api<Detected>("/api/prices/wizard", { method: "POST", body: JSON.stringify({ step: "detect", url }) });
      setDetected(result);
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That site could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    try {
      const result = await api<TestResult>("/api/prices/wizard", {
        method: "POST",
        body: JSON.stringify({ step: "test", url: detected?.template || url, strategy: detected?.strategy || "llm", query: "chair" }),
      });
      setTest(result);
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The test search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const base = new URL(url);
      await api("/api/prices/sources", {
        method: "POST",
        body: JSON.stringify({
          name: name || base.hostname,
          baseUrl: base.origin,
          searchUrlTemplate: detected?.template || `${base.origin}/search?query={query}`,
          currency,
          categories: ["equipment", "furniture"],
          priority: 20,
          refreshHours: 12,
          strategy: detected?.strategy === "api" ? "llm" : detected?.strategy || "llm",
        }),
      });
      toast.success("Source saved. The next price check will use it. A blocked site stays on the estimate.");
      setOpen(false);
      setStep(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The source was not saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add a price website
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line p-3">
      <p className="text-xs uppercase tracking-wide text-muted">Step {step} of 4</p>
      {step === 1 ? (
        <>
          <Input aria-label="Website URL" value={url} onChange={(event) => setUrl(event.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => void detect()}>Detect</Button>
        </>
      ) : null}
      {step === 2 && detected ? (
        <>
          <p className="text-xs">{detected.message}</p>
          <p className="text-xs text-muted">Strategy: {detected.strategy}. Template: {detected.template}</p>
          <Button size="sm" disabled={busy} onClick={() => void runTest()}>Test search</Button>
        </>
      ) : null}
      {step === 3 && test ? (
        <>
          <p className="text-xs">{test.message}</p>
          <ul className="space-y-1 text-xs">
            {(test.results ?? []).map((row) => (
              <li key={row.title}>{row.title} — {row.price} {row.currency}{row.url ? "" : " · no link"}</li>
            ))}
            {(test.results ?? []).length === 0 ? <li>No priced results. Nothing was invented.</li> : null}
          </ul>
          <Button size="sm" onClick={() => setStep(4)}>Continue</Button>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <Input aria-label="Source name" placeholder="Source name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input aria-label="Currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          <Button size="sm" disabled={busy} onClick={() => void save()}>Save source</Button>
        </>
      ) : null}
      <button type="button" className="text-xs text-muted underline" onClick={() => { setOpen(false); setStep(1); }}>
        Close wizard
      </button>
    </section>
  );
}
