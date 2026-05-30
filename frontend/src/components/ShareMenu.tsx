"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/Toast";

interface ShareMenuProps {
  title: string;
  url: string;
  description?: string;
}

function toAbsoluteUrl(url: string) {
  if (typeof window === "undefined") return url;

  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return window.location.href;
  }
}

export default function ShareMenu({
  title,
  url,
  description = "",
}: ShareMenuProps) {
  const [sharing, setSharing] = useState(false);
  const { toast } = useToast();

  const copyToClipboard = async (shareUrl: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy the link.");
    }
  };

  const handleShare = async () => {
    const shareUrl = toAbsoluteUrl(url);

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        setSharing(true);
        await navigator.share({
          title,
          text: description,
          url: shareUrl,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      } finally {
        setSharing(false);
      }
    }

    await copyToClipboard(shareUrl);
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-theme-text hover:text-theme-heading bg-theme-bg border border-theme-border rounded-lg transition-colors"
      title="Share"
      aria-label="Share this page"
      disabled={sharing}
    >
      <Share2 size={18} />
      <span className="hidden sm:inline">{sharing ? "Sharing..." : "Share"}</span>
      <span className="sm:hidden">{sharing ? "..." : "Share"}</span>
    </button>
  );
}
