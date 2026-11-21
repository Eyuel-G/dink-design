const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Strip markup from untrusted page text before it is shown or sent to a model. */
export function sanitizeUntrusted(input: string, max = 20000): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sanitizePlain(input: string, max = 400): string {
  return sanitizeUntrusted(input, max);
}
