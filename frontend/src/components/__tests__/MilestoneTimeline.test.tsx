import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MilestoneTimeline, {
  getMilestoneDraftKey,
} from "../MilestoneTimeline";
import type { Milestone } from "@/types";

jest.mock("@/hooks/useOfflineStatus", () => ({
  useOfflineStatus: () => ({ isOnline: true, hasPendingSync: false }),
}));

const baseMilestone: Milestone = {
  id: "milestone-1",
  jobId: "job-1",
  title: "Design handoff",
  description: "Final screens and notes",
  amount: 250,
  status: "IN_PROGRESS",
  order: 0,
  contractDeadline: "2026-08-01T00:00:00.000Z",
};

function renderTimeline(
  milestone: Milestone = baseMilestone,
  onSubmitMilestone = jest.fn(),
) {
  return render(
    <MilestoneTimeline
      milestones={[milestone]}
      isClient={false}
      isFreelancerOnJob
      onSubmitMilestone={onSubmitMilestone}
      onApproveMilestone={jest.fn()}
      onRequestRevision={jest.fn()}
      actioningMilestoneId={null}
      recentlyApprovedMilestoneId={null}
    />,
  );
}

describe("MilestoneTimeline draft persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    window.localStorage.clear();
  });

  test("saves milestone submission draft to localStorage within two seconds", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const draftKey = getMilestoneDraftKey("job-1", 0);

    renderTimeline();

    await user.click(screen.getByRole("button", { name: /submit milestone/i }));
    await user.type(
      screen.getByLabelText(/description/i),
      "The prototype is ready for review.",
    );
    await user.type(screen.getByLabelText(/links/i), "https://example.com/demo");
    await user.upload(
      screen.getByLabelText(/attachments/i),
      new File(["notes"], "handoff-notes.txt", { type: "text/plain" }),
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}")).toEqual({
      description: "The prototype is ready for review.",
      links: "https://example.com/demo",
      attachmentNames: ["handoff-notes.txt"],
    });
  });

  test("restores a saved draft on remount with a visible banner", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const draftKey = getMilestoneDraftKey("job-1", 0);

    const firstRender = renderTimeline();
    await user.click(screen.getByRole("button", { name: /submit milestone/i }));
    await user.type(screen.getByLabelText(/description/i), "Ready for QA.");

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    firstRender.unmount();
    renderTimeline();

    expect(screen.getByRole("status")).toHaveTextContent("Draft restored");
    expect(screen.getByRole("button", { name: /discard draft/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toHaveValue("Ready for QA.");
    expect(window.localStorage.getItem(draftKey)).not.toBeNull();
  });

  test("clears the draft after the milestone is submitted successfully", () => {
    const draftKey = getMilestoneDraftKey("job-1", 0);
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        description: "Done.",
        links: "",
        attachmentNames: [],
      }),
    );

    const { rerender } = renderTimeline();

    rerender(
      <MilestoneTimeline
        milestones={[{ ...baseMilestone, status: "SUBMITTED" }]}
        isClient={false}
        isFreelancerOnJob
        onSubmitMilestone={jest.fn()}
        onApproveMilestone={jest.fn()}
        onRequestRevision={jest.fn()}
        actioningMilestoneId={null}
        recentlyApprovedMilestoneId={null}
      />,
    );

    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });
});
