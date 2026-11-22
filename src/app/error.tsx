"use client";
export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="py-20 text-center"><h1 className="h1">Something went wrong</h1>
      <p className="muted mt-2">Please try again. Reference: {error.digest ?? "n/a"}</p>
      <button className="btn-primary mt-6" onClick={reset}>Try again</button></div>
  );
}
