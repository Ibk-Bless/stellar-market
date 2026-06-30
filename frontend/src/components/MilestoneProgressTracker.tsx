"use client";

import { ArrowUpRight, AlertTriangle, CheckCircle2, Clock3, Circle } from "lucide-react";
import Link from "next/link";
import type { Milestone } from "@/types";
import { formatLocalTimestamp, formatUtcTimestamp } from "@/components/LocalTimestamp";

type TrackedMilestone = Milestone & {
  releaseTransactionHash?: string;
};

type MilestoneProgressTrackerProps = {
  milestones: TrackedMilestone[];
  jobTitle: string;
  explorerBaseUrl?: string;
};

const statusMeta: Record<
  Milestone["status"],
  { label: string; tone: string; icon: typeof Circle }
> = {
  PENDING: {
    label: "Pending",
    tone: "border-theme-border bg-theme-card text-theme-text",
    icon: Circle,
  },
  IN_PROGRESS: {
    label: "In progress",
    tone: "border-stellar-blue/30 bg-stellar-blue/10 text-stellar-blue",
    icon: Clock3,
  },
  SUBMITTED: {
    label: "Submitted",
    tone: "border-theme-warning/30 bg-theme-warning/10 text-theme-warning",
    icon: AlertTriangle,
  },
  APPROVED: {
    label: "Released",
    tone: "border-theme-success/30 bg-theme-success/10 text-theme-success",
    icon: CheckCircle2,
  },
  REJECTED: {
    label: "Needs revision",
    tone: "border-theme-error/30 bg-theme-error/10 text-theme-error",
    icon: AlertTriangle,
  },
  PARTIALLY_PAID: {
    label: "Partially paid",
    tone: "border-theme-warning/30 bg-theme-warning/10 text-theme-warning",
    icon: ArrowUpRight,
  },
};

function formatDeadline(deadline?: string | null) {
  if (!deadline) return "No deadline";
  return formatLocalTimestamp(deadline);
}

export default function MilestoneProgressTracker({
  milestones,
  jobTitle,
  explorerBaseUrl = "https://stellar.expert/explorer/testnet/tx",
}: MilestoneProgressTrackerProps) {
  const total = milestones.length;
  const completed = milestones.filter((milestone) => milestone.status === "APPROVED").length;
  const progress = total ? Math.round((completed / total) * 100) : 0;

  return (
    <section className="card overflow-hidden">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-theme-text">
            Milestone flow
          </p>
          <h2 className="mt-1 text-lg font-semibold text-theme-heading">
            {jobTitle}
          </h2>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-theme-heading">
            {completed} / {total}
          </div>
          <div className="text-xs text-theme-text">milestones released</div>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-xs text-theme-text">
          <span>Release progress</span>
          <span className="font-semibold text-stellar-blue">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-theme-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-stellar-blue to-stellar-purple transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {milestones.map((milestone, index) => {
          const meta = statusMeta[milestone.status] || statusMeta.PENDING;
          const StatusIcon = meta.icon;
          const explorerLink =
            milestone.releaseTransactionHash && milestone.status === "APPROVED"
              ? `${explorerBaseUrl}/${milestone.releaseTransactionHash}`
              : null;

          return (
            <div
              key={milestone.id}
              className="rounded-2xl border border-theme-border bg-theme-card/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${meta.tone}`}>
                    <StatusIcon size={16} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-theme-heading">
                      {index + 1}. {milestone.title}
                    </div>
                    <div className="mt-1 text-xs text-theme-text">
                      {milestone.amount.toLocaleString()} XLM
                      {milestone.contractDeadline && (
                        <>
                          {" "}
                          ·{" "}
                          <span title={formatUtcTimestamp(milestone.contractDeadline)}>
                            due {formatDeadline(milestone.contractDeadline)}
                          </span>
                        </>
                      )}
                    </div>
                    {milestone.description && (
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-theme-text">
                        {milestone.description}
                      </p>
                    )}
                  </div>
                </div>

                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${meta.tone}`}
                >
                  {meta.label}
                </span>
              </div>

              {milestone.status === "APPROVED" && explorerLink && (
                <div className="mt-4">
                  <Link
                    href={explorerLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-stellar-blue hover:underline"
                  >
                    View release on explorer <ArrowUpRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
