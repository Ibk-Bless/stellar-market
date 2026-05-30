"use client";

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Calendar,
} from "lucide-react";
import axios, { AxiosError } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

interface ExtensionRequest {
  id: string;
  milestone: {
    id: string;
    title: string;
  };
  requestedBy: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  newDeadline: string;
  reason: string;
  status: string;
  clientApprovedAt?: string;
  freelancerApprovedAt?: string;
}

type DeadlineExtensionApprovalCardProps = {
  extensionRequest: ExtensionRequest;
  userRole: "client" | "freelancer";
  onApprove: () => void;
  onReject: () => void;
};

export default function DeadlineExtensionApprovalCard({
  extensionRequest,
  userRole,
  onApprove,
  onReject,
}: DeadlineExtensionApprovalCardProps) {
  const [processing, setProcessing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);

  const newDeadlineDate = new Date(extensionRequest.newDeadline);
  const isApproved =
    userRole === "client"
      ? !!extensionRequest.clientApprovedAt
      : !!extensionRequest.freelancerApprovedAt;

  const handleApprove = async () => {
    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      await axios.post(
        `${API_URL}/deadline-extensions/${extensionRequest.id}/approve`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      onApprove();
    } catch (err: unknown) {
      let errorMsg = "Failed to approve extension";
      if (err instanceof AxiosError) {
        errorMsg = err.response?.data?.error || err.message;
      }
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      setError("Please provide a reason for rejection");
      return;
    }

    setRejecting(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      await axios.post(
        `${API_URL}/deadline-extensions/${extensionRequest.id}/reject`,
        { rejectionReason: rejectionReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      onReject();
    } catch (err: unknown) {
      let errorMsg = "Failed to reject extension";
      if (err instanceof AxiosError) {
        errorMsg = err.response?.data?.error || err.message;
      }
      setError(errorMsg);
    } finally {
      setRejecting(false);
      setShowRejectForm(false);
      setRejectionReason("");
    }
  };

  return (
    <div className="card p-6 border-l-4 border-l-stellar-blue">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-theme-heading mb-1">
            {extensionRequest.milestone.title}
          </h3>
          <p className="text-sm text-theme-text-secondary">
            Requested by {extensionRequest.requestedBy.username}
          </p>
        </div>
        {isApproved && (
          <div className="flex items-center gap-1 px-3 py-1 bg-theme-success/10 rounded-full">
            <CheckCircle size={16} className="text-theme-success" />
            <span className="text-xs font-medium text-theme-success">
              You Approved
            </span>
          </div>
        )}
      </div>

      {/* Reason */}
      <div className="mb-4 p-3 bg-theme-bg-secondary rounded-lg">
        <p className="text-xs text-theme-text-secondary uppercase tracking-wide mb-1">
          Reason
        </p>
        <p className="text-sm text-theme-text">{extensionRequest.reason}</p>
      </div>

      {/* New Deadline */}
      <div className="mb-4 flex items-center gap-3 p-3 bg-stellar-blue/10 rounded-lg border border-stellar-blue/20">
        <Calendar className="text-stellar-blue flex-shrink-0" size={20} />
        <div>
          <p className="text-xs text-stellar-blue uppercase tracking-wide font-medium">
            New Deadline
          </p>
          <p className="text-sm font-semibold text-stellar-blue">
            {newDeadlineDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      {/* Approval Status */}
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div
          className={`p-2 rounded-lg ${extensionRequest.clientApprovedAt ? "bg-theme-success/10" : "bg-theme-bg-secondary"}`}
        >
          <p className="text-xs text-theme-text-secondary mb-1">Client</p>
          <p
            className={`font-medium ${extensionRequest.clientApprovedAt ? "text-theme-success" : "text-theme-text-secondary"}`}
          >
            {extensionRequest.clientApprovedAt ? "✓ Approved" : "Pending"}
          </p>
        </div>
        <div
          className={`p-2 rounded-lg ${extensionRequest.freelancerApprovedAt ? "bg-theme-success/10" : "bg-theme-bg-secondary"}`}
        >
          <p className="text-xs text-theme-text-secondary mb-1">Freelancer</p>
          <p
            className={`font-medium ${extensionRequest.freelancerApprovedAt ? "text-theme-success" : "text-theme-text-secondary"}`}
          >
            {extensionRequest.freelancerApprovedAt ? "✓ Approved" : "Pending"}
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-theme-error/10 border border-theme-error/30 rounded-lg flex items-start gap-2">
          <AlertCircle
            className="text-theme-error flex-shrink-0 mt-0.5"
            size={18}
          />
          <p className="text-sm text-theme-error">{error}</p>
        </div>
      )}

      {/* Rejection Form */}
      {showRejectForm && (
        <div className="mb-4 p-4 bg-theme-error/10 rounded-lg border border-theme-error/20">
          <label className="block text-sm font-medium text-theme-heading mb-2">
            Reason for Rejection
          </label>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Explain why you're rejecting this extension..."
            className="w-full px-3 py-2 rounded-lg bg-theme-bg-secondary border border-theme-border text-theme-heading placeholder-theme-text-secondary focus:outline-none focus:border-theme-error transition-colors resize-none h-20"
          />
        </div>
      )}

      {/* Actions */}
      {!isApproved && (
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={processing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-theme-success text-white rounded-lg font-medium hover:bg-theme-success/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Approve
              </>
            )}
          </button>
          <button
            onClick={() => setShowRejectForm(!showRejectForm)}
            disabled={processing || rejecting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-theme-error/20 text-theme-error rounded-lg font-medium hover:bg-theme-error/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showRejectForm ? (
              "Cancel"
            ) : (
              <>
                <XCircle size={18} /> Reject
              </>
            )}
          </button>
        </div>
      )}

      {/* Reject Confirmation */}
      {showRejectForm && (
        <div className="flex gap-3 mt-3">
          <button
            onClick={handleReject}
            disabled={rejecting || !rejectionReason.trim()}
            className="flex-1 px-4 py-2 bg-theme-error text-white rounded-lg font-medium hover:bg-theme-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rejecting ? "Rejecting..." : "Confirm Rejection"}
          </button>
          <button
            onClick={() => {
              setShowRejectForm(false);
              setRejectionReason("");
            }}
            className="flex-1 px-4 py-2 bg-theme-bg-secondary text-theme-heading rounded-lg font-medium hover:bg-theme-bg-tertiary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Info Box */}
      {extensionRequest.clientApprovedAt &&
        extensionRequest.freelancerApprovedAt && (
          <div className="mt-4 p-3 bg-theme-success/10 border border-theme-success/20 rounded-lg">
            <p className="text-xs text-theme-success font-medium">
              ✓ Both parties have approved. The deadline will be extended
              on-chain once the transaction is signed.
            </p>
          </div>
        )}
    </div>
  );
}
