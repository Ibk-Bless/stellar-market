/**
 * Tests for #812: cursor-based pagination of job applicants.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";

jest.mock("axios", () => ({ get: jest.fn(), put: jest.fn(), isAxiosError: jest.fn() }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("next/navigation", () => ({ useParams: () => ({ id: "job-1" }) }));

jest.mock("@/context/WalletContext", () => ({
  useWallet: () => ({
    address: "GCLIENT_WALLET",
    balances: [],
    signAndBroadcastTransaction: jest.fn(),
  }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "client-1", role: "CLIENT" },
  }),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: { success: jest.fn(), error: jest.fn() } }),
}));

// Stub every modal/heavy component to keep the test fast.
jest.mock("@/components/ApplyModal", () => () => null);
jest.mock("@/components/RaiseDisputeModal", () => () => null);
jest.mock("@/components/ReviewModal", () => () => null);
jest.mock("@/components/MilestoneTimeline", () => ({
  __esModule: true,
  default: () => null,
  getMilestoneDraftKey: () => "draft",
}));
jest.mock("@/components/MilestoneProgressTracker", () => () => null);
jest.mock("@/components/TransactionConfirmationModal", () => () => null);
jest.mock("@/components/DepositRateInfo", () => () => null);
jest.mock("@/components/ProposeRevisionModal", () => () => null);
jest.mock("@/components/ApproveMilestoneModal", () => () => null);
jest.mock("@/components/ShareMenu", () => () => null);
jest.mock("@/components/StatusBadge", () => ({ status }: { status: string }) => <span>{status}</span>);
jest.mock("@/components/WalletAddress", () => ({ address }: { address: string }) => <span>{address}</span>);
jest.mock("next/link", () => ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>);
jest.mock("@/utils/stellar", () => ({ parseJobIdFromResult: jest.fn() }));
jest.mock("@/constants/jobs", () => ({
  PAYMENT_TOKENS: ["XLM"],
  TOKEN_EXCHANGE_RATES: { XLM: 1 },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function makeApp(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function buildJob(override: object = {}) {
  return {
    id: "job-1",
    title: "Test Job",
    description: "Desc",
    budget: 100,
    category: "Dev",
    skills: [],
    status: "OPEN",
    escrowStatus: "UNFUNDED",
    contractJobId: null,
    createdAt: new Date().toISOString(),
    deadline: new Date().toISOString(),
    client: { id: "client-1", username: "Client", walletAddress: "GCLIENT_WALLET", bio: "" },
    freelancer: null,
    milestones: [],
    revisionProposal: null,
    ...override,
  };
}

function buildApplication(id: string, username: string) {
  return {
    id,
    freelancerId: `fl-${id}`,
    jobId: "job-1",
    proposal: "proposal",
    bidAmount: 10,
    estimatedDuration: 7,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    freelancer: { id: `fl-${id}`, username, avatarUrl: null },
  };
}

function buildAppsPage(apps: ReturnType<typeof buildApplication>[], total: number, page: number, totalPages: number) {
  return { data: { data: apps, total, page, totalPages } };
}

describe("JobDetailClient applicant pagination (#812)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initial render loads first 20 applications and shows count", async () => {
    const page1Apps = Array.from({ length: 20 }, (_, i) => buildApplication(`a${i}`, `user${i}`));

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes("/jobs/job-1") && !url.includes("applications")) {
        return Promise.resolve({ data: buildJob() });
      }
      if (url.includes("/applications") && !url.includes("jobs/job-1/applications")) {
        return Promise.resolve({ data: { data: [], total: 0 } });
      }
      if (url.includes("jobs/job-1/applications")) {
        return Promise.resolve(buildAppsPage(page1Apps, 45, 1, 3));
      }
      return Promise.resolve({ data: {} });
    });

    const { default: JobDetailClient } = await import("../JobDetailClient");
    render(makeApp(<JobDetailClient />));

    await waitFor(() =>
      expect(screen.getByTestId("applicants-count")).toBeInTheDocument()
    );

    expect(screen.getByTestId("applicants-count")).toHaveTextContent(
      "Showing 20 of 45 applications"
    );
    expect(screen.getByTestId("load-more-applications")).toBeInTheDocument();
  });

  it("Load more button fetches next page and appends results", async () => {
    const page1Apps = Array.from({ length: 20 }, (_, i) => buildApplication(`a${i}`, `user${i}`));
    const page2Apps = Array.from({ length: 20 }, (_, i) => buildApplication(`b${i}`, `userB${i}`));

    let pageCallCount = 0;
    mockedAxios.get.mockImplementation((url: string, config: any) => {
      if (url.includes("/jobs/job-1") && !url.includes("applications")) {
        return Promise.resolve({ data: buildJob() });
      }
      if (url.includes("/applications") && !url.includes("jobs/job-1/applications")) {
        return Promise.resolve({ data: { data: [], total: 0 } });
      }
      if (url.includes("jobs/job-1/applications")) {
        pageCallCount++;
        const page = config?.params?.page ?? 1;
        const apps = page === 1 ? page1Apps : page2Apps;
        return Promise.resolve(buildAppsPage(apps, 45, page, 3));
      }
      return Promise.resolve({ data: {} });
    });

    const { default: JobDetailClient } = await import("../JobDetailClient");
    render(makeApp(<JobDetailClient />));

    await waitFor(() => expect(screen.getByTestId("load-more-applications")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("load-more-applications"));

    await waitFor(() =>
      expect(screen.getByTestId("applicants-count")).toHaveTextContent("Showing 40 of 45 applications")
    );
  });

  it("count label updates after load more", async () => {
    const page1Apps = Array.from({ length: 20 }, (_, i) => buildApplication(`a${i}`, `user${i}`));
    const page2Apps = Array.from({ length: 5 }, (_, i) => buildApplication(`b${i}`, `userB${i}`));

    mockedAxios.get.mockImplementation((url: string, config: any) => {
      if (url.includes("/jobs/job-1") && !url.includes("applications")) {
        return Promise.resolve({ data: buildJob() });
      }
      if (url.includes("/applications") && !url.includes("jobs/job-1/applications")) {
        return Promise.resolve({ data: { data: [], total: 0 } });
      }
      if (url.includes("jobs/job-1/applications")) {
        const page = config?.params?.page ?? 1;
        const apps = page === 1 ? page1Apps : page2Apps;
        const total = 25;
        const totalPages = 2;
        return Promise.resolve(buildAppsPage(apps, total, page, totalPages));
      }
      return Promise.resolve({ data: {} });
    });

    const { default: JobDetailClient } = await import("../JobDetailClient");
    render(makeApp(<JobDetailClient />));

    await waitFor(() => expect(screen.getByTestId("applicants-count")).toHaveTextContent("Showing 20 of 25"));

    fireEvent.click(screen.getByTestId("load-more-applications"));

    await waitFor(() =>
      expect(screen.getByTestId("applicants-count")).toHaveTextContent("Showing 25 of 25 applications")
    );

    expect(screen.queryByTestId("load-more-applications")).not.toBeInTheDocument();
  });
});
