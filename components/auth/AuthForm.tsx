"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (signup && password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(signup ? { name, email, password } : { email, password }),
      });
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <main className="grain grid min-h-dvh place-items-center px-4">
      <form className="w-full max-w-md rounded-[28px] border border-line bg-elev p-6 shadow-[var(--shadow)]" onSubmit={(event) => void submit(event)}>
        <p className="text-center font-display text-sm tracking-[0.2em] text-muted">DINK</p>
        <h1 className="mt-3 text-center font-display text-4xl">{signup ? "Create an account" : "Log in"}</h1>
        <p className="mt-2 text-center text-sm text-muted">{signup ? "Save a name and password for this browser." : "Use the email and password from your account."}</p>
        <div className="mt-6 grid gap-3">
          {signup ? (
            <label className="grid gap-1 text-sm">
              Name
              <Input name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm">
            Email
            <Input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Password
            <Input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {signup ? (
            <label className="grid gap-1 text-sm">
              Confirm password
              <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </label>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
        <Button className="mt-5 w-full" type="submit" disabled={busy}>
          {busy ? "Please wait…" : signup ? "Sign up" : "Log in"}
        </Button>
        <p className="mt-4 text-center text-sm text-muted">
          {signup ? (
            <>
              Already have an account?{" "}
              <Link className="text-ink underline" href="/login">
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link className="text-ink underline" href="/signup">
                Sign up
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
