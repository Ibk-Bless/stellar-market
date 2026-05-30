"use client";

import { CheckCircle, Circle, FileText, Scale, Gavel, Clock } from "lucide-react";
import type { Dispute } from "@/types";

interface DisputeTimelineProps {
  dispute: Dispute;
}

type TimelineEvent = {
  id: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  timestamp: string;
  done: boolean;
};

export default function DisputeTimeline({ dispute }: DisputeTimelineProps) {
  // Build events from dispute state
  const events: TimelineEvent[] = [
    {
      id: "opened",
      icon: <Scale size={16} />,
      label: "Dispute Opened",
      detail: `Initiated by ${dispute.initiator.username}`,
      timestamp: dispute.createdAt,
      done: true,
    },
    {
      id: "evidence",
      icon: <FileText size={16} />,
      label: "Evidence Period",
      detail: "Parties may submit supporting evidence",
      timestamp: dispute.createdAt,
      done: dispute.status !== "OPEN",
    },
    {
      id: "voting",
      icon: <Gavel size={16} />,
      label: "Community Voting",
      detail: `${dispute.votesForClient + dispute.votesForFreelancer} of ${dispute.minVotes} votes cast`,
      timestamp: dispute.updatedAt,
      done: dispute.status === "VOTING" || dispute.status === "RESOLVED_CLIENT" || dispute.status === "RESOLVED_FREELANCER",
    },
    {
      id: "resolved",
      icon: <CheckCircle size={16} />,
      label: "Resolved",
      detail:
        dispute.status === "RESOLVED_CLIENT"
          ? "Resolved in favour of client"
          : dispute.status === "RESOLVED_FREELANCER"
          ? "Resolved in favour of freelancer"
          : undefined,
      timestamp: dispute.updatedAt,
      done: dispute.status === "RESOLVED_CLIENT" || dispute.status === "RESOLVED_FREELANCER",
    },
  ];

  return (
    <div className="card">
      <h3 className="font-semibold text-theme-heading mb-4 flex items-center gap-2">
        <Clock size={18} className="text-stellar-blue" />
        Dispute Timeline
      </h3>
      <ol className="relative border-l border-theme-border ml-3">
        {events.map((ev, idx) => (
          <li key={ev.id} className={`mb-6 ml-6 ${idx === events.length - 1 ? "mb-0" : ""}`}>
            <span
              className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full border ${
                ev.done
                  ? "bg-stellar-blue border-stellar-blue text-white"
                  : "bg-theme-bg-secondary border-theme-border text-theme-text"
              }`}
            >
              {ev.done ? ev.icon : <Circle size={12} />}
            </span>
            <div>
              <p className={`text-sm font-semibold ${ev.done ? "text-theme-heading" : "text-theme-text"}`}>
                {ev.label}
              </p>
              {ev.detail && (
                <p className="text-xs text-theme-text mt-0.5">{ev.detail}</p>
              )}
              {ev.done && (
                <time className="text-[10px] text-theme-text-muted">
                  {new Date(ev.timestamp).toLocaleString()}
                </time>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
