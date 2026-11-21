"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { EXAMPLES } from "@/lib/intent/presets";
import { api } from "@/lib/client/api";
import { filesToImages, type ImagePayload } from "@/components/chat/images";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Landing() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ImagePayload[]>([]);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    void api<{ account: { name: string; email: string } | null }>("/api/auth/me")
      .then((result) => setAccount(result.account))
      .catch(() => setAccount(null));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setAccount(null);
  }

  async function submit(text: string) {
    const content = text.trim();
    if (!content && images.length === 0) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ prompt: content || "Read the attached image", images }),
      });
      router.push(`/workspace/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The project was not created.");
      setBusy(false);
    }
  }

  return (
    <main
      className="grain grid min-h-dvh place-items-center px-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void filesToImages([...event.dataTransfer.files]).then(setImages).catch((error: Error) => toast.error(error.message));
      }}
    >
      <div className="fixed right-4 top-4 z-30 flex items-center gap-2 sm:right-6 sm:top-5">
        {account ? (
          <>
            <span className="max-w-40 truncate text-sm text-muted">{account.name}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
              Log out
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Sign up</Link>
            </Button>
          </>
        )}
      </div>
      <div className="w-full max-w-2xl">
        <p className="mb-6 text-center font-display text-sm tracking-[0.2em] text-muted">DINK</p>
        <h1 className="text-center font-display text-5xl leading-tight sm:text-6xl">What should we build?</h1>
        <p className="mx-auto mt-3 max-w-md text-center text-muted">Describe a factory, shop, or home. You will walk through it with a priced bill of quantities.</p>
        <form
          className="mt-8 rounded-[28px] border border-line bg-elev p-3 shadow-[var(--shadow)]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(prompt);
          }}
        >
          <Textarea
            aria-label="Describe a space"
            placeholder="Garment factory, 20 x 30 m, 12 sewing stations, 2 cutting tables, storage, office, 2 exits"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (!files.length) return;
              event.preventDefault();
              void filesToImages(files).then(setImages).catch((error: Error) => toast.error(error.message));
            }}
          />
          {images.length ? <p className="px-2 text-xs text-muted">{images.length} image ready. Photos are read on the server, never sent to a marketplace.</p> : null}
          <div className="mt-2 flex items-center justify-between px-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
              <ImagePlus className="h-4 w-4" />
              Image
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  void filesToImages(files).then(setImages).catch((error: Error) => toast.error(error.message));
                  event.target.value = "";
                }}
              />
            </label>
            <Button type="submit" disabled={busy || (!prompt.trim() && images.length === 0)}>
              {busy ? "Opening…" : "Build"}
            </Button>
          </div>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.preset}
              type="button"
              className="rounded-full border border-line bg-elev px-3 py-2 text-left text-sm hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => {
                setPrompt(example.prompt);
                void submit(example.prompt);
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
