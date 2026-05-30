import Badge from "./Badge";

interface MilestoneTrackerProps {
  milestones: Array<{
    id: string;
    title: string;
    amount: number;
    status: "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PARTIALLY_PAID";
  }>;
}

export default function MilestoneTracker({ milestones }: MilestoneTrackerProps) {
  return (
    <div className="space-y-3">
      {milestones.map((milestone, index) => (
        <div key={milestone.id} className="flex items-center gap-3 rounded-lg border border-theme-border bg-theme-card p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stellar-blue/10 text-sm font-semibold text-stellar-blue">
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-theme-heading">{milestone.title}</p>
            <p className="text-xs text-theme-text">{milestone.amount.toLocaleString()} XLM</p>
          </div>
          <Badge label={milestone.status.replaceAll("_", " ")} tone={milestone.status === "APPROVED" ? "success" : "info"} />
        </div>
      ))}
    </div>
  );
}
