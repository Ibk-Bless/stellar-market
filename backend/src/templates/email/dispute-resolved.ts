import { renderEmailLayout } from "./layout";

export function renderDisputeResolvedEmail(params: {
  title: string;
  message: string;
  outcome?: string;
  actionUrl?: string;
}): string {
  const outcomeText =
    params.outcome === "CLIENT"
      ? "The dispute was resolved in favor of the client."
      : params.outcome === "FREELANCER"
        ? "The dispute was resolved in favor of the freelancer."
        : "The dispute has been resolved.";

  return renderEmailLayout({
    title: params.title,
    preheader: "Your dispute has been resolved.",
    bodyHtml: `
      <p>${params.message}</p>
      <p><strong>${outcomeText}</strong></p>
      <p>The job has been marked as completed. If you have any concerns, please contact support.</p>
    `,
    actionUrl: params.actionUrl,
    actionLabel: params.actionUrl ? "View job details" : undefined,
  });
}
