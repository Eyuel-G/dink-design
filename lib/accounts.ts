import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PublicAccount = { id: string; name: string; email: string };

type StoredAccount = PublicAccount & { salt: string; hash: string };

const directory = path.join(process.cwd(), "data");
const accountsFile = path.join(directory, "accounts.json");
const secretFile = path.join(directory, "auth.secret");

function readAccounts(): StoredAccount[] {
  if (!existsSync(accountsFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(accountsFile, "utf8")) as StoredAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StoredAccount[]) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
}

function signingSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  mkdirSync(directory, { recursive: true });
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(secretFile, "utf8").trim();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

export function createAccount(name: string, email: string, password: string): PublicAccount | { error: string } {
  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length < 1 || cleanName.length > 80) return { error: "Enter your name." };
  if (!validEmail(cleanEmail)) return { error: "Enter a valid email." };
  if (password.length < 8 || password.length > 72) return { error: "Use a password of 8 to 72 characters." };
  const accounts = readAccounts();
  if (accounts.some((account) => account.email === cleanEmail)) return { error: "An account with that email already exists." };
  const salt = randomBytes(16).toString("hex");
  const account: StoredAccount = {
    id: randomBytes(12).toString("hex"),
    name: cleanName,
    email: cleanEmail,
    salt,
    hash: hashPassword(password, salt),
  };
  accounts.push(account);
  writeAccounts(accounts);
  return { id: account.id, name: account.name, email: account.email };
}

export function authenticate(email: string, password: string): PublicAccount | null {
  const account = readAccounts().find((item) => item.email === normalizeEmail(email));
  if (!account || password.length < 1 || password.length > 72) return null;
  const actual = Buffer.from(hashPassword(password, account.salt), "hex");
  const expected = Buffer.from(account.hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { id: account.id, name: account.name, email: account.email };
}

export function sessionToken(account: PublicAccount): string {
  const body = Buffer.from(JSON.stringify({ id: account.id, name: account.name, email: account.email })).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function accountFromToken(token: string | undefined): PublicAccount | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PublicAccount;
    if (!parsed.id || !parsed.email || !parsed.name) return null;
    return { id: parsed.id, name: parsed.name, email: parsed.email };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "dink_session";
