"use client";

interface EscrowStatusBadgeProps {
  status: "UNFUNDED" | "FUNDED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "DISPUTED";
}

const statusConfig: Record<string, { label: string; color: string }> = {
  UNFUNDED: {
    label: "Awaiting Funding",
    color: "bg-theme-warning/20 text-theme-warning border-theme-warning/30",
  },
  FUNDED: {
    label: "Funded",
    color: "bg-theme-success/20 text-theme-success border-theme-success/30",
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-stellar-blue/20 text-stellar-blue border-stellar-blue/30",
  },
  DISPUTED: {
    label: "In Dispute",
    color: "bg-theme-error/20 text-theme-error border-theme-error/30",
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-theme-error/20 text-theme-error border-theme-error/30",
  },
};

export default function EscrowStatusBadge({ status }: EscrowStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.UNFUNDED;

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">
        Escrow Status:
      </span>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${config.color}`}
      >
        {config.label}
      </span>
    </div>
  );
}
