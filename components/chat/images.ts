export interface ImagePayload {
  mime: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export async function filesToImages(files: File[]): Promise<ImagePayload[]> {
  const images = files.filter((file) => /image\/(png|jpeg|webp)/.test(file.type)).slice(0, 2);
  if (!images.length) throw new Error("Attach a PNG, JPEG, or WebP.");
  const encoded = await Promise.all(images.map(downscale));
  return encoded.filter((image): image is ImagePayload => Boolean(image));
}

async function downscale(file: File): Promise<ImagePayload | null> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const data = btoa(binary);
  if (data.length > 1_500_000) throw new Error("That image is still too large after downscaling.");
  return { mime: "image/jpeg", data };
}
