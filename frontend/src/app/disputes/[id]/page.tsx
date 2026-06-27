"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, AlertCircle, Loader2, ShieldCheck, User as UserIcon } from "lucide-react";
import axios, { AxiosError } from "axios";
import { useWallet } from "@/context/WalletContext";
import { useAuth } from "@/context/AuthContext";
import { Dispute, Vote } from "@/types";
import DisputeVoteProgress from "@/components/DisputeVoteProgress";
import EvidenceViewer from "@/components/EvidenceViewer";
import EvidenceUpload from "@/components/EvidenceUpload";
import DisputeOutcomeBanner from "@/components/DisputeOutcomeBanner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export default function DisputeDetailPage() {
  const { id } = useParams();
  const { signAndBroadcastTransaction } = useWallet();
  const { user } = useAuth();
  
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [voteChoice, setVoteChoice] = useState<"CLIENT" | "FREELANCER" | null>(null);
  const [voteReason, setVoteReason] = useState("");

  const fetchDispute = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API_URL}/disputes/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setDispute(res.data);
    } catch {
      setError("Failed to fetch dispute details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  useEffect(() => {
    const isResolved =
      dispute?.status === "RESOLVED_CLIENT" ||
      dispute?.status === "RESOLVED_FREELANCER";
    if (!dispute || isResolved) return;

    const interval = setInterval(fetchDispute, 5000);
    return () => clearInterval(interval);
  }, [dispute?.status, fetchDispute]);

  const handleVote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voteChoice) return setError("Please select a side to vote for.");
    if (voteReason.length < 10) return setError("Please provide a reason for your vote.");

    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");

      // 1. Get XDR
      const res = await axios.post(
        `${API_URL}/disputes/init-vote`,
        { disputeId: id, choice: voteChoice, reason: voteReason },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // 2. Sign & Broadcast
      const txResult = await signAndBroadcastTransaction(res.data.xdr);

      if (!txResult.success) {
        throw new Error(txResult.error || "Transaction failed");
      }

      // 3. Confirm
      await axios.post(
        `${API_URL}/disputes/confirm-tx`,
        {
          hash: txResult.hash,
          type: "CAST_VOTE",
          disputeId: id,
          choice: voteChoice,
          reason: voteReason,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setVoteChoice(null);
      setVoteReason("");
      fetchDispute();
    } catch (err: unknown) {
      let errorMsg = "An error occurred";
      if (err instanceof AxiosError) {
        errorMsg = err.response?.data?.error || err.message;
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  const handleResolve = async () => {
    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");

      // 1. Get XDR
      const res = await axios.post(
        `${API_URL}/disputes/init-resolve`,
        { disputeId: id },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // 2. Sign & Broadcast
      const txResult = await signAndBroadcastTransaction(res.data.xdr);

      if (!txResult.success) {
        throw new Error(txResult.error || "Transaction failed");
      }

      // 3. Confirm
      await axios.post(
        `${API_URL}/disputes/confirm-tx`,
        {
          hash: txResult.hash,
          type: "RESOLVE_DISPUTE",
          disputeId: id,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      fetchDispute();
    } catch (err: unknown) {
      let errorMsg = "An error occurred";
      if (err instanceof AxiosError) {
        errorMsg = err.response?.data?.error || err.message;
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={48} />
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-theme-heading mb-4">Dispute Not Found</h1>
        <Link href="/disputes" className="text-stellar-blue hover:underline">Return to disputes</Link>
      </div>
    );
  }

  const isParticipant = user?.id === dispute.initiator.id || user?.id === dispute.respondent.id;
  const hasVoted = dispute.votes.some((v: Vote) => v.voter.walletAddress === user?.walletAddress);
  const totalVotes = dispute.votesForClient + dispute.votesForFreelancer;
  const canResolve = totalVotes >= dispute.minVotes && (dispute.status === "OPEN" || dispute.status === "VOTING");
  
  const clientWidth = totalVotes > 0 ? (dispute.votesForClient / totalVotes) * 100 : 50;
  const freelancerWidth = totalVotes > 0 ? (dispute.votesForFreelancer / totalVotes) * 100 : 50;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/disputes"
        className="flex items-center gap-2 text-theme-text hover:text-theme-heading mb-8 transition-colors"
      >
        <ArrowLeft size={18} /> Back to Disputes
      </Link>

      {error && (
        <div className="mb-6 p-4 bg-theme-error/10 border border-theme-error/20 rounded-lg flex items-start gap-3 text-theme-error">
          <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="mb-6">
        <DisputeOutcomeBanner status={dispute.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          dispute.status === "OPEN" ? "bg-theme-error/10 text-theme-error" :
                          dispute.status === "VOTING" ? "bg-stellar-blue/10 text-stellar-blue" :
                          "bg-theme-success/10 text-theme-success"
                        }`}>
                          {dispute.status.replace("_", " ")}
              </span>
              <span className="text-sm text-theme-text">
                Job: <Link href={`/jobs/${dispute.job.id}`} className="text-stellar-blue hover:underline">{dispute.job.title}</Link>
              </span>
            </div>

            <h1 className="text-2xl font-bold text-theme-heading mb-6">
              Dispute Evidence & Reason
            </h1>
            
            <div className="p-4 bg-theme-bg-secondary rounded-lg border border-theme-border mb-6">
              <div className="flex items-center gap-2 mb-2">
                <UserIcon size={16} className="text-theme-text" />
                <span className="font-medium text-theme-heading pr-2 border-r border-theme-border">Initiated by {dispute.initiator.username}</span>
                <span className="text-sm text-theme-text">{new Date(dispute.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-theme-text whitespace-pre-line text-sm leading-relaxed">
                {dispute.reason}
              </p>
            </div>
            
            <EvidenceViewer disputeId={dispute.id} />

            {isParticipant &&
              dispute.status !== "RESOLVED_CLIENT" &&
              dispute.status !== "RESOLVED_FREELANCER" && (
                <div className="card">
                  <EvidenceUpload
                    disputeId={dispute.id}
                    onUploadComplete={fetchDispute}
                  />
                </div>
              )}

            <h2 className="text-xl font-bold text-theme-heading mb-4 border-b border-theme-border pb-2">
              Community Votes
            </h2>
            
            {dispute.votes.length === 0 ? (
                <div className="text-center p-8 text-theme-text italic">No votes have been cast yet.</div>
            ) : (
                <div className="space-y-4">
                  {dispute.votes.map((vote: Vote) => (
                    <div key={vote.id} className="p-4 border border-theme-border rounded-lg bg-theme-bg">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium text-theme-heading flex items-center gap-2">
                                {vote.voter.username}
                                <span className={`text-xs px-2 py-0.5 rounded ${vote.choice === 'CLIENT' ? 'bg-stellar-blue/10 text-stellar-blue' : 'bg-theme-warning/10 text-theme-warning'}`}>
                                    Voted for {vote.choice.toLowerCase()}
                                </span>
                            </div>
                            <span className="text-xs text-theme-text">{new Date(vote.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-theme-text">{vote.reason}</p>
                    </div>
                  ))}
                </div>
            )}
            
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Real-time Vote Progress Component */}
          <DisputeVoteProgress disputeId={id as string} showVoterDetails={true} />
          
          <div className="card">
            <h3 className="font-semibold text-theme-heading mb-4 flex items-center gap-2">
              <ShieldCheck className="text-stellar-blue" size={18} />
              Assigned Arbitrators
            </h3>
            <div className="space-y-3">
              {dispute.arbitrators && dispute.arbitrators.length > 0 ? (
                dispute.arbitrators.map((arb) => (
                  <div key={arb.address} className="flex items-center gap-3 p-2 bg-theme-bg-secondary border border-theme-border rounded-lg">
                    {arb.avatarUrl ? (
                      <img src={arb.avatarUrl} alt={arb.displayName} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-stellar-blue/10 text-stellar-blue flex items-center justify-center font-bold text-sm">
                        {arb.displayName[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-heading truncate">{arb.displayName}</p>
                      <p className="text-[10px] text-theme-text-muted font-mono truncate">{arb.address}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-theme-text-muted italic text-center py-2">No arbitrators assigned.</p>
              )}
            </div>
          </div>
          
          <div className="card border-theme-border border-2">
            <h3 className="font-semibold text-theme-heading mb-4 flex items-center justify-center gap-2 text-lg">
              <ShieldCheck className="text-stellar-blue" />
              Cast Your Vote
            </h3>

            {canResolve && !isParticipant && (
                <button 
                  onClick={handleResolve}
                  disabled={processing}
                  className="btn-primary w-full flex justify-center py-3 mb-4 text-sm font-semibold shadow-[0_0_15px_rgba(42,92,246,0.3)] animate-pulse"
                >
                    {processing ? <Loader2 className="animate-spin" size={18} /> : "Finalize & Resolve Dispute"}
                </button>
            )}

            {isParticipant ? (
              <div className="p-4 bg-theme-error/10 border border-theme-error/20 rounded-lg text-theme-error text-sm text-center">
                You are a participant in this dispute and cannot vote.
              </div>
            ) : hasVoted ? (
              <div className="p-4 bg-theme-success/10 border border-theme-success/20 rounded-lg text-theme-success text-sm flex items-center justify-center gap-2 font-medium">
                <CheckCircle size={18} /> You have voted
              </div>
            ) : dispute.status === "RESOLVED_CLIENT" || dispute.status === "RESOLVED_FREELANCER" ? (
              <div className="p-4 bg-theme-bg-secondary rounded-lg text-theme-text text-sm text-center">
                This dispute has been resolved.
              </div>
            ) : (
                <form onSubmit={handleVote} className="space-y-4 border-t border-theme-border pt-4">
                  <h4 className="font-medium text-theme-heading text-sm text-center">Cast Your Vote</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => setVoteChoice("CLIENT")}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                            voteChoice === "CLIENT" 
                            ? "bg-stellar-blue/20 border-stellar-blue text-stellar-blue" 
                            : "bg-theme-bg border-theme-border text-theme-text hover:border-indigo-500/50"
                        }`}
                    >
                        For Client
                    </button>
                    <button
                        type="button"
                        onClick={() => setVoteChoice("FREELANCER")}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                            voteChoice === "FREELANCER" 
                            ? "bg-theme-warning/20 border-theme-warning text-theme-warning" 
                            : "bg-theme-bg border-theme-border text-theme-text hover:border-orange-500/50"
                        }`}
                    >
                        For Freelancer
                    </button>
                  </div>
                  
                  <textarea 
                    className="input-field min-h-[80px] text-sm resize-none"
                    placeholder="Provide reasoning for your decision..."
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    disabled={processing || !voteChoice}
                  />
                  
                  <button 
                    type="submit" 
                    className="btn-primary w-full"
                    disabled={processing || !voteChoice || voteReason.length < 10}
                  >
                    {processing ? <Loader2 className="animate-spin mx-auto" size={18} /> : "Submit Vote"}
                  </button>
                </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
