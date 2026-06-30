"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

const STROOPS_PER_XLM = 10_000_000;
const PRICE_SCALE = 10_000_000;

export type DepositRateSnapshot = {
  twapPriceStroops: string;
  samples: number;
  agreedValueStroops: string;
  depositedValueStroops: string;
  maxSlippageBps: number;
  ledger: number;
};

type DepositRateInfoProps = {
  /** Agreed job value in XLM stroops (string to preserve i128 precision). */
  agreedValueStroops: string;
  /** Tolerated downside deviation applied at funding, in basis points. */
  maxSlippageBps: number;
  /**
   * The TWAP snapshot the contract will validate against, if already known.
   * When provided, the equivalent value and a live-rate drift warning are shown.
   */
  snapshot?: DepositRateSnapshot | null;
  /**
   * Optional current live price (XLM stroops per token unit, scaled by 1e7) used
   * to warn when the market has moved >1% since the TWAP snapshot was taken.
   */
  liveTwapPriceStroops?: string | null;
};

function stroopsToXlm(stroops: string): number {
  return Number(stroops) / STROOPS_PER_XLM;
}

function formatXlm(stroops: string): string {
  return `${stroopsToXlm(stroops).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  })} XLM`;
}

/**
 * Deposit-time exchange-rate disclosure for the funding confirmation modal.
 * Shows the agreed value, the TWAP-derived equivalent value, and warns when the
 * live rate has drifted more than 1% from the snapshot the contract will use.
 */
export default function DepositRateInfo({
  agreedValueStroops,
  maxSlippageBps,
  snapshot,
  liveTwapPriceStroops,
}: DepositRateInfoProps) {
  const [driftPct, setDriftPct] = useState<number | null>(null);

  useEffect(() => {
    if (!snapshot || !liveTwapPriceStroops) {
      setDriftPct(null);
      return;
    }
    const snap = Number(snapshot.twapPriceStroops);
    const live = Number(liveTwapPriceStroops);
    if (snap <= 0) {
      setDriftPct(null);
      return;
    }
    setDriftPct(((live - snap) / snap) * 100);
  }, [snapshot, liveTwapPriceStroops]);

  const twapRate = snapshot ? Number(snapshot.twapPriceStroops) / PRICE_SCALE : null;
  const driftExceeds1Pct = driftPct !== null && Math.abs(driftPct) > 1;

  return (
    <div className="rounded-lg border border-theme-border bg-theme-card p-4 space-y-2 text-sm">
      <div className="flex items-center gap-2 text-theme-heading font-medium">
        <Info className="w-4 h-4" />
        Exchange-rate parity
      </div>

      <div className="flex items-center justify-between">
        <span className="text-theme-text">Agreed value</span>
        <span className="text-theme-heading font-medium">
          {formatXlm(agreedValueStroops)}
        </span>
      </div>

      {twapRate !== null && (
        <div className="flex items-center justify-between">
          <span className="text-theme-text">
            TWAP rate{snapshot ? ` (${snapshot.samples} samples)` : ""}
          </span>
          <span className="text-theme-heading font-medium">
            {twapRate.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM
          </span>
        </div>
      )}

      {snapshot && (
        <div className="flex items-center justify-between">
          <span className="text-theme-text">Equivalent deposit value</span>
          <span className="text-theme-heading font-medium">
            {formatXlm(snapshot.depositedValueStroops)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-theme-text">Slippage tolerance</span>
        <span className="text-theme-heading font-medium">
          {(maxSlippageBps / 100).toFixed(2)}%
        </span>
      </div>

      {driftExceeds1Pct && (
        <div className="flex items-start gap-2 rounded-md bg-theme-warning/10 border border-theme-warning/30 p-2 text-theme-warning">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            The live rate has moved {driftPct! > 0 ? "+" : ""}
            {driftPct!.toFixed(2)}% since this quote was fetched. Re-check before
            confirming.
          </span>
        </div>
      )}
    </div>
  );
}
