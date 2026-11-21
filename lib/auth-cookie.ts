import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountFromToken, SESSION_COOKIE, sessionToken, type PublicAccount } from "@/lib/accounts";

const month = 60 * 60 * 24 * 30;

export function withSession(body: unknown, account: PublicAccount, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.cookies.set(SESSION_COOKIE, sessionToken(account), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: month,
  });
  return response;
}

export async function currentAccount(): Promise<PublicAccount | null> {
  const jar = await cookies();
  return accountFromToken(jar.get(SESSION_COOKIE)?.value);
}
