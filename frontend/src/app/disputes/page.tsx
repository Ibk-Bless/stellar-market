"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import axios from "axios";
import EmptyState from "@/components/EmptyState";
import DisputeCardSkeleton from "@/components/skeletons/DisputeCardSkeleton";
import { useDelay } from "@/hooks/useDelay";
import { Dispute } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";


export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const ready = useDelay();

  useEffect(() => {
    const fetchDisputes = async () => {
      try {
        const res = await axios.get(`${API_URL}/disputes`);
        setDisputes(res.data);
      } catch (err: unknown) {
        console.error("Failed to fetch disputes:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDisputes();
  }, []);

  if (loading) {
    if (ready) {
      return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-theme-heading mb-2 flex items-center gap-2">
                Community Arbitration
              </h1>
              <p className="text-theme-text max-w-2xl">
                Review active disputes and cast your vote as an impartial community member.
              </p>
            </div>
          </div>
          <div className="grid gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <DisputeCardSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-theme-heading mb-2 flex items-center gap-2">
            <ShieldCheck className="text-stellar-blue" size={32} />
            Community Arbitration
          </h1>
          <p className="text-theme-text max-w-2xl">
            Review active disputes and cast your vote as an impartial community member. High-reputation users earn rewards for participating in dispute resolution.
          </p>
        </div>
      </div>

      {disputes.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ShieldCheck}
            title="You have no active disputes."
            description="The marketplace is peaceful right now. Check back later to participate in community arbitration and earn rewards."
            action={{ label: "Back to Dashboard", href: "/dashboard" }}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          {disputes.map((dispute) => {
            const totalVotes = dispute.votesForClient + dispute.votesForFreelancer;
            const progress = Math.min(100, Math.round((totalVotes / dispute.minVotes) * 100));

            return (
              <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="block">
                <div className="card p-6 hover:border-stellar-blue/50 transition-colors group">
                  <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          dispute.status === "OPEN" ? "bg-theme-error/10 text-theme-error" :
                          dispute.status === "VOTING" ? "bg-stellar-blue/10 text-stellar-blue" :
                          "bg-theme-success/10 text-theme-success"
                        }`}>
                          {dispute.status.replace("_", " ")}
                        </span>
                        <span className="text-xs text-theme-text">
                          {new Date(dispute.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="font-semibold text-theme-heading text-lg group-hover:text-stellar-blue transition-colors mb-1">
                        {dispute.job.title}
                      </h3>
                      <p className="text-sm text-theme-text line-clamp-1 mb-3">
                        {dispute.reason}
                      </p>
                      
                      <div className="flex items-center gap-4 text-xs text-theme-text">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-stellar-purple" />
                          {dispute.initiator.username} vs {dispute.respondent.username}
                        </div>
                        <div className="font-medium text-stellar-blue">
                          {dispute.job.budget.toLocaleString()} XLM in Escrow
                        </div>
                      </div>
                    </div>
                    
                    <div className="w-full md:w-64 shrink-0 mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-theme-border md:pl-6 flex flex-col justify-center">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-theme-heading font-medium">Voting Progress</span>
                        <span className="text-theme-text">{totalVotes} / {dispute.minVotes} votes</span>
                      </div>
                      <div className="w-full h-2 bg-theme-bg-secondary rounded-full overflow-hidden mb-3 border border-theme-border/50">
                        <div 
                          className="h-full bg-stellar-blue" 
                          style={{ width: `${progress}%` }} 
                        />
                      </div>
                      <div className="flex items-center justify-end text-sm text-stellar-blue font-medium group-hover:translate-x-1 transition-transform">
                        Review Case <ArrowRight size={16} className="ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
