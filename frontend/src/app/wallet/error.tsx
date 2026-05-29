"use client";

import ErrorFallback from "@/components/ErrorFallback";
import { logError } from "@/utils/errorLogger";

export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  logError(error, "page");
  return <ErrorFallback error={error} reset={reset} />;
}
