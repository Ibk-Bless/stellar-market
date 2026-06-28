"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  ExternalLink,
  Download,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import axios from "axios";
import type { DisputeEvidence, EvidenceVerification } from "@/types";
import LocalTimestamp from "@/components/LocalTimestamp";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type EvidenceViewerProps = {
  disputeId: string;
  evidence?: DisputeEvidence[];
};

type VerificationState = {
  loading: boolean;
  result?: EvidenceVerification;
  error?: string;
};

export default function EvidenceViewer({
  disputeId,
  evidence: initialEvidence,
}: EvidenceViewerProps) {
  const [evidence, setEvidence] = useState<DisputeEvidence[]>(
    initialEvidence || [],
  );
  const [loading, setLoading] = useState(!initialEvidence);
  const [verifications, setVerifications] = useState<
    Record<string, VerificationState>
  >({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]');
    if (!buttons || buttons.length === 0) return;

    const activeEl = document.activeElement;
    let currentIndex = Array.from(buttons).indexOf(activeEl as HTMLButtonElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % buttons.length;
      buttons[nextIndex].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      buttons[prevIndex].focus();
    }
  };

  const fetchEvidence = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const res = await axios.get(
        `${API_URL}/disputes/${disputeId}/evidence`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setEvidence(res.data.evidence);
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => {
    if (!initialEvidence) {
      fetchEvidence();
    }
  }, [initialEvidence, fetchEvidence]);

  const verifyItem = useCallback(
    async (evidenceId: string) => {
      setVerifications((prev) => ({
        ...prev,
        [evidenceId]: { loading: true },
      }));

      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(
          `${API_URL}/disputes/${disputeId}/evidence/${evidenceId}/verify`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setVerifications((prev) => ({
          ...prev,
          [evidenceId]: { loading: false, result: res.data },
        }));
      } catch {
        setVerifications((prev) => ({
          ...prev,
          [evidenceId]: {
            loading: false,
            error: "Verification failed",
          },
        }));
      }
    },
    [disputeId],
  );

  const downloadItem = useCallback(async (item: DisputeEvidence) => {
    setDownloadingId(item.id);
    try {
      const token = localStorage.getItem("token");
      const response = await axios.get(
        `${API_URL}/disputes/${disputeId}/evidence/${item.id}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }, [disputeId]);

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center gap-2 py-6 text-theme-text">
          <Loader2 size={16} className="animate-spin" />
          Loading evidence…
        </div>
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={18} className="text-stellar-blue" />
          <h3 className="font-semibold text-theme-heading">Evidence</h3>
        </div>
        <p className="text-sm text-theme-text-muted text-center py-4">
          No evidence has been submitted yet.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={18} className="text-stellar-blue" />
        <h3 className="font-semibold text-theme-heading">
          Submitted Evidence
        </h3>
        <span className="ml-auto text-xs text-theme-text-muted">
          {evidence.length} file{evidence.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        className="space-y-3"
        role="listbox"
        aria-label="Submitted evidence documents"
      >
        {evidence.map((item, index) => {
          const v = verifications[item.id];
          const isSelected = selectedId === item.id;
          return (
            <li
              key={item.id}
              className={`bg-theme-card border rounded-lg p-3 space-y-2 transition-all ${
                isSelected
                  ? "border-stellar-blue ring-2 ring-stellar-blue/20"
                  : "border-theme-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="min-w-0 text-left font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-blue rounded p-1"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={selectedId === item.id || (selectedId === null && index === 0) ? 0 : -1}
                >
                  <p className="text-sm font-medium text-theme-heading truncate max-w-[220px]">
                    {item.fileName}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-theme-text-muted">
                    <span className="rounded-full bg-stellar-blue/10 px-1.5 py-0.5 font-medium text-stellar-blue">
                      {item.fileType}
                    </span>
                    {item.sizeFormatted && <span>{item.sizeFormatted}</span>}
                  </div>
                </button>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <button
                    type="button"
                    onClick={() => downloadItem(item)}
                    disabled={downloadingId === item.id}
                    className="flex items-center gap-1 text-xs text-stellar-blue hover:underline disabled:opacity-50"
                    aria-label={`Download ${item.fileName}`}
                  >
                    {downloadingId === item.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    Download
                  </button>
                </div>
              </div>
 
              {item.sha256 && (
                <div className="bg-theme-bg border border-theme-border rounded-md p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Shield size={12} className="text-stellar-blue flex-shrink-0" />
                    <span className="text-[10px] text-theme-text-muted">
                      SHA-256
                    </span>
                    <span className="font-mono text-[10px] text-theme-heading truncate">
                      {item.sha256}
                    </span>
                  </div>
 
                  {item.anchorTxHash && (
                    <div className="flex items-center gap-2">
                      <ExternalLink
                        size={12}
                        className="text-stellar-blue flex-shrink-0"
                      />
                      <span className="text-[10px] text-theme-text-muted">
                        Stellar Tx
                      </span>
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${item.anchorTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-stellar-blue hover:underline truncate"
                      >
                        {item.anchorTxHash.slice(0, 12)}…
                      </a>
                    </div>
                  )}
 
                  {v?.result && (
                    <div
                      className={`flex items-center gap-2 text-[10px] ${
                        v.result.intact
                          ? "text-theme-success"
                          : "text-theme-error"
                      }`}
                    >
                      {v.result.intact ? (
                        <>
                          <ShieldCheck size={12} />
                          Integrity verified — file matches stored hash
                        </>
                      ) : (
                        <>
                          <ShieldAlert size={12} />
                          Hash mismatch — file may have been modified
                        </>
                      )}
                    </div>
                  )}
 
                  {v?.error && (
                    <p className="text-[10px] text-theme-error">
                      {v.error}
                    </p>
                  )}
 
                  <button
                    type="button"
                    onClick={() => verifyItem(item.id)}
                    disabled={v?.loading}
                    className="flex items-center gap-1 text-[10px] text-stellar-blue hover:underline disabled:opacity-50"
                    aria-label={`Verify integrity of ${item.fileName}`}
                  >
                    {v?.loading ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      <>
                        <RefreshCw size={10} />
                        {v?.result ? "Re-verify" : "Verify integrity"}
                      </>
                    )}
                  </button>
                </div>
              )}
 
              <p className="text-[10px] text-theme-text-muted">
                Uploaded{" "}
                <LocalTimestamp isoString={item.uploadedAt} />
                {item.uploader && ` by ${item.uploader.username}`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
