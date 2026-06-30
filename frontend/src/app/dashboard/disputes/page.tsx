"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { ShieldCheck, Gavel, Vote } from "lucide-react";
import Link from "next/link";
import axios from "axios";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import DisputeCardSkeleton from "@/components/skeletons/DisputeCardSkeleton";
import { Dispute, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const ITEMS_PER_PAGE = 10;

type TabType = "my-disputes" | "my-votes" | "open-for-voting";

export default function DisputesDashboardPage() {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("my-disputes");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!token || !user) return;
    fetchDisputes();
  }, [activeTab, page, token, user]);

  const fetchDisputes = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        limit: ITEMS_PER_PAGE,
      };

      if (activeTab === "my-disputes") {
        params.userId = user!.id;
      } else if (activeTab === "my-votes") {
        params.voterId = user!.id;
      } else if (activeTab === "open-for-voting") {
        params.eligibleVoter = user!.id;
        params.status = "OPEN";
      }

      const res = await axios.get<PaginatedResponse<Dispute>>(
        `${API_URL}/disputes`,
        {
          params,
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setDisputes(res.data.data);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
    } catch (error) {
      console.error("Failed to fetch disputes:", error);
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "my-disputes" as TabType, label: "My Disputes", icon: ShieldCheck },
    { id: "my-votes" as TabType, label: "My Votes", icon: Vote },
    { id: "open-for-voting" as TabType, label: "Open for Voting", icon: Gavel },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-theme-heading mb-2">
          Disputes Dashboard
        </h1>
        <p className="text-theme-text">
          Manage your disputes, view voting history, and participate in
          community resolution.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-theme-border mb-6">
        <div className="flex gap-4 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setPage(1);
              }}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-stellar-blue text-stellar-blue font-medium"
                  : "border-transparent text-theme-text hover:text-theme-heading"
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <DisputeCardSkeleton key={i} />
          ))}
        </div>
      ) : disputes.length > 0 ? (
        <>
          <div className="space-y-4">
            {disputes.map((dispute) => (
              <Link
                key={dispute.id}
                href={`/disputes/${dispute.id}`}
                className="block bg-theme-card border border-theme-border rounded-xl p-6 hover:border-stellar-blue transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-theme-heading truncate">
                        Dispute #{dispute.id.slice(0, 8)}
                      </h3>
                      <StatusBadge status={dispute.status} />
                    </div>
                    <p className="text-sm text-theme-text mb-3 line-clamp-2">
                      {dispute.reason}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-theme-text">
                      <span>Job: {dispute.job?.title || "N/A"}</span>
                      <span>
                        Votes: {dispute.votes?.length || 0} /{" "}
                        {dispute.minVotes || 3}
                      </span>
                      {dispute.createdAt && (
                        <span>
                          Created:{" "}
                          {new Date(dispute.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {activeTab === "open-for-voting" && (
                    <button className="btn-primary px-4 py-2 text-sm shrink-0">
                      Vote Now
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-8">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={ITEMS_PER_PAGE}
                onPageChange={setPage}
              />
            </div>
          )}

          <p className="text-center text-sm text-theme-text mt-4">
            Showing {disputes.length} of {total} dispute{total !== 1 ? "s" : ""}
          </p>
        </>
      ) : (
        <EmptyState
          icon={
            activeTab === "my-disputes"
              ? ShieldCheck
              : activeTab === "my-votes"
                ? Vote
                : Gavel
          }
          title={
            activeTab === "my-disputes"
              ? "No disputes found"
              : activeTab === "my-votes"
                ? "No voting history"
                : "No disputes available for voting"
          }
          description={
            activeTab === "my-disputes"
              ? "You haven't initiated or been involved in any disputes."
              : activeTab === "my-votes"
                ? "You haven't voted on any disputes yet."
                : "There are no open disputes that you're eligible to vote on."
          }
        />
      )}
    </div>
  );
}
