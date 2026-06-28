"use client";

import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import { X, Star, Loader2, Clock } from "lucide-react";
import axios, { AxiosError } from "axios";
import { Job } from "@/types";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type ReviewModalProps = {
  job: Job;
  revieweeId: string;
  revieweeName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ReviewModal({
  job,
  revieweeId,
  revieweeName,
  isOpen,
  onClose,
  onSuccess,
}: ReviewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (rating === 0) {
      setError("Please select a star rating before submitting.");
      return;
    }

    if (comment.length > 500) {
      setError("Review must be 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token =
        localStorage.getItem("stellarmarket_jwt") ??
        localStorage.getItem("token");

      if (!token) {
        throw new Error("Please log in again to submit a review.");
      }

      await axios.post(
        `${API_URL}/jobs/${job.id}/reviews`,
        { rating, body: comment.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setSubmitted(true);
      onSuccess();
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ error?: string }>;
      const status = axiosErr?.response?.status;
      const apiError = axiosErr?.response?.data?.error;

      if (status === 409) {
        setError("You have already reviewed this job.");
      } else {
        setError(
          apiError ??
            (err instanceof Error ? err.message : "An error occurred. Please try again."),
        );
      }
      setSubmitting(false);
    }
  };

  const ratingLabels: Record<number, string> = {
    1: "Poor",
    2: "Fair",
    3: "Good",
    4: "Very Good",
    5: "Excellent",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-theme-bg border border-theme-border rounded-xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-theme-border">
          <h2
            id="review-modal-title"
            className="text-lg font-semibold text-theme-heading"
          >
            Leave a Review
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text hover:text-theme-heading p-1 rounded-full hover:bg-theme-border/50 transition-colors"
            disabled={submitting}
            aria-label="Close review modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Success state */}
        {submitted ? (
          <div className="p-6 space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-theme-success/10 border border-theme-success/20 flex items-center justify-center mx-auto">
              <Star size={28} className="fill-theme-warning text-theme-warning" />
            </div>
            <h3 className="text-lg font-semibold text-theme-heading">
              Review submitted!
            </h3>
            <div className="p-3 bg-stellar-blue/5 border border-stellar-blue/20 rounded-lg flex items-start gap-2 text-left">
              <Clock size={16} className="text-stellar-blue flex-shrink-0 mt-0.5" />
              <p className="text-sm text-theme-text">
                Your review will be visible once the other party also submits
                theirs, or after 7 days — whichever comes first.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary w-full"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4" noValidate>
            {error && (
              <div
                role="alert"
                className="p-3 text-sm text-theme-error bg-theme-error/10 border border-theme-error/20 rounded-lg"
              >
                {error}
              </div>
            )}

            <p className="text-sm text-theme-text">
              How was your experience working with{" "}
              <span className="font-medium text-theme-heading">
                {revieweeName}
              </span>{" "}
              on{" "}
              <span className="font-medium text-theme-heading">
                {job.title}
              </span>
              ?
            </p>

            {/* Star rating */}
            <div>
              <div
                className="flex items-center justify-center gap-2 py-3"
                role="radiogroup"
                aria-label="Star rating"
                aria-required="true"
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={rating === star}
                    aria-label={`${star} star${star > 1 ? "s" : ""} — ${ratingLabels[star]}`}
                    onClick={() => {
                      setRating(star);
                      setError(null);
                    }}
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-blue rounded"
                    disabled={submitting}
                  >
                    <Star
                      size={36}
                      className={
                        star <= (hoveredRating || rating)
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-theme-border"
                      }
                    />
                  </button>
                ))}
              </div>
              {(hoveredRating || rating) > 0 && (
                <p className="text-center text-sm text-theme-text">
                  {ratingLabels[hoveredRating || rating]}
                </p>
              )}
            </div>

            {/* Comment */}
            <div>
              <label
                htmlFor="review-comment"
                className="block text-sm font-medium text-theme-heading mb-1"
              >
                Written review{" "}
                <span className="text-theme-text font-normal">(optional)</span>
              </label>
              <textarea
                id="review-comment"
                className="input-field min-h-[90px] resize-y"
                placeholder="Share your experience working on this job..."
                value={comment}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                  setComment(e.target.value)
                }
                maxLength={500}
                disabled={submitting}
              />
              <p className="text-xs text-theme-text mt-1 text-right">
                {comment.length}/500
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="btn-secondary flex-1"
              >
                Skip for now
              </button>
              <button
                type="submit"
                disabled={submitting || rating === 0}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                aria-disabled={rating === 0}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Submitting…
                  </>
                ) : (
                  "Submit Review"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
