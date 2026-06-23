"use client";

import { useEffect, useState, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { prepareSorobanTransaction, type TransactionPreview } from "@/utils/stellar";

type TransactionConfirmationModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel: string;
  transactionXdr: string | null;
  onClose: () => void;
  onConfirm: (preparedXdr: string) => Promise<void>;
  /** Optional content rendered above the transaction preview (e.g. rate info). */
  extraContent?: React.ReactNode;
};

function formatStroops(value: bigint): string {
  return `${(Number(value) / 10_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  })} XLM`;
}

export default function TransactionConfirmationModal({
  isOpen,
  title,
  description,
  actionLabel,
  transactionXdr,
  onClose,
  onConfirm,
  extraContent,
}: TransactionConfirmationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const [preview, setPreview] = useState<TransactionPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !transactionXdr) {
      setPreview(null);
      setPreviewError(null);
      setLoadingPreview(false);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);

    void prepareSorobanTransaction(transactionXdr)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(
          err instanceof Error ? err.message : "Unable to preview transaction.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, transactionXdr]);

  if (!isOpen) return null;

  const canConfirm =
    Boolean(preview?.preparedXdr) &&
    !previewError &&
    !loadingPreview &&
    !submitting &&
    !preview?.requiresRestoreFootprint;

  const handleConfirm = async () => {
    if (!preview?.preparedXdr || preview.requiresRestoreFootprint) return;
    setSubmitting(true);
    try {
      await onConfirm(preview.preparedXdr);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div ref={modalRef} className="w-full max-w-xl overflow-hidden rounded-2xl border border-theme-border bg-theme-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-theme-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-theme-heading">{title}</h2>
            <p className="text-sm text-theme-text">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-theme-text transition-colors hover:bg-theme-border/50 hover:text-theme-heading"
            disabled={submitting}
            aria-label="Close confirmation modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {extraContent}
          {loadingPreview && (
            <div className="flex items-center gap-3 rounded-xl border border-theme-border bg-theme-card px-4 py-4 text-sm text-theme-text">
              <Loader2 className="animate-spin text-stellar-blue" size={18} />
              Simulating transaction to estimate fees and prepare the signed payload.
            </div>
          )}

          {previewError && (
            <div className="flex items-start gap-3 rounded-xl border border-theme-error/20 bg-theme-error/10 px-4 py-4 text-sm text-theme-error">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <p>{previewError}</p>
            </div>
          )}

          {preview && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-theme-border bg-theme-card px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-theme-text-muted">
                  Estimated fee
                </div>
                <div className="mt-1 text-sm font-semibold text-theme-heading">
                  {formatStroops(preview.estimatedTotalFeeStroops)}
                </div>
                <p className="mt-1 text-xs text-theme-text">
                  Includes the Soroban resource fee and the base network fee.
                </p>
              </div>

              <div className="rounded-xl border border-theme-border bg-theme-card px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-theme-text-muted">
                  Resource fee
                </div>
                <div className="mt-1 text-sm font-semibold text-theme-heading">
                  {formatStroops(preview.estimatedResourceFeeStroops)}
                </div>
                <p className="mt-1 text-xs text-theme-text">
                  Derived from Stellar RPC simulation.
                </p>
              </div>
            </div>
          )}

          {preview?.requiresRestoreFootprint && (
            <div className="rounded-xl border border-theme-warning/30 bg-theme-warning/10 px-4 py-4 text-sm text-theme-warning">
              This transaction needs a restore-footprint step before it can be
              submitted. The current flow only supports direct submission.
            </div>
          )}

          <div className="flex items-start gap-3 rounded-xl border border-theme-border bg-theme-card px-4 py-4">
            <CheckCircle2 className="mt-0.5 shrink-0 text-theme-success" size={18} />
            <div className="space-y-1">
              <div className="text-sm font-medium text-theme-heading">
                What happens next
              </div>
              <p className="text-sm text-theme-text">
                After you confirm, the app will sign the prepared XDR with
                Freighter and submit it to the Stellar network.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-theme-border px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary sm:min-w-32"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            className="btn-primary sm:min-w-44 disabled:opacity-50"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} />
                Confirming...
              </span>
            ) : (
              actionLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
