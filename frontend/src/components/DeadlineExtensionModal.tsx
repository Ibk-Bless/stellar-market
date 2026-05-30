"use client";

import { useState } from "react";
import { X, AlertCircle, Loader2, Calendar } from "lucide-react";
import axios, { AxiosError } from "axios";
import { Milestone } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

type DeadlineExtensionModalProps = {
  milestone: Milestone;
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function DeadlineExtensionModal({
  milestone,
  jobId,
  isOpen,
  onClose,
  onSuccess,
}: DeadlineExtensionModalProps) {
  const [newDeadline, setNewDeadline] = useState<string>("");
  const [reason, setReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonTouched, setReasonTouched] = useState(false);

  if (!isOpen) return null;

  const currentDeadline = milestone.contractDeadline
    ? new Date(milestone.contractDeadline)
    : null;
  const minDeadline = currentDeadline
    ? new Date(currentDeadline.getTime() + 24 * 60 * 60 * 1000) // At least 24 hours from current
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  const minDeadlineStr = minDeadline.toISOString().split("T")[0];

  const trimmedReason = reason.trim();
  const reasonError =
    trimmedReason.length === 0
      ? "Please provide a reason for the extension."
      : trimmedReason.length < 10
        ? "Please provide at least 10 characters."
        : null;

  const canSubmit =
    newDeadline &&
    !processing &&
    !reasonError &&
    new Date(newDeadline) > (currentDeadline || new Date());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReasonTouched(true);

    if (!newDeadline) {
      setError("Please select a new deadline.");
      return;
    }

    if (new Date(newDeadline) <= (currentDeadline || new Date())) {
      setError("New deadline must be after the current deadline.");
      return;
    }

    if (reasonError) {
      setError(reasonError);
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");

      // Request extension
      const res = await axios.post(
        `${API_URL}/deadline-extensions/request`,
        {
          milestoneId: milestone.id,
          jobId,
          newDeadline: new Date(newDeadline).toISOString(),
          reason: trimmedReason,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      // Reset form
      setNewDeadline("");
      setReason("");
      setReasonTouched(false);

      // Notify user
      onSuccess();
      onClose();
    } catch (err: unknown) {
      let errorMsg = "Failed to request deadline extension";
      if (err instanceof AxiosError) {
        errorMsg = err.response?.data?.error || err.message;
      }
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-theme-bg-primary rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-border">
          <div className="flex items-center gap-2">
            <Calendar className="text-stellar-blue" size={24} />
            <h2 className="text-xl font-bold text-theme-heading">
              Request Deadline Extension
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Current Deadline Info */}
          {currentDeadline && (
            <div className="p-3 bg-theme-bg-secondary rounded-lg border border-theme-border">
              <p className="text-xs text-theme-text-secondary uppercase tracking-wide mb-1">
                Current Deadline
              </p>
              <p className="text-sm font-medium text-theme-heading">
                {currentDeadline.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          )}

          {/* New Deadline Input */}
          <div>
            <label className="block text-sm font-medium text-theme-heading mb-2">
              New Deadline *
            </label>
            <input
              type="datetime-local"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              min={minDeadlineStr}
              className="w-full px-4 py-2 rounded-lg bg-theme-bg-secondary border border-theme-border text-theme-heading placeholder-theme-text-secondary focus:outline-none focus:border-stellar-blue transition-colors"
              required
            />
            <p className="text-xs text-theme-text-secondary mt-1">
              Must be at least 24 hours from the current deadline
            </p>
          </div>

          {/* Reason Input */}
          <div>
            <label className="block text-sm font-medium text-theme-heading mb-2">
              Reason for Extension *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
              placeholder="Explain why you need more time..."
              className={`w-full px-4 py-2 rounded-lg bg-theme-bg-secondary border text-theme-heading placeholder-theme-text-secondary focus:outline-none transition-colors resize-none h-24 ${
                reasonTouched && reasonError
                  ? "border-theme-error focus:border-theme-error"
                  : "border-theme-border focus:border-stellar-blue"
              }`}
              required
            />
            {reasonTouched && reasonError && (
              <p className="text-xs text-theme-error mt-1 flex items-center gap-1">
                <AlertCircle size={14} />
                {reasonError}
              </p>
            )}
            <p className="text-xs text-theme-text-secondary mt-1">
              {trimmedReason.length}/500 characters
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-theme-error/10 border border-theme-error/30 rounded-lg flex items-start gap-2">
              <AlertCircle
                className="text-theme-error flex-shrink-0 mt-0.5"
                size={18}
              />
              <p className="text-sm text-theme-error">{error}</p>
            </div>
          )}

          {/* Info Box */}
          <div className="p-3 bg-stellar-blue/10 border border-stellar-blue/30 rounded-lg">
            <p className="text-xs text-stellar-blue font-medium">
              ℹ️ Both you and the other party must approve this extension before
              it takes effect on-chain.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-theme-bg-secondary text-theme-heading font-medium hover:bg-theme-bg-tertiary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex-1 px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
                canSubmit
                  ? "bg-stellar-blue text-white hover:bg-stellar-blue/90"
                  : "bg-theme-bg-secondary text-theme-text-secondary cursor-not-allowed"
              }`}
            >
              {processing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Requesting...
                </>
              ) : (
                "Request Extension"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
