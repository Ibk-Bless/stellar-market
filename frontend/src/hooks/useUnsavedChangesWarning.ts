import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function useUnsavedChangesWarning(isDirty: boolean) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    // Native beforeunload for browser refresh/close
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ""; // Legacy requirement
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    // Intercept client-side link clicks
    const handleClick = (e: MouseEvent) => {
      if (!isDirty) return;

      const target = e.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor || !anchor.href) return;

      // Ignore external links, mailto, tel, or target="_blank"
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        anchor.hasAttribute("download") ||
        anchor.target === "_blank" ||
        anchor.href.startsWith("mailto:") ||
        anchor.href.startsWith("tel:")
      ) {
        return;
      }

      // If it's exactly the current page, ignore
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      // It's an internal link leading away
      e.preventDefault();
      setTargetUrl(anchor.href);
      setShowModal(true);
    };

    // Use capture phase to ensure we catch the click before Next.js Link does
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [isDirty]);

  const confirmLeave = () => {
    setShowModal(false);
    if (targetUrl) {
      router.push(targetUrl);
    }
  };

  const cancelLeave = () => {
    setShowModal(false);
    setTargetUrl(null);
  };

  return { showModal, confirmLeave, cancelLeave };
}
