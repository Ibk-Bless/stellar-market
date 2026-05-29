"use client";

import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";

interface ErrorFallbackProps {
  error?: Error;
  reset?: () => void;
  title?: string;
  message?: string;
}

export default function ErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again or return to the homepage.",
}: ErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4 min-h-[60vh]">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-theme-error/10 border border-theme-error/20 mb-6">
        <AlertTriangle className="text-theme-error" size={36} />
      </div>

      <h2 className="text-2xl font-bold text-theme-heading mb-3">{title}</h2>
      <p className="text-theme-text max-w-md mx-auto mb-8">{message}</p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        {reset && (
          <button onClick={() => reset()} className="btn-primary flex items-center gap-2">
            <RefreshCw size={16} />
            Try Again
          </button>
        )}
        <Link href="/" className="btn-secondary flex items-center gap-2">
          <Home size={16} />
          Go Home
        </Link>
      </div>

      {error && process.env.NODE_ENV === "development" && (
        <details className="mt-8 w-full max-w-lg text-left">
          <summary className="text-sm text-theme-text/60 cursor-pointer hover:text-theme-text transition-colors">
            Error details
          </summary>
          <pre className="mt-2 p-4 rounded-lg bg-theme-card border border-theme-border text-xs text-theme-text overflow-auto max-h-48">
            {error.name}: {error.message}
            {"\n"}
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}
