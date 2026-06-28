"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { X, Loader2, AlertCircle, Plus, Briefcase } from "lucide-react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Job } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

const MAX_MESSAGE_LENGTH = 1000;

interface InviteToJobModalProps {
  freelancerId: string;
  freelancerName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function InviteToJobModal({
  freelancerId,
  freelancerName,
  isOpen,
  onClose,
  onSuccess,
}: InviteToJobModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load the client's own open jobs (the only ones they can invite to).
  useEffect(() => {
    if (!isOpen || !token) return;

    let cancelled = false;
    setLoadingJobs(true);
    setError("");
    setSelectedJobId(null);
    setMessage("");

    axios
      .get<{ data: Job[] }>(`${API}/jobs/mine?status=OPEN&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        if (cancelled) return;
        const open = res.data.data.filter((j) => j.status === "OPEN");
        setJobs(open);
        if (open.length > 0) setSelectedJobId(open[0].id);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load your jobs. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoadingJobs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, token]);

  const handleSubmit = useCallback(async () => {
    if (submitting || !selectedJobId) return;
    setError("");
    setSubmitting(true);
    try {
      await axios.post(
        `${API}/jobs/${selectedJobId}/invitations`,
        { freelancerId, message: message.trim() || undefined },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(`Invitation sent to ${freelancerName}.`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const apiError =
        axios.isAxiosError(err) && err.response?.data?.error
          ? (err.response.data.error as string)
          : "Failed to send invitation. Please try again.";
      setError(apiError);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, selectedJobId, freelancerId, message, token, toast, freelancerName, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Invite to job"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        ref={modalRef}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-theme-card border border-theme-border rounded-xl p-6 mx-4"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-theme-heading">Invite to Job</h2>
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            className="text-theme-text hover:text-theme-heading transition-colors"
            aria-label="Close invite modal"
            disabled={submitting}
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-theme-text mb-6">
          Invite <span className="font-semibold text-theme-heading">{freelancerName}</span> to apply
          for one of your open jobs.
        </p>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-theme-error/10 border border-theme-error/30 text-theme-error text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {loadingJobs ? (
          <div className="flex items-center justify-center py-10 text-theme-text">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-8">
            <Briefcase size={32} className="mx-auto mb-3 text-theme-text/40" />
            <p className="text-sm text-theme-text mb-4">
              You have no open jobs to invite this freelancer to.
            </p>
            <Link
              href="/post-job"
              onClick={onClose}
              className="inline-flex items-center gap-2 btn-primary text-sm"
            >
              <Plus size={16} />
              Post a new job
            </Link>
          </div>
        ) : (
          <>
            <fieldset className="space-y-2 mb-4">
              <legend className="block text-sm font-medium text-theme-heading mb-2">
                Select a job
              </legend>
              {jobs.map((job) => (
                <label
                  key={job.id}
                  htmlFor={`invite-job-${job.id}`}
                  aria-label={job.title}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedJobId === job.id
                      ? "border-stellar-blue bg-stellar-blue/5"
                      : "border-theme-border hover:bg-theme-border/30"
                  }`}
                >
                  <input
                    type="radio"
                    id={`invite-job-${job.id}`}
                    name="invite-job"
                    value={job.id}
                    checked={selectedJobId === job.id}
                    onChange={() => setSelectedJobId(job.id)}
                    className="mt-1"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-theme-heading truncate">
                      {job.title}
                    </span>
                    <span className="block text-xs text-theme-text">
                      {job.budget.toLocaleString()} XLM &middot; {job.category}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="mb-4">
              <label
                htmlFor="invite-message"
                className="block text-sm font-medium text-theme-heading mb-2"
              >
                Message <span className="text-theme-text font-normal">(optional)</span>
              </label>
              <textarea
                id="invite-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                rows={3}
                placeholder="Add a short note about why you'd like to work together…"
                className="w-full rounded-lg border border-theme-border bg-theme-bg p-3 text-sm text-theme-heading placeholder:text-theme-text/50 focus:outline-none focus:ring-2 focus:ring-stellar-blue/40"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Link
                href="/post-job"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-stellar-blue hover:text-stellar-blue/80"
              >
                <Plus size={15} />
                Post a new job
              </Link>
              <button
                onClick={handleSubmit}
                disabled={submitting || !selectedJobId}
                className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                Send Invitation
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
