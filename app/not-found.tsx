import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-display text-4xl">That project is not here.</p>
        <Link className="mt-4 inline-block text-sm underline" href="/">
          Start a new one
        </Link>
      </div>
    </main>
  );
}
