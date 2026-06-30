"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

type Props = {
  isOpen: boolean;
  milestoneTitle: string;
  milestoneAmount: number;
  freelancerName: string;
  milestoneDescription: string;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

const COUNTDOWN_SECONDS = 3;
const CONFIRM_WORD = "APPROVE";

export default function ApproveMilestoneModal({
  isOpen,
  milestoneTitle,
  milestoneAmount,
  freelancerName,
  milestoneDescription,
  isLoading,
  onClose,
  onConfirm,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const wordMatches = inputValue.trim().toUpperCase() === CONFIRM_WORD;
  const isReady = countdown === 0;

  // Start countdown when the word matches; cancel if it changes.
  useEffect(() => {
    if (!wordMatches) {
      setCountdown(null);
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [wordMatches]);

  // Reset state when modal closes.
  useEffect(() => {
    if (!isOpen) {
      setInputValue("");
      setCountdown(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        ref={modalRef}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-theme-border bg-theme-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-theme-success" size={20} />
            <h2 className="text-lg font-semibold text-theme-heading">
              Approve Milestone
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-full p-2 text-theme-text transition-colors hover:bg-theme-border/50 hover:text-theme-heading"
            aria-label="Close approve milestone modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {/* Summary */}
          <div className="rounded-xl border border-theme-border bg-theme-card px-4 py-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-theme-text">Milestone</span>
              <span className="font-medium text-theme-heading">{milestoneTitle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text">Amount to release</span>
              <span className="font-semibold text-theme-success">
                {milestoneAmount.toLocaleString()} XLM
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text">Freelancer</span>
              <span className="font-medium text-theme-heading">{freelancerName}</span>
            </div>
            {milestoneDescription && (
              <div className="pt-2 border-t border-theme-border">
                <p className="text-theme-text text-xs">{milestoneDescription}</p>
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-3 rounded-xl border border-theme-warning/30 bg-theme-warning/10 px-4 py-3 text-sm text-theme-warning">
            <AlertTriangle className="mt-0.5 shrink-0" size={16} />
            <p>
              This will release funds from escrow on-chain. This action cannot
              be undone.
            </p>
          </div>

          {/* Confirmation input */}
          <div>
            <label
              htmlFor="approve-confirm-input"
              className="block text-sm text-theme-text mb-1.5"
            >
              Type <span className="font-semibold text-theme-heading">APPROVE</span> to confirm
            </label>
            <input
              id="approve-confirm-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isLoading}
              placeholder="APPROVE"
              className="w-full rounded-lg border border-theme-border bg-theme-bg px-3 py-2 text-sm text-theme-heading placeholder:text-theme-text/40 focus:border-stellar-purple focus:outline-none focus:ring-1 focus:ring-stellar-purple disabled:opacity-50"
              autoComplete="off"
            />
            {wordMatches && countdown !== null && countdown > 0 && (
              <p className="mt-1.5 text-xs text-theme-text flex items-center gap-1.5">
                <Loader2 className="animate-spin" size={12} />
                Enabling in {countdown}s…
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-theme-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="btn-secondary py-2 px-4 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isReady || isLoading}
            className="btn-primary py-2 px-4 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Approving…
              </>
            ) : (
              <>
                <ShieldCheck size={14} />
                Confirm Approval
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
