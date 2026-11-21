import type { ReactNode } from "react";
import { verifiedLink } from "@/lib/prices/link";

export function marketplaceHref(url: string | null | undefined, price: number, sourceBaseUrl: string | null | undefined): string | null {
  if (!url || !sourceBaseUrl) return null;
  return verifiedLink({ price, url }, sourceBaseUrl);
}

export function PriceLink({
  url,
  price,
  sourceBaseUrl,
  children,
  className,
}: {
  url: string | null | undefined;
  price: number;
  sourceBaseUrl: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const href = marketplaceHref(url, price, sourceBaseUrl);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
