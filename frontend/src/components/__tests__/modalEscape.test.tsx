/**
 * Tests for #819: Escape key closes modals and focus returns to trigger element.
 *
 * Covers every modal component that accepts isOpen/onClose props.
 * useFocusTrap is NOT mocked — its real implementation is exercised so the
 * Escape-key listener and focus-restoration paths are actually tested.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
}

/**
 * Renders a controlled harness:  [trigger button] + [modal controlled by open state].
 * Focuses the trigger and clicks it so useFocusTrap captures the right previousFocusRef.
 * Returns { onClose } so callers can assert on it.
 */
function renderWithTrigger(
  buildModal: (open: boolean, onClose: () => void) => React.ReactNode,
) {
  const onClose = jest.fn();
  function Harness() {
    const [open, setOpen] = React.useState(false);
    const close = () => { setOpen(false); onClose(); };
    return (
      <>
        <button
          data-testid="trigger"
          onClick={() => setOpen(true)}
        >
          Open
        </button>
        {buildModal(open, close)}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByTestId("trigger");
  trigger.focus();
  act(() => { fireEvent.click(trigger); });
  return { onClose, trigger };
}

// ---------------------------------------------------------------------------
// Mock heavy/unrelated dependencies
// ---------------------------------------------------------------------------

jest.mock("axios", () => ({
  post: jest.fn(),
  get: jest.fn().mockResolvedValue({ data: { data: [] } }),
  delete: jest.fn(),
  isAxiosError: jest.fn(() => false),
}));

jest.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ signAndBroadcastTransaction: jest.fn() }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "tok", user: { id: "u1" } }),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

jest.mock("next/dynamic", () => () => () => <textarea aria-label="Cover letter editor" />);

// Use the real useFocusTrap — that is exactly what we want to test.
jest.mock("@/hooks/useFocusTrap", () => jest.requireActual("@/hooks/useFocusTrap"));

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const baseJob = {
  id: "j1",
  title: "Job",
  budget: 100,
  status: "IN_PROGRESS",
  escrowStatus: "FUNDED",
  milestones: [],
  category: "Dev",
  skills: [],
  deadline: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  client: { id: "c1", username: "client", walletAddress: "GCLIENT" },
  freelancer: null,
} as any;

const milestone = { id: "m1", title: "M1", status: "IN_PROGRESS", contractDeadline: null } as any;

// ---------------------------------------------------------------------------
// ApproveMilestoneModal
// ---------------------------------------------------------------------------

import ApproveMilestoneModal from "../ApproveMilestoneModal";

const approveProps = {
  milestoneTitle: "Design",
  milestoneAmount: 100,
  freelancerName: "alice",
  milestoneDescription: "",
  isLoading: false,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
};

describe("ApproveMilestoneModal — Escape key (#819)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(<ApproveMilestoneModal {...approveProps} isOpen onClose={approveProps.onClose} />);
    pressEscape();
    expect(approveProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(<ApproveMilestoneModal {...approveProps} isOpen={false} />);
    pressEscape();
    expect(approveProps.onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <ApproveMilestoneModal {...approveProps} isOpen={open} onClose={onClose} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// RaiseDisputeModal
// ---------------------------------------------------------------------------

import RaiseDisputeModal from "../RaiseDisputeModal";

describe("RaiseDisputeModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(<RaiseDisputeModal job={baseJob} isOpen onClose={onClose} onSuccess={jest.fn()} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(<RaiseDisputeModal job={baseJob} isOpen={false} onClose={onClose} onSuccess={jest.fn()} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <RaiseDisputeModal job={baseJob} isOpen={open} onClose={onClose} onSuccess={jest.fn()} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// ReviewModal
// ---------------------------------------------------------------------------

import ReviewModal from "../ReviewModal";

describe("ReviewModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(
      <ReviewModal job={baseJob} revieweeId="u2" revieweeName="bob" isOpen onClose={onClose} onSuccess={jest.fn()} />,
    );
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(
      <ReviewModal job={baseJob} revieweeId="u2" revieweeName="bob" isOpen={false} onClose={onClose} onSuccess={jest.fn()} />,
    );
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <ReviewModal job={baseJob} revieweeId="u2" revieweeName="bob" isOpen={open} onClose={onClose} onSuccess={jest.fn()} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// DeadlineExtensionModal
// ---------------------------------------------------------------------------

import DeadlineExtensionModal from "../DeadlineExtensionModal";

describe("DeadlineExtensionModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(
      <DeadlineExtensionModal milestone={milestone} jobId="j1" isOpen onClose={onClose} onSuccess={jest.fn()} />,
    );
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(
      <DeadlineExtensionModal milestone={milestone} jobId="j1" isOpen={false} onClose={onClose} onSuccess={jest.fn()} />,
    );
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <DeadlineExtensionModal milestone={milestone} jobId="j1" isOpen={open} onClose={onClose} onSuccess={jest.fn()} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// ProposeRevisionModal
// ---------------------------------------------------------------------------

import ProposeRevisionModal from "../ProposeRevisionModal";

describe("ProposeRevisionModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(
      <ProposeRevisionModal isOpen onClose={onClose} onSubmit={async () => {}} initialRows={[]} processing={false} />,
    );
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(
      <ProposeRevisionModal isOpen={false} onClose={onClose} onSubmit={async () => {}} initialRows={[]} processing={false} />,
    );
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <ProposeRevisionModal isOpen={open} onClose={onClose} onSubmit={async () => {}} initialRows={[]} processing={false} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// ApplyModal
// ---------------------------------------------------------------------------

import ApplyModal from "../ApplyModal";

const openJob = { ...baseJob, status: "OPEN" };

describe("ApplyModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(<ApplyModal job={openJob} isOpen onClose={onClose} onSuccess={jest.fn()} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(<ApplyModal job={openJob} isOpen={false} onClose={onClose} onSuccess={jest.fn()} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <ApplyModal job={openJob} isOpen={open} onClose={onClose} onSuccess={jest.fn()} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// InviteToJobModal
// ---------------------------------------------------------------------------

import InviteToJobModal from "../InviteToJobModal";

describe("InviteToJobModal — Escape key (#819)", () => {
  const onClose = jest.fn();
  beforeEach(() => jest.clearAllMocks());

  it("calls onClose when Escape is pressed while open", () => {
    render(
      <InviteToJobModal freelancerId="f1" freelancerName="alice" isOpen onClose={onClose} />,
    );
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when modal is closed", () => {
    render(
      <InviteToJobModal freelancerId="f1" freelancerName="alice" isOpen={false} onClose={onClose} />,
    );
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger element after close", () => {
    const { trigger } = renderWithTrigger((open, onClose) => (
      <InviteToJobModal freelancerId="f1" freelancerName="alice" isOpen={open} onClose={onClose} />
    ));
    pressEscape();
    expect(document.activeElement).toBe(trigger);
  });
});
