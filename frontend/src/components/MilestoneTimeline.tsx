"use client";

import {
  CheckCircle,
  Loader2,
  PencilLine,
  ShieldCheck,
  DollarSign,
  Clock,
  AlertTriangle,
  WifiOff,
} from "lucide-react";

import StatusBadge from "@/components/StatusBadge";
import type { Milestone } from "@/types";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";

type MilestoneTimelineProps = {
  milestones: Milestone[];
  isClient: boolean;
  isFreelancerOnJob: boolean;
  onSubmitMilestone: (milestoneId: string) => void;
  onApproveMilestone: (milestoneId: string) => void;
  onRequestRevision: (milestoneId: string) => void;
  actioningMilestoneId: string | null;
  recentlyApprovedMilestoneId: string | null;
  confirmingMilestoneId?: string | null;
};

function getIndicatorClasses(
  status: Milestone["status"],
  approvedPulse: boolean,
  isOverdue: boolean,
) {
  if (isOverdue && (status === "IN_PROGRESS" || status === "SUBMITTED")) {
    return "bg-theme-error border-theme-error animate-pulse";
  }
  if (status === "APPROVED") {
    return approvedPulse
      ? "bg-theme-success border-theme-success shadow-[0_0_0_4px_rgba(34,197,94,0.18)]"
      : "bg-theme-success border-theme-success";
  }
  if (status === "PARTIALLY_PAID") {
    return "bg-theme-warning border-theme-warning";
  }
  if (status === "SUBMITTED") {
    return "bg-theme-warning border-theme-warning";
  }
  if (status === "IN_PROGRESS") {
    return "bg-theme-info border-theme-info";
  }
  if (status === "REJECTED") {
    return "bg-theme-error border-theme-error";
  }
  return "bg-theme-text border-theme-text";
}

function isOverdue(deadline: string | Date | null | undefined): boolean {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

function formatDeadline(deadline: string | Date | null | undefined): string {
  if (!deadline) return "No deadline";
  const date = new Date(deadline);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? "s" : ""}`;
  } else if (diffDays === 0) {
    return "Due today";
  } else if (diffDays === 1) {
    return "Due tomorrow";
  } else if (diffDays <= 7) {
    return `Due in ${diffDays} days`;
  } else {
    return date.toLocaleDateString();
  }
}

export default function MilestoneTimeline({
  milestones,
  isClient,
  isFreelancerOnJob,
  onSubmitMilestone,
  onApproveMilestone,
  onRequestRevision,
  actioningMilestoneId,
  recentlyApprovedMilestoneId,
  confirmingMilestoneId,
}: MilestoneTimelineProps) {
  const { isOnline } = useOfflineStatus();
  const isOffline = !isOnline;
  const completedCount = milestones.filter(
    (m) => m.status === "APPROVED",
  ).length;
  const totalCount = milestones.length;
  const progressPct = totalCount
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  return (
    <div className="space-y-5">
      {/* Overall Progress Bar */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm text-theme-text">
            <span className="font-semibold text-theme-heading">
              {completedCount}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-theme-heading">
              {totalCount}
            </span>{" "}
            milestones approved
          </div>
          <div className="text-sm font-semibold text-stellar-blue">
            {progressPct}%
          </div>
        </div>
        <div className="w-full h-2 rounded-full bg-theme-border overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-stellar-blue to-stellar-purple transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Vertical Timeline */}
      <div className="relative">
        {/* Connector Line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-theme-border" />

        <div className="space-y-4">
          {milestones.map((milestone, index) => {
            const isActioning = actioningMilestoneId === milestone.id;
            const approvedPulse = recentlyApprovedMilestoneId === milestone.id;
            const milestoneOverdue = isOverdue(
              milestone.contractDeadline,
            );
            const indicatorClasses = getIndicatorClasses(
              milestone.status,
              approvedPulse,
              milestoneOverdue,
            );
            const deadlineText = formatDeadline(
              milestone.contractDeadline,
            );

            return (
              <div key={milestone.id} className="relative flex gap-4">
                {/* Status Indicator */}
                <div className="relative z-10 flex-shrink-0 w-8 h-8">
                  <div
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-semibold text-white transition-all duration-500 ${indicatorClasses}`}
                  >
                    {milestone.status === "APPROVED" ? (
                      <CheckCircle className="text-white" size={18} />
                    ) : milestone.status === "PARTIALLY_PAID" ? (
                      <DollarSign className="text-white" size={18} />
                    ) : milestoneOverdue ? (
                      <AlertTriangle className="text-white" size={16} />
                    ) : (
                      index + 1
                    )}
                  </div>
                </div>

                {/* Milestone Card */}
                <div
                  className={`flex-1 p-4 rounded-lg border transition-all duration-500 ${
                    milestoneOverdue && milestone.status !== "APPROVED"
                      ? "border-theme-error/50 bg-theme-error/5"
                      : milestone.status === "APPROVED"
                        ? "border-theme-success/30 bg-theme-success/5"
                        : "border-theme-border bg-theme-bg"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-theme-heading">
                        {milestone.title}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-theme-text">
                          {milestone.amount.toLocaleString()} XLM
                        </span>
                        {(milestone.contractDeadline) && (
                          <span
                            className={`text-xs flex items-center gap-1 ${
                              milestoneOverdue &&
                              milestone.status !== "APPROVED"
                                ? "text-theme-error font-semibold"
                                : "text-theme-text"
                            }`}
                          >
                            <Clock size={12} />
                            {deadlineText}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={milestone.status} />
                  </div>

                  {milestone.description && (
                    <p className="text-sm text-theme-text mt-2">
                      {milestone.description}
                    </p>
                  )}

                  {milestoneOverdue && milestone.status !== "APPROVED" && (
                    <div className="mt-3 p-2 rounded bg-theme-error/10 border border-theme-error/20">
                      <p className="text-xs text-theme-error flex items-center gap-2">
                        <AlertTriangle size={14} />
                        This milestone is overdue
                      </p>
                    </div>
                  )}

                  {confirmingMilestoneId === milestone.id && (
                    <p className="text-xs text-stellar-blue mt-2 flex items-center gap-2">
                      <Loader2 className="animate-spin" size={12} />
                      Confirming on-chain...
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {isFreelancerOnJob &&
                      milestone.status === "IN_PROGRESS" && (
                        <div className="relative group">
                          <button
                            type="button"
                            disabled={isActioning || isOffline}
                            onClick={() => onSubmitMilestone(milestone.id)}
                            className="btn-primary py-1.5 text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isActioning ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : isOffline ? (
                              <WifiOff size={14} />
                            ) : (
                              <CheckCircle size={14} />
                            )}
                            Submit Milestone
                          </button>
                          {isOffline && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                              Blockchain transactions require an internet connection
                            </div>
                          )}
                        </div>
                      )}

                    {isClient && milestone.status === "SUBMITTED" && (
                      <>
                        <div className="relative group">
                          <button
                            type="button"
                            disabled={isActioning || isOffline}
                            onClick={() => onApproveMilestone(milestone.id)}
                            className="btn-primary py-1.5 text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isActioning ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : isOffline ? (
                              <WifiOff size={14} />
                            ) : (
                              <ShieldCheck size={14} />
                            )}
                            Approve
                          </button>
                          {isOffline && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                              Blockchain transactions require an internet connection
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={isActioning}
                          onClick={() => onRequestRevision(milestone.id)}
                          className="btn-secondary py-1.5 text-xs flex items-center gap-2 disabled:opacity-50"
                        >
                          <PencilLine size={14} /> Request Revision
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
