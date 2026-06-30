"use client";

/**
 * Formats an ISO timestamp into the user's local timezone using Intl.DateTimeFormat.
 * Example output: "15 Jun 2026, 10:32 PM"
 */
export function formatLocalTimestamp(isoString: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

/**
 * Formats an ISO timestamp as a UTC reference string for tooltip display.
 * Example output: "UTC: 2026-06-15 14:32"
 */
export function formatUtcTimestamp(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `UTC: ${year}-${month}-${day} ${hours}:${minutes}`;
}

interface LocalTimestampProps {
  isoString: string;
  className?: string;
}

/**
 * Renders a locale-aware timestamp with a hover tooltip showing the UTC equivalent.
 * Replaces raw `new Date(ts).toISOString()` / `toLocaleString()` calls.
 */
export default function LocalTimestamp({ isoString, className }: LocalTimestampProps) {
  return (
    <time
      dateTime={isoString}
      title={formatUtcTimestamp(isoString)}
      className={className}
    >
      {formatLocalTimestamp(isoString)}
    </time>
  );
}
