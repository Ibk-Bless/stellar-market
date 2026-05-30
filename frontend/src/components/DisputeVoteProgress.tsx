"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Users } from "lucide-react";
import { useDisputeStatus } from "@/hooks/useDisputeStatus";

interface DisputeVoteProgressProps {
  disputeId: string;
  showVoterDetails?: boolean;
  initialDispute?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Real-time dispute vote progress tracker component
 * 
 * Features:
 * - Live polling via useDisputeStatus hook
 * - Visual split progress bar showing votes for client vs freelancer
 * - Vote count display (X of Y votes cast)
 * - Anonymized voter addresses for privacy
 * - Responsive design with Tailwind CSS
 */
export default function DisputeVoteProgress({ 
  disputeId, 
  showVoterDetails = false,
  initialDispute,
}: DisputeVoteProgressProps) {
  const { dispute: liveDispute, isLoading: liveLoading } = useDisputeStatus({
    disputeId,
    enabled: !initialDispute,
    initialInterval: 2000,
    maxInterval: 30000
  });
  const dispute = initialDispute ?? liveDispute;
  const isLoading = initialDispute ? false : liveLoading;

  const [prevVoteCount, setPrevVoteCount] = useState(0);
  const [isNewVote, setIsNewVote] = useState(false);

  useEffect(() => {
    if (dispute) {
      const currentVoteCount = dispute.votesForClient + dispute.votesForFreelancer;
      if (currentVoteCount > prevVoteCount && prevVoteCount > 0) {
        setIsNewVote(true);
        setTimeout(() => setIsNewVote(false), 2000);
      }
      setPrevVoteCount(currentVoteCount);
    }
  }, [dispute, prevVoteCount]);

  if (isLoading || !dispute) {
    return (
      <div className="card animate-pulse">
        <div className="h-6 bg-theme-bg-secondary rounded w-1/3 mb-4"></div>
        <div className="h-4 bg-theme-bg-secondary rounded w-full mb-2"></div>
        <div className="h-8 bg-theme-bg-secondary rounded w-full"></div>
      </div>
    );
  }

  const totalVotes = dispute.votesForClient + dispute.votesForFreelancer;
  const clientPercentage = totalVotes > 0 ? (dispute.votesForClient / totalVotes) * 100 : 50;
  const freelancerPercentage = totalVotes > 0 ? (dispute.votesForFreelancer / totalVotes) * 100 : 50;
  const progressPercentage = Math.min(100, (totalVotes / dispute.minVotes) * 100);
  const votesRemaining = Math.max(0, dispute.minVotes - totalVotes);

  const anonymizeAddress = (address: string): string => {
    if (!address || address.length < 8) return "Anonymous";
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className={`card transition-all duration-300 ${isNewVote ? 'ring-2 ring-stellar-blue shadow-lg' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-theme-heading flex items-center gap-2">
          <ShieldCheck className="text-stellar-blue" size={20} />
          Vote Progress
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <Users size={16} className="text-theme-text" />
          <span className="font-medium text-theme-heading">{totalVotes}</span>
          <span className="text-theme-text">/ {dispute.minVotes}</span>
        </div>
      </div>

      {/* Split Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="font-medium text-indigo-400">
            Client ({dispute.votesForClient})
          </span>
          <span className="font-medium text-orange-400">
            Freelancer ({dispute.votesForFreelancer})
          </span>
        </div>
        <div className="w-full flex h-6 rounded-lg overflow-hidden bg-theme-bg-secondary border border-theme-border/50 shadow-inner">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-500 ease-out flex items-center justify-center text-white text-xs font-semibold" 
            style={{ width: `${clientPercentage}%` }}
          >
            {dispute.votesForClient > 0 && clientPercentage > 15 && `${Math.round(clientPercentage)}%`}
          </div>
          <div 
            className="h-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500 ease-out flex items-center justify-center text-white text-xs font-semibold" 
            style={{ width: `${freelancerPercentage}%` }}
          >
            {dispute.votesForFreelancer > 0 && freelancerPercentage > 15 && `${Math.round(freelancerPercentage)}%`}
          </div>
        </div>
      </div>

      {/* Overall Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-theme-text">Minimum votes required</span>
          <span className={`font-medium ${progressPercentage >= 100 ? 'text-theme-success' : 'text-theme-heading'}`}>
            {progressPercentage.toFixed(0)}%
          </span>
        </div>
        <div className="w-full h-2 bg-theme-bg-secondary rounded-full overflow-hidden border border-theme-border/50">
          <div 
            className={`h-full transition-all duration-500 ease-out ${
              progressPercentage >= 100 
                ? 'bg-gradient-to-r from-theme-success to-green-500' 
                : 'bg-gradient-to-r from-stellar-blue to-stellar-purple'
            }`}
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Status Message */}
      <div className="text-center">
        {totalVotes >= dispute.minVotes ? (
          <p className="text-sm text-theme-success font-medium flex items-center justify-center gap-2">
            <ShieldCheck size={16} />
            Ready to resolve
          </p>
        ) : (
          <p className="text-sm text-theme-text">
            {votesRemaining} more {votesRemaining === 1 ? 'vote' : 'votes'} needed
          </p>
        )}
      </div>

      {/* Voter Details (Optional) */}
      {showVoterDetails && dispute.votes && dispute.votes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-theme-border">
          <p className="text-xs text-theme-text mb-2 font-medium">Recent Voters (Anonymized)</p>
          <div className="flex flex-wrap gap-2">
            {dispute.votes.slice(-5).map((vote) => (
              <span 
                key={vote.id}
                className={`text-xs px-2 py-1 rounded-full border ${
                  vote.choice === 'CLIENT' 
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' 
                    : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                }`}
              >
                {anonymizeAddress(vote.voter.walletAddress)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
