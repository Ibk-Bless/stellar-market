interface BadgeProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "error" | "info";
}

export default function Badge({ label, tone = "neutral" }: BadgeProps) {
  const tones = {
    neutral: "border-theme-border bg-theme-bg-secondary text-theme-heading",
    success: "border-theme-success/30 bg-theme-success/10 text-theme-success",
    warning: "border-theme-warning/30 bg-theme-warning/10 text-theme-warning",
    error: "border-theme-error/30 bg-theme-error/10 text-theme-error",
    info: "border-theme-info/30 bg-theme-info/10 text-theme-info",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}
