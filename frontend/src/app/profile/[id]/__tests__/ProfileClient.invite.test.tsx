import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import ProfileClient from "../ProfileClient";
import { ToastProvider } from "@/components/Toast";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const renderProfile = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProfileClient />
      </ToastProvider>
    </QueryClientProvider>,
  );

jest.mock("axios");
const mockAxios = axios as jest.Mocked<typeof axios>;

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "freelancer-1" }),
}));

jest.mock("next/link", () => {
  return ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  );
});

// ContractService.getReputation runs against a wallet; stub it out.
jest.mock("@/services/ContractService", () => ({
  ContractService: { getReputation: jest.fn().mockResolvedValue(null) },
  ReputationResult: {},
  DEFAULT_BADGE_TIERS: [
    { name: "Bronze", minScore: 100, colour: "#CD7F32" },
    { name: "Silver", minScore: 300, colour: "#C0C0C0" },
    { name: "Gold", minScore: 500, colour: "#FFD700" },
    { name: "Platinum", minScore: 700, colour: "#E5E4E2" },
  ],
}));

// Drive the viewer role per-test.
let mockCurrentUser: { id: string; role: string } | null = null;
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));

const freelancerProfile = {
  id: "freelancer-1",
  username: "alice",
  role: "FREELANCER",
  bio: "Soroban dev",
  skills: ["Rust"],
  walletAddress: null,
  createdAt: new Date("2025-01-01").toISOString(),
  availability: true,
  reviewsReceived: [],
  clientJobs: [],
  freelancerJobs: [],
  averageRating: 0,
  reviewCount: 0,
  services: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAxios.get.mockImplementation((url: string) => {
    if (url.includes("/portfolio/")) return Promise.resolve({ data: { items: [] } });
    if (url.includes("/users/")) return Promise.resolve({ data: freelancerProfile });
    return Promise.resolve({ data: {} });
  });
});

describe("ProfileClient — Invite to Job CTA", () => {
  it("shows the CTA when a client views a freelancer profile", async () => {
    mockCurrentUser = { id: "client-1", role: "CLIENT" };
    renderProfile();

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Invite to Job/i })).toBeInTheDocument();
  });

  it("hides the CTA from a freelancer viewer", async () => {
    mockCurrentUser = { id: "freelancer-2", role: "FREELANCER" };
    renderProfile();

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Invite to Job/i })).not.toBeInTheDocument();
  });

  it("hides the CTA when the client views their own profile", async () => {
    mockCurrentUser = { id: "freelancer-1", role: "CLIENT" };
    renderProfile();

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Invite to Job/i })).not.toBeInTheDocument();
  });
});
