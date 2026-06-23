"use client";

import { useState, useRef } from "react";
import { X, AlertCircle, Loader2, Paperclip, Upload } from "lucide-react";
import axios, { AxiosError } from "axios";
import { useWallet } from "@/context/WalletContext";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Job } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

type RaiseDisputeModalProps = {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function RaiseDisputeModal({
  job,
  isOpen,
  onClose,
  onSuccess,
}: RaiseDisputeModalProps) {
  const { signAndBroadcastTransaction } = useWallet();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { open: isOpen, onClose });

  const [reason, setReason] = useState("");
  const [minVotes, setMinVotes] = useState<number>(3);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonTouched, setReasonTouched] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const isEscrowFunded = job.escrowStatus === "FUNDED";

  const trimmedReason = reason.trim();
  const reasonError =
    trimmedReason.length === 0
      ? "Please describe the dispute reason."
      : trimmedReason.length < 20
        ? "Please describe the dispute in at least 20 characters."
        : null;
  const canSubmit = isEscrowFunded && !processing && !reasonError;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const incoming = Array.from(e.target.files || []);

    const combined = [...selectedFiles, ...incoming];

    if (combined.length > MAX_FILES) {
      setFileError(`You may attach up to ${MAX_FILES} files.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const oversized = incoming.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      setFileError(
        `"${oversized.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFiles(combined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReasonTouched(true);

    if (!isEscrowFunded) {
      setError("Escrow must be funded before a dispute can be raised.");
      return;
    }

    if (reasonError) {
      setError(reasonError);
      return;
    }

    if (reason.length > 2000) {
      setError(
        "Reason must not exceed 2000 characters. Please shorten your description.",
      );
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");

      // 1. Get XDR
      const res = await axios.post(
        `${API_URL}/disputes/init-raise`,
        { jobId: job.id, reason, minVotes },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      // 2. Sign & Broadcast
      const txResult = await signAndBroadcastTransaction(res.data.xdr);

      if (!txResult.success) {
        throw new Error(txResult.error || "Transaction failed");
      }

      // 3. Confirm
      const confirmRes = await axios.post(
        `${API_URL}/disputes/confirm-tx`,
        {
          hash: txResult.hash,
          type: "RAISE_DISPUTE",
          jobId: job.id,
          onChainDisputeId: 1,
          respondentId: res.data.respondentId,
          reason,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const newDisputeId: string | undefined =
        confirmRes.data?.dispute?.id ?? confirmRes.data?.id;

      if (selectedFiles.length > 0 && newDisputeId) {
        setUploading(true);
        setUploadProgress(0);

        const hashes: string[] = [];
        for (const file of selectedFiles) {
          const buffer = await file.arrayBuffer();
          const hashBuffer = await window.crypto.subtle.digest(
            "SHA-256",
            buffer,
          );
          const hex = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          hashes.push(hex);
        }

        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append("files", file));
        formData.append("hashes", JSON.stringify(hashes));

        try {
          await axios.post(
            `${API_URL}/disputes/${newDisputeId}/evidence`,
            formData,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "multipart/form-data",
              },
              onUploadProgress: (progressEvent) => {
                if (progressEvent.total) {
                  const pct = Math.round(
                    (progressEvent.loaded * 100) / progressEvent.total,
                  );
                  setUploadProgress(pct);
                }
              },
            },
          );
        } catch {
          setError(
            "Dispute created, but evidence upload failed. You can retry from the dispute page.",
          );
          setUploading(false);
          onSuccess();
          onClose();
          return;
        }

        setUploading(false);
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof AxiosError
          ? err.response?.data?.error
          : err instanceof Error
            ? err.message
            : "An error occurred";
      setError(errorMsg || "An error occurred");
    } finally {
      setProcessing(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div ref={modalRef} className="bg-theme-bg border border-theme-border rounded-xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95">
        <div className="flex justify-between items-center p-4 border-b border-theme-border">
          <h2 className="text-lg font-semibold text-theme-heading flex items-center gap-2">
            <AlertCircle className="text-theme-error" size={20} />
            Raise a Dispute
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text hover:text-theme-heading p-1 rounded-full hover:bg-theme-border/50"
            disabled={processing}
            aria-label="Close raise dispute modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 text-sm text-theme-error bg-theme-error/10 border border-theme-error/20 rounded-lg">
              {error}
            </div>
          )}

          {!isEscrowFunded && (
            <div className="p-3 text-sm text-theme-error bg-theme-error/10 border border-theme-error/20 rounded-lg">
              Escrow must be funded before a dispute can be raised. Current
              status: {job.escrowStatus}
            </div>
          )}

          <div>
            <label htmlFor="dispute-reason" className="block text-sm font-medium text-theme-heading mb-1">
              Reason for Dispute
            </label>
            <textarea
              id="dispute-reason"
              className="input-field min-h-[100px] resize-y"
              placeholder="Explain clearly why you are initiating a dispute. Provide specific details about unfulfilled requirements or issues."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
              disabled={processing}
              maxLength={2000}
              required
            />
            <div className="flex justify-between items-center mt-1">
              <p className="text-xs text-theme-text">
                This will be visible to community voters.
              </p>
              <span
                className={`text-xs tabular-nums ${
                  reason.length >= 2000
                    ? "text-theme-error font-semibold"
                    : "text-theme-text"
                }`}
              >
                {reason.length} / 2000
              </span>
            </div>
            {reason.length >= 2000 && (
              <p className="text-xs text-theme-error mt-1">
                Character limit reached. Please shorten your description.
              </p>
            )}
            {reasonTouched && reasonError && (
              <p className="text-xs text-theme-error mt-1">{reasonError}</p>
            )}
          </div>

          <div>
            <label htmlFor="dispute-min-votes" className="block text-sm font-medium text-theme-heading mb-1">
              Minimum Votes Required
            </label>
            <input
              id="dispute-min-votes"
              type="number"
              min={3}
              max={21}
              className="input-field"
              value={minVotes}
              onChange={(e) => setMinVotes(parseInt(e.target.value))}
              disabled={processing}
              required
            />
            <p className="text-xs text-theme-text mt-1">
              The dispute automatically resolves when this many votes are cast.
            </p>
          </div>

          {/* Evidence upload section */}
          <div>
            <label htmlFor="dispute-evidence" className="block text-sm font-medium text-theme-heading mb-1">
              Supporting Evidence{" "}
              <span className="font-normal text-theme-text">(optional)</span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || selectedFiles.length >= MAX_FILES}
              className="flex items-center gap-2 text-sm px-3 py-2 border border-dashed border-theme-border rounded-lg text-theme-text hover:border-stellar-blue hover:text-stellar-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
              aria-controls="dispute-evidence"
            >
              <Paperclip size={14} />
              {selectedFiles.length >= MAX_FILES
                ? `Max ${MAX_FILES} files reached`
                : `Attach files (up to ${MAX_FILES}, ${MAX_FILE_SIZE_MB} MB each)`}
            </button>
            <input
              ref={fileInputRef}
              id="dispute-evidence"
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={processing}
            />
            {fileError && (
              <p className="text-xs text-theme-error mt-1">{fileError}</p>
            )}
            {selectedFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {selectedFiles.map((file, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between text-xs bg-theme-card border border-theme-border rounded-md px-2 py-1.5"
                  >
                    <span className="truncate text-theme-text max-w-[260px]">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={processing}
                      className="ml-2 text-theme-text-muted hover:text-theme-error transition-colors flex-shrink-0"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* IPFS upload progress indicator */}
          {uploading && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-stellar-blue">
                <Upload size={12} className="animate-bounce" />
                Uploading evidence to IPFS… {uploadProgress}%
              </div>
              <div className="w-full bg-theme-border rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-stellar-blue h-1.5 rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={processing}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={processing || !canSubmit}
              className="btn-primary flex-1 bg-theme-error hover:bg-theme-error/90 border border-transparent text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="animate-spin" size={16} />{" "}
                  {uploading ? "Uploading…" : "Submitting..."}
                </span>
              ) : (
                "Raise Dispute"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
