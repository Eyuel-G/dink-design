"use client";

import { useState } from "react";
import { ImagePlus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDink } from "@/lib/client/store";
import { filesToImages, type ImagePayload } from "@/components/chat/images";

export function ChatPanel({ onSend, onConfirm }: { onSend: (content: string, images: ImagePayload[]) => Promise<void>; onConfirm: () => Promise<void> }) {
  const view = useDink((state) => state.view);
  const streaming = useDink((state) => state.streaming);
  const chips = useDink((state) => state.chips);
  const confirm = useDink((state) => state.confirm);
  const busy = useDink((state) => state.busy);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImagePayload[]>([]);
  if (!view) return null;
  const readOnly = view.project.readOnly;

  async function submit(content: string) {
    const next = content.trim();
    if (!next && images.length === 0) return;
    const attached = images;
    setText("");
    setImages([]);
    try {
      await onSend(next, attached);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The message did not send.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {view.messages.length === 0 && !streaming ? <p className="text-sm text-muted">Ask for a factory, shop, or room. Follow-ups change the current version.</p> : null}
        {view.messages.map((message) => (
          <article key={message.id} className={message.role === "user" ? "ml-8 rounded-2xl bg-chip px-3 py-2 text-sm" : "mr-4 text-sm leading-6"}>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </article>
        ))}
        {streaming ? <article className="mr-4 text-sm leading-6 whitespace-pre-wrap">{streaming}</article> : null}
        {busy && !streaming ? <p className="text-xs text-muted">Reading the request…</p> : null}
        {view.spec?.assumptions?.length ? (
          <ul className="space-y-1 rounded-2xl border border-line bg-bg px-3 py-2 text-xs text-muted">
            {view.spec.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {confirm && !readOnly ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void onConfirm()} disabled={busy}>
              Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={() => useDink.getState().setConfirm(null)}>
              Edit
            </Button>
          </div>
        ) : null}
      </div>
      {readOnly ? <p className="px-3 pb-3 text-xs text-muted">This is a read-only share. The scene and prices can be viewed, not edited.</p> : null}
      {!readOnly ? (
        <form
          className="border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(text);
          }}
        >
          <div className="mb-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button key={chip} type="button" className="rounded-full bg-chip px-3 py-1 text-xs hover:bg-accent hover:text-accent-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => void submit(chip)}>
                {chip}
              </button>
            ))}
          </div>
          {images.length ? <p className="mb-2 text-xs text-muted">{images.length} image attached. It is sent only to this app.</p> : null}
          <Textarea
            value={text}
            aria-label="Message"
            placeholder="Make the roof higher, or describe a change"
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (!files.length) return;
              event.preventDefault();
              void filesToImages(files).then(setImages).catch((error: Error) => toast.error(error.message));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(text);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
              <ImagePlus className="h-4 w-4" />
              Attach
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  void filesToImages(files).then(setImages).catch((error: Error) => toast.error(error.message));
                  event.target.value = "";
                }}
              />
            </label>
            <Button type="submit" size="sm" disabled={busy} aria-label="Send">
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
