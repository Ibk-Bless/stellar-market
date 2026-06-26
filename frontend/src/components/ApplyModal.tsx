"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Job } from "@/types";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

const TIMELINE_OPTIONS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "2 months", days: 60 },
  { label: "Custom", days: 0 },
];

const MIN_PROPOSAL_LENGTH = 20;
const MAX_PROPOSAL_LENGTH = 2000;
const PROPOSAL_WARN_THRESHOLD = 1800;

interface ApplyModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ApplyModal({
  job,
  isOpen,
  onClose,
  onSuccess,
}: ApplyModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const [proposal, setProposal] = useState("");
  const [bidAmount, setBidAmount] = useState(job.budget);
  const [selectedTimeline, setSelectedTimeline] = useState(TIMELINE_OPTIONS[0].label);
  const [customDays, setCustomDays] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setProposal("");
      setBidAmount(job.budget);
      setSelectedTimeline(TIMELINE_OPTIONS[0].label);
      setCustomDays("");
      setError("");
      setValidationErrors({});
    }
  }, [isOpen, job.budget]);

  const getEstimatedDuration = useCallback((): number => {
    const option = TIMELINE_OPTIONS.find((o) => o.label === selectedTimeline);
    if (option && option.days > 0) return option.days;
    return typeof customDays === "number" ? customDays : 0;
  }, [selectedTimeline, customDays]);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    const plainText = proposal.replace(/[#*_~`>\-\[\]()!|]/g, "").trim();

    if (!proposal.trim()) {
      errors.proposal = "Cover letter is required.";
    } else if (plainText.length < MIN_PROPOSAL_LENGTH) {
      errors.proposal = `Cover letter must be at least ${MIN_PROPOSAL_LENGTH} characters.`;
    } else if (plainText.length > MAX_PROPOSAL_LENGTH) {
      errors.proposal = `Cover letter must be less than ${MAX_PROPOSAL_LENGTH} characters.`;
    }

    if (!bidAmount || bidAmount <= 0) {
      errors.bidAmount = "Proposed budget must be a positive number.";
    }

    const duration = getEstimatedDuration();
    if (duration <= 0) {
      errors.estimatedDuration = "Please select or enter a valid timeline.";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [proposal, bidAmount, getEstimatedDuration]);

  const isFormValid = useCallback((): boolean => {
    const plainText = proposal.replace(/[#*_~`>\-\[\]()!|]/g, "").trim();
    if (!plainText || plainText.length < MIN_PROPOSAL_LENGTH || plainText.length > MAX_PROPOSAL_LENGTH) return false;
    if (!bidAmount || bidAmount <= 0) return false;
    const duration = getEstimatedDuration();
    if (duration <= 0) return false;
    return true;
  }, [proposal, bidAmount, getEstimatedDuration]);

  const handleSubmit = async () => {
    if (submitting) return;
    setError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      await axios.post(
        `${API}/applications/jobs/${job.id}/apply`,
        {
          jobId: job.id,
          proposal,
          bidAmount,
          estimatedDuration: getEstimatedDuration(),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success("Application submitted!");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const plainTextLength = proposal.replace(/[#*_~`>\-\[\]()!|]/g, "").trim().length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        ref={modalRef}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-theme-card border border-theme-border rounded-xl p-6 mx-4"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-theme-heading">
            Apply for this Job
          </h2>
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            className="text-theme-text hover:text-theme-heading transition-colors"
            aria-label="Close apply modal"
            disabled={submitting}
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-theme-body mb-6">
          {job.title} &mdash; {job.budget.toLocaleString()} XLM
        </p>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-theme-error/10 border border-theme-error/30 text-theme-error text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-theme-heading mb-2">
              Cover Letter
            </label>
            <div data-color-mode="dark" role="textbox" aria-multiline="true" aria-label="Cover letter editor">
              <MDEditor
                value={proposal}
                onChange={(val) => setProposal(val || "")}
                height={240}
                preview="edit"
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              {validationErrors.proposal ? (
                <span className="text-theme-error text-xs">
                  {validationErrors.proposal}
                </span>
              ) : (
                <span className="text-xs text-theme-body">
                  {MIN_PROPOSAL_LENGTH}–{MAX_PROPOSAL_LENGTH} characters
                </span>
              )}
              <span
                className={`text-xs tabular-nums ${
                  plainTextLength > MAX_PROPOSAL_LENGTH
                    ? "text-theme-error"
                    : plainTextLength >= PROPOSAL_WARN_THRESHOLD
                    ? "text-yellow-500"
                    : plainTextLength >= MIN_PROPOSAL_LENGTH
                    ? "text-theme-success"
                    : "text-theme-error"
                }`}
                aria-live="polite"
              >
                {plainTextLength} / {MAX_PROPOSAL_LENGTH}
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="apply-bid-amount"
              className="block text-sm font-medium text-theme-heading mb-2"
            >
              Proposed Budget (XLM)
            </label>
            <input
              id="apply-bid-amount"
              type="number"
              min="1"
              step="any"
              className="input-field"
              value={bidAmount}
              onChange={(e) => setBidAmount(parseFloat(e.target.value) || 0)}
            />
            {validationErrors.bidAmount && (
              <span className="text-theme-error text-xs mt-1 block">
                {validationErrors.bidAmount}
              </span>
            )}
          </div>

          <div>
            <label
              htmlFor="apply-timeline"
              className="block text-sm font-medium text-theme-heading mb-2"
            >
              Estimated Timeline
            </label>
            <select
              id="apply-timeline"
              className="input-field"
              value={selectedTimeline}
              onChange={(e) => setSelectedTimeline(e.target.value)}
            >
              {TIMELINE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.label}>
                  {opt.label}
                </option>
              ))}
            </select>
            {selectedTimeline === "Custom" && (
              <input
                id="apply-custom-days"
                type="number"
                min="1"
                placeholder="Number of days"
                className="input-field mt-2"
                value={customDays}
                onChange={(e) =>
                  setCustomDays(e.target.value ? parseInt(e.target.value, 10) : "")
                }
              />
            )}
            {validationErrors.estimatedDuration && (
              <span className="text-theme-error text-xs mt-1 block">
                {validationErrors.estimatedDuration}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-theme-border">
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            className="btn-secondary flex-1"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
            disabled={submitting || !isFormValid()}
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? "Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
}
