import "server-only";
import { createHash } from "node:crypto";
import { CATALOG_REV } from "@/lib/catalog";
import { createMemoryStore } from "@/lib/db/memory";
import { createMysqlStore, migrateAndSeed, mysqlConfigured } from "@/lib/db/mysql";
import type { Store } from "@/lib/db/types";
import { fallbackSpec } from "@/lib/intent/fallback";
import { EXAMPLES } from "@/lib/intent/presets";

const STORE_KEY = "__dinkDesignStore";

export function getStore(): Promise<Store> {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: Promise<Store> };
  if (!holder[STORE_KEY]) {
    holder[STORE_KEY] = openStore().catch((error: unknown) => {
      holder[STORE_KEY] = undefined;
      throw error;
    });
  }
  return holder[STORE_KEY];
}

async function openStore(): Promise<Store> {
  const store = mysqlConfigured() ? await openMysql() : createMemoryStore();
  for (const example of EXAMPLES) {
    const hash = createHash("sha256").update(`${CATALOG_REV}|${example.prompt.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex");
    const existing = await store.cacheGet(`spec:${hash}`);
    if (!existing) await store.cacheSet(`spec:${hash}`, fallbackSpec(example.prompt).spec, 24 * 30);
  }
  return store;
}

async function openMysql(): Promise<Store> {
  await migrateAndSeed();
  return createMysqlStore();
}

export type { Store } from "@/lib/db/types";
