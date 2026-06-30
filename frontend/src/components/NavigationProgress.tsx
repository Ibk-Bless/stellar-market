"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPathRef = useRef<string>("");

  const currentKey = pathname + searchParams.toString();

  function clearTimers() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  // Start the bar on navigation (key change)
  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev === currentKey) return;

    // First render — just record key, no animation
    if (prev === "") {
      prevPathRef.current = currentKey;
      return;
    }

    prevPathRef.current = currentKey;

    // Start bar
    setProgress(0);
    setVisible(true);
    clearTimers();

    let value = 0;
    intervalRef.current = setInterval(() => {
      value += Math.random() * 15;
      if (value > 85) value = 85; // clamp before completion
      setProgress(value);
    }, 200);

    // Complete after short delay
    timerRef.current = setTimeout(() => {
      clearTimers();
      setProgress(100);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }, 500);

    return clearTimers;
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none"
    >
      <div
        className="h-full bg-stellar-blue transition-all duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress > 0 ? 1 : 0 }}
      />
    </div>
  );
}
