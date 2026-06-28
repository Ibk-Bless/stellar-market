import { useState, useEffect } from "react";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const THRESHOLDS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "second", ms: 60_000 },
  { unit: "minute", ms: 3_600_000 },
  { unit: "hour", ms: 86_400_000 },
  { unit: "day", ms: 2_592_000_000 },
  { unit: "month", ms: 31_536_000_000 },
  { unit: "year", ms: Infinity },
];

export function getRelativeTime(date: Date): string {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  for (const { unit, ms } of THRESHOLDS) {
    if (abs < ms || unit === "year") {
      const divisors: Record<string, number> = {
        second: 1_000,
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
        month: 2_592_000_000,
        quarter: 7_776_000_000,
        year: 31_536_000_000,
      };
      const value = Math.round(diff / divisors[unit]);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, "second");
}

export function useRelativeTime(date: Date, intervalMs = 60_000): string {
  const [label, setLabel] = useState(() => getRelativeTime(date));

  useEffect(() => {
    setLabel(getRelativeTime(date));
    const id = setInterval(() => setLabel(getRelativeTime(date)), intervalMs);
    return () => clearInterval(id);
  }, [date, intervalMs]);

  return label;
}
