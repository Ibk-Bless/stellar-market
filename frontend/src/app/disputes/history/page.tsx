"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldAlert,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { Dispute } from "@/types";
import EmptyState from "@/components/EmptyState";
import DisputeHistoryCardSkeleton from "@/components/skeletons/DisputeHistoryCardSkeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

interface DisputeHistoryItem extends Dispute {
  jobTitle: string;
  otherPartyName: string;
  otherPartyAvatar: string;
  resolvedAt?: string;
  outcome?: string;
}

export default function DisputeHistoryPage() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<DisputeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "initiated" | "involved">("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest">("recent");

  useEffect(() => {
    const fetchDisputeHistory = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`${API_URL}/disputes/history`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          params: { filter, sortBy },
        });
        setDisputes(res.data);
      } catch (err: unknown) {
        console.error("Failed to fetch dispute history:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDisputeHistory();
  }, [filter, sortBy]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "OPEN":
        return "bg-theme-warning/10 text-theme-warning";
      case "IN_PROGRESS":
        return "bg-stellar-blue/10 text-stellar-blue";
      case "RESOLVED":
        return "bg-theme-success/10 text-theme-success";
      default:
        return "bg-theme-text/10 text-theme-text";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "OPEN":
        return <AlertCircle size={16} />;
      case "IN_PROGRESS":
        return <Clock size={16} />;
      case "RESOLVED":
        return <CheckCircle size={16} />;
      default:
        return <ShieldAlert size={16} />;
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 animate-pulse">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-stellar-blue mb-4">
            <div className="h-5 w-5 rounded bg-theme-border" />
            <div className="h-4 w-28 rounded bg-theme-border" />
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="h-9 w-64 rounded bg-theme-border mb-2" />
              <div className="h-4 w-96 rounded bg-theme-border" />
            </div>
          </div>
        </div>
        <div className="card p-4 mb-6">
          <div className="flex gap-2">
            <div className="h-9 w-28 rounded-lg bg-theme-border" />
            <div className="h-9 w-28 rounded-lg bg-theme-border" />
            <div className="h-9 w-28 rounded-lg bg-theme-border" />
          </div>
        </div>
        <div className="grid gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <DisputeHistoryCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const filteredDisputes = disputes.filter((d) => {
    if (filter === "initiated") return d.initiatorId === user?.id;
    if (filter === "involved") return d.initiatorId !== user?.id;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-stellar-blue hover:text-stellar-blue/80 mb-4"
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </Link>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-theme-heading mb-2 flex items-center gap-2">
              <ShieldAlert className="text-stellar-blue" size={32} />
              Dispute History
            </h1>
            <p className="text-theme-text max-w-2xl">
              View all disputes you've initiated or been involved in. Track
              resolution status and outcomes.
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Sort */}
      <div className="card p-4 mb-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === "all"
                ? "bg-stellar-blue text-white"
                : "bg-theme-bg-secondary text-theme-text hover:bg-theme-bg-tertiary"
            }`}
          >
            All Disputes
          </button>
          <button
            onClick={() => setFilter("initiated")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === "initiated"
                ? "bg-stellar-blue text-white"
                : "bg-theme-bg-secondary text-theme-text hover:bg-theme-bg-tertiary"
            }`}
          >
            I Initiated
          </button>
          <button
            onClick={() => setFilter("involved")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === "involved"
                ? "bg-stellar-blue text-white"
                : "bg-theme-bg-secondary text-theme-text hover:bg-theme-bg-tertiary"
            }`}
          >
            I'm Involved
          </button>
        </div>

        <div className="flex gap-2">
          <label className="text-sm text-theme-text">Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "recent" | "oldest")}
            className="px-3 py-1 rounded-lg bg-theme-bg-secondary text-theme-text border border-theme-border text-sm"
          >
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Disputes List */}
      {filteredDisputes.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ShieldAlert}
            title="No disputes found"
            description={
              filter === "all"
                ? "You haven't been involved in any disputes yet. That's great!"
                : filter === "initiated"
                  ? "You haven't initiated any disputes."
                  : "You haven't been involved in any disputes as a participant."
            }
            action={{ label: "Back to Dashboard", href: "/dashboard" }}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredDisputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/disputes/${dispute.id}`}
              className="block"
            >
              <div className="card p-6 hover:border-stellar-blue/50 transition-colors group">
                <div className="flex flex-col md:flex-row gap-4 justify-between md:items-start">
                  {/* Left Section */}
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-theme-heading group-hover:text-stellar-blue transition-colors">
                          {dispute.jobTitle}
                        </h3>
                        <p className="text-sm text-theme-text-secondary mt-1">
                          Dispute ID: {dispute.id.slice(0, 8)}...
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1 whitespace-nowrap ${getStatusColor(
                          dispute.status,
                        )}`}
                      >
                        {getStatusIcon(dispute.status)}
                        {dispute.status.replace("_", " ")}
                      </span>
                    </div>

                    {/* Dispute Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                      <div>
                        <p className="text-theme-text-secondary text-xs uppercase tracking-wide">
                          Initiated By
                        </p>
                        <p className="text-theme-heading font-medium mt-1">
                          {dispute.initiatorId === user?.id
                            ? "You"
                            : dispute.otherPartyName}
                        </p>
                      </div>
                      <div>
                        <p className="text-theme-text-secondary text-xs uppercase tracking-wide">
                          Other Party
                        </p>
                        <p className="text-theme-heading font-medium mt-1">
                          {dispute.otherPartyName}
                        </p>
                      </div>
                      <div>
                        <p className="text-theme-text-secondary text-xs uppercase tracking-wide">
                          Created
                        </p>
                        <p className="text-theme-heading font-medium mt-1">
                          {formatDate(dispute.createdAt)}
                        </p>
                      </div>
                      {dispute.resolvedAt && (
                        <div>
                          <p className="text-theme-text-secondary text-xs uppercase tracking-wide">
                            Resolved
                          </p>
                          <p className="text-theme-heading font-medium mt-1">
                            {formatDate(dispute.resolvedAt)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Reason Preview */}
                    <div className="mt-4 p-3 bg-theme-bg-secondary rounded-lg">
                      <p className="text-xs text-theme-text-secondary uppercase tracking-wide mb-1">
                        Reason
                      </p>
                      <p className="text-sm text-theme-text line-clamp-2">
                        {dispute.reason}
                      </p>
                    </div>
                  </div>

                  {/* Right Section - Outcome */}
                  {(dispute.status === "RESOLVED_CLIENT" || dispute.status === "RESOLVED_FREELANCER") && dispute.outcome && (
                    <div className="md:w-48 p-4 bg-theme-success/10 rounded-lg border border-theme-success/20">
                      <p className="text-xs text-theme-success uppercase tracking-wide font-semibold mb-2">
                        Resolution
                      </p>
                      <p className="text-sm text-theme-heading font-medium">
                        {dispute.outcome}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Stats Footer */}
      {filteredDisputes.length > 0 && (
        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-stellar-blue">
              {filteredDisputes.filter((d) => d.status === "OPEN").length}
            </p>
            <p className="text-sm text-theme-text-secondary mt-1">
              Open Disputes
            </p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-theme-warning">
              {
                filteredDisputes.filter((d) => d.status === "VOTING")
                  .length
              }
            </p>
            <p className="text-sm text-theme-text-secondary mt-1">
              In Progress
            </p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-theme-success">
              {filteredDisputes.filter((d) => d.status === "RESOLVED_CLIENT" || d.status === "RESOLVED_FREELANCER").length}
            </p>
            <p className="text-sm text-theme-text-secondary mt-1">Resolved</p>
          </div>
        </div>
      )}
    </div>
  );
}
