"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "./Toast";
import { truncateAddress } from "@/context/WalletContext";

interface WalletAddressProps {
  address?: string | null;
  className?: string;
}

export default function WalletAddress({ address, className = "" }: WalletAddressProps) {
  const { toast } = useToast();

  if (!address) {
    return <span className={`text-theme-text ${className}`}>No wallet linked</span>;
  }

  const explorerUrl = `https://stellar.expert/explorer/testnet/account/${address}`;

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast.success("Address copied!");
  }

  return (
    <span className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <button
        type="button"
        onClick={copyAddress}
        className="inline-flex items-center gap-1.5 rounded-md border border-theme-border bg-theme-card px-2.5 py-1 text-theme-heading hover:border-stellar-blue"
        aria-label="Copy wallet address"
        title="Copy wallet address"
      >
        <span className="font-mono">{truncateAddress(address)}</span>
        <Copy size={14} className="text-theme-text" />
      </button>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-theme-border text-theme-text hover:border-stellar-blue hover:text-stellar-blue"
        aria-label="Open address in Stellar Expert"
        title="Open in Stellar Expert"
      >
        <ExternalLink size={14} />
      </a>
    </span>
  );
}
