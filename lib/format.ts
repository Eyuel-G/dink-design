export function formatMoney(amount: number, currency: "ETB" | "USD", rate: number): string {
  const value = currency === "USD" ? amount / rate : amount;
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
  return currency === "USD" ? `$${formatted}` : `${formatted} ETB`;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "not checked";
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "not checked";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
