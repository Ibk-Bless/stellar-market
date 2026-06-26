import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApproveMilestoneModal from "../ApproveMilestoneModal";

jest.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => undefined,
}));

const defaultProps = {
  isOpen: true,
  milestoneTitle: "Design Handoff",
  milestoneAmount: 250,
  freelancerName: "alice",
  milestoneDescription: "Final screens exported to Figma.",
  isLoading: false,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ApproveMilestoneModal {...defaultProps} {...overrides} />);
}

describe("ApproveMilestoneModal", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("confirm button is disabled before any input", () => {
    renderModal();
    expect(
      screen.getByRole("button", { name: /confirm approval/i }),
    ).toBeDisabled();
  });

  test("confirm button remains disabled while typing partial word", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByRole("textbox"), "APPR");

    expect(
      screen.getByRole("button", { name: /confirm approval/i }),
    ).toBeDisabled();
  });

  test("confirm button enables after typing APPROVE and countdown completes", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByRole("textbox"), "APPROVE");

    // Countdown must elapse before button enables.
    expect(
      screen.getByRole("button", { name: /confirm approval/i }),
    ).toBeDisabled();

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(
      screen.getByRole("button", { name: /confirm approval/i }),
    ).not.toBeDisabled();
  });

  test("confirm button enables after typing approve (case-insensitive)", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    renderModal();

    await user.type(screen.getByRole("textbox"), "approve");

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(
      screen.getByRole("button", { name: /confirm approval/i }),
    ).not.toBeDisabled();
  });

  test("shows milestone summary details", () => {
    renderModal();
    expect(screen.getByText("Design Handoff")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  test("does not render when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(
      screen.queryByRole("button", { name: /confirm approval/i }),
    ).not.toBeInTheDocument();
  });
});
