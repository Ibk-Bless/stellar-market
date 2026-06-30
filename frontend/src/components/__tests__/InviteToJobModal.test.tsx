import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import InviteToJobModal from "@/components/InviteToJobModal";
import axios from "axios";

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "mock-token", user: { id: "client-1", role: "CLIENT" } }),
}));

const toastSuccess = jest.fn();
jest.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: jest.fn() } }),
}));

jest.mock("next/link", () => {
  return ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  );
});

const openJobs = [
  { id: "job-1", title: "Build a Soroban contract", budget: 1000, category: "Smart Contract", status: "OPEN" },
  { id: "job-2", title: "Design a landing page", budget: 500, category: "Design", status: "OPEN" },
];

beforeEach(() => {
  jest.clearAllMocks();
  (mockAxios.isAxiosError as unknown as jest.Mock) = jest.fn(() => false);
});

function renderModal(props: Partial<React.ComponentProps<typeof InviteToJobModal>> = {}) {
  return render(
    <InviteToJobModal
      freelancerId="freelancer-1"
      freelancerName="alice"
      isOpen
      onClose={jest.fn()}
      {...props}
    />,
  );
}

describe("InviteToJobModal", () => {
  it("lists the client's open jobs", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { data: openJobs } });
    renderModal();

    await waitFor(() => expect(screen.getByText("Build a Soroban contract")).toBeInTheDocument());
    expect(screen.getByText("Design a landing page")).toBeInTheDocument();
    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/jobs/mine?status=OPEN"),
      expect.anything(),
    );
  });

  it("creates an invitation for the selected job", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { data: openJobs } });
    mockAxios.post.mockResolvedValueOnce({ data: { id: "inv-1" } });
    const onSuccess = jest.fn();
    const onClose = jest.fn();
    renderModal({ onSuccess, onClose });

    await waitFor(() => expect(screen.getByText("Design a landing page")).toBeInTheDocument());

    // Pick the second job, then send.
    fireEvent.click(screen.getByRole("radio", { name: /Design a landing page/i }));
    await act(async () => {
      fireEvent.click(screen.getByText("Send Invitation"));
    });

    await waitFor(() =>
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/jobs/job-2/invitations"),
        expect.objectContaining({ freelancerId: "freelancer-1" }),
        expect.anything(),
      ),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("offers a post-a-new-job link when the client has no open jobs", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { data: [] } });
    renderModal();

    await waitFor(() =>
      expect(screen.getByText("You have no open jobs to invite this freelancer to.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Post a new job").closest("a")).toHaveAttribute("href", "/post-job");
  });
});
