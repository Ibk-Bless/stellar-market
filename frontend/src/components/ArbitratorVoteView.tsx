"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Loader2, Scale, Shield, TrendingUp } from "lucide-react";
import axios from "axios";
import type { Dispute } from "@/types";

interface ArbitratorVoteViewProps {
  dispute: Dispute;
  walletAddress?: string;
  onVoteSubmit: (
    choice: "CLIENT" | "FREELANCER",
    splitPercent?: number,
  ) => Promise<void>;
}

type VoteChoice = "CLIENT" | "FREELANCER" | "SPLIT";

interface DisputeTally {
  disputeId: string;
  totalVotes: number;
  votesForClient: number;
  votesForFreelancer: number;
  clientPercentage: number;
  freelancerPercentage: number;
  status: string;
  votes?: Array<{
    voterId: string;
    voterName: string;
    choice: string;
    timestamp: string;
  }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export default function ArbitratorVoteView({
  dispute,
  walletAddress,
  onVoteSubmit,
}: ArbitratorVoteViewProps) {
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const [clientPct, setClientPct] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tally, setTally] = useState<DisputeTally | null>(null);
  const [loadingTally, setLoadingTally] = useState(false);

  const isArbitrator =
    !!walletAddress &&
    (dispute.arbitrators ?? []).some((a) => a.address === walletAddress);

  const freelancerPct = 100 - clientPct;

  // Fetch tally on mount and every 30 seconds
  useEffect(() => {
    if (!isArbitrator) return;

    const fetchTally = async () => {
      setLoadingTally(true);
      try {
        const token = localStorage.getItem("token");
        const response = await axios.get<DisputeTally>(
          `${API_URL}/disputes/${dispute.id}/tally`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setTally(response.data);
      } catch (err) {
        console.error("Failed to fetch tally:", err);
      } finally {
        setLoadingTally(false);
      }
    };

    fetchTally();
    const interval = setInterval(fetchTally, 30000);
    return () => clearInterval(interval);
  }, [dispute.id, isArbitrator]);

  const handleClientSlider = (val: number) => {
    setClientPct(val);
  };

  const handleFreelancerSlider = (val: number) => {
    setClientPct(100 - val);
  };

  const handleSubmit = async () => {
    if (!choice) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (choice === "SPLIT") {
        await onVoteSubmit("CLIENT", clientPct);
      } else {
        await onVoteSubmit(choice);
      }
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Failed to submit vote. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Read-only panel for non-arbitrators
  if (!isArbitrator) {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-stellar-blue" />
          <h3 className="font-semibold text-theme-heading">Dispute Details</h3>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-theme-border text-theme-text-muted border border-theme-border">
            View Only
          </span>
        </div>

        <div>
          <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">
            Dispute Reason
          </p>
          <p className="text-sm text-theme-text">{dispute.reason}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-theme-card border border-theme-border rounded-lg p-3 text-center">
            <p className="text-xs text-theme-text-muted mb-1">
              Votes for Client
            </p>
            <p className="text-2xl font-bold text-theme-heading">
              {dispute.votesForClient}
            </p>
          </div>
          <div className="bg-theme-card border border-theme-border rounded-lg p-3 text-center">
            <p className="text-xs text-theme-text-muted mb-1">
              Votes for Freelancer
            </p>
            <p className="text-2xl font-bold text-theme-heading">
              {dispute.votesForFreelancer}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isResolved =
    dispute.status === "RESOLVED_CLIENT" ||
    dispute.status === "RESOLVED_FREELANCER";

  // Full arbitrator panel
  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2">
        <Scale size={18} className="text-stellar-blue" />
        <h3 className="font-semibold text-theme-heading">Arbitrator Panel</h3>
      </div>

      {/* Current Tally */}
      {tally && (
        <div className="bg-stellar-blue/5 border border-stellar-blue/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-stellar-blue" />
              <h4 className="text-sm font-semibold text-theme-heading">
                Current Tally
              </h4>
            </div>
            {loadingTally && (
              <Loader2 size={14} className="animate-spin text-theme-text" />
            )}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-theme-text">
              {tally.totalVotes} of {dispute.arbitrators?.length || 0} votes
              cast
            </span>
            <div className="flex gap-3 text-xs font-medium">
              <span className="text-theme-text">
                Client:{" "}
                <span className="text-theme-heading">
                  {tally.clientPercentage.toFixed(0)}%
                </span>
              </span>
              <span className="text-theme-text-muted">/</span>
              <span className="text-theme-text">
                Freelancer:{" "}
                <span className="text-theme-heading">
                  {tally.freelancerPercentage.toFixed(0)}%
                </span>
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full bg-theme-bg-secondary rounded-full overflow-hidden">
            <div className="flex h-full">
              <div
                className="bg-stellar-blue"
                style={{ width: `${tally.clientPercentage}%` }}
              />
              <div
                className="bg-stellar-purple"
                style={{ width: `${tally.freelancerPercentage}%` }}
              />
            </div>
          </div>

          {/* Individual vote breakdown (only after resolution) */}
          {isResolved && tally.votes && tally.votes.length > 0 && (
            <div className="mt-4 pt-3 border-t border-theme-border space-y-2">
              <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                Vote Breakdown
              </p>
              <ul className="space-y-1.5">
                {tally.votes.map((vote, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-theme-text">{vote.voterName}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        vote.choice === "CLIENT"
                          ? "bg-stellar-blue/10 text-stellar-blue"
                          : "bg-stellar-purple/10 text-stellar-purple"
                      }`}
                    >
                      {vote.choice}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!isResolved && (
            <p className="text-[10px] text-theme-text-muted italic">
              Individual votes will be shown after the dispute is resolved to
              prevent herd behaviour.
            </p>
          )}
        </div>
      )}

      {/* Evidence viewer */}
      {dispute.evidence && dispute.evidence.length > 0 && (
        <div>
          <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
            Submitted Evidence
          </p>
          <ul className="space-y-2">
            {dispute.evidence.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between bg-theme-card border border-theme-border rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-theme-heading truncate max-w-[200px]">
                    {item.fileName}
                  </p>
                  <p className="text-[10px] text-theme-text-muted">
                    {item.fileType}
                  </p>
                  {item.sha256 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Shield
                        size={9}
                        className="text-theme-success flex-shrink-0"
                      />
                      <span className="font-mono text-[9px] text-theme-success">
                        {item.sha256.slice(0, 12)}…
                      </span>
                    </div>
                  )}
                </div>
                <a
                  href={
                    item.url
                      ? `${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1").replace("/api", "")}${item.url}`
                      : item.ipfsHash
                        ? `https://ipfs.io/ipfs/${item.ipfsHash}`
                        : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-stellar-blue hover:underline flex-shrink-0 ml-3"
                >
                  View <ExternalLink size={11} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dispute reason */}
      <div>
        <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">
          Dispute Reason
        </p>
        <p className="text-sm text-theme-text">{dispute.reason}</p>
      </div>

      {/* Vote options */}
      <div>
        <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
          Your Vote
        </p>
        <div className="space-y-2">
          {(
            [
              { value: "CLIENT", label: "Client Wins" },
              { value: "FREELANCER", label: "Freelancer Wins" },
              { value: "SPLIT", label: "Split Award" },
            ] as { value: VoteChoice; label: string }[]
          ).map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                choice === opt.value
                  ? "border-stellar-blue bg-stellar-blue/10 text-theme-heading"
                  : "border-theme-border bg-theme-card text-theme-text hover:border-stellar-blue/50"
              }`}
            >
              <input
                type="radio"
                name="vote-choice"
                value={opt.value}
                checked={choice === opt.value}
                onChange={() => setChoice(opt.value)}
                disabled={submitting}
                className="accent-stellar-blue"
              />
              <span className="text-sm font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Split sliders — shown only when SPLIT is selected */}
      {choice === "SPLIT" && (
        <div className="space-y-3 p-3 bg-theme-card border border-theme-border rounded-lg">
          <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider">
            Split Percentages
          </p>

          <div>
            <div className="flex justify-between text-xs text-theme-text mb-1">
              <span>Client</span>
              <span className="font-semibold text-theme-heading">
                {clientPct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={clientPct}
              onChange={(e) => handleClientSlider(Number(e.target.value))}
              disabled={submitting}
              className="w-full accent-stellar-blue"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-theme-text mb-1">
              <span>Freelancer</span>
              <span className="font-semibold text-theme-heading">
                {freelancerPct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={freelancerPct}
              onChange={(e) => handleFreelancerSlider(Number(e.target.value))}
              disabled={submitting}
              className="w-full accent-stellar-blue"
            />
          </div>

          <p className="text-[10px] text-theme-text-muted">
            Percentages always sum to 100. Adjusting one slider updates the
            other.
          </p>
        </div>
      )}

      {submitError && <p className="text-xs text-theme-error">{submitError}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!choice || submitting}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Submitting Vote…
          </>
        ) : (
          "Submit Vote"
        )}
      </button>
    </div>
  );
}
