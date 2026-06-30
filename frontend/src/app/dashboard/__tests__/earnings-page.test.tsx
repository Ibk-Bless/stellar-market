import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";

jest.mock("axios", () => ({ get: jest.fn(), isAxiosError: jest.fn() }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "fl-1", role: "FREELANCER" } }),
}));

jest.mock("recharts", () => {
  const React = require("react");
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    ComposedChart: ({ children }: any) => <div data-testid="chart">{children}</div>,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const emptyResponse = {
  data: {
    summary: { totalEarned: 500, earnedThisMonth: 100, pendingRelease: 50, activeEscrow: 0 },
    weeklyEarnings: [],
    categoryBreakdown: [],
    range: { from: "2026-05-27", to: "2026-06-27" },
    transactions: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
  },
};

const PRESET_STORAGE_KEY = "stellar_earnings_preset";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockedAxios.get.mockResolvedValue(emptyResponse);
});

async function renderPage() {
  const { EarningsPage } = await import("../earnings-page");
  render(<EarningsPage />);
}

describe("Earnings page preset shortcuts", () => {
  it("renders all 5 preset buttons", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    expect(screen.getByTestId("preset-last_7_days")).toBeInTheDocument();
    expect(screen.getByTestId("preset-last_30_days")).toBeInTheDocument();
    expect(screen.getByTestId("preset-last_3_months")).toBeInTheDocument();
    expect(screen.getByTestId("preset-this_year")).toBeInTheDocument();
    expect(screen.getByTestId("preset-all_time")).toBeInTheDocument();
  });

  it("highlights the active preset button", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    const activeBtn = screen.getByTestId("preset-last_30_days");
    expect(activeBtn.className).toMatch(/bg-stellar-blue/);

    const inactiveBtn = screen.getByTestId("preset-last_7_days");
    expect(inactiveBtn.className).not.toMatch(/bg-stellar-blue/);
  });

  it("clicking a preset triggers a new API query", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    const callCount = mockedAxios.get.mock.calls.length;
    fireEvent.click(screen.getByTestId("preset-this_year"));
    await waitFor(() => expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(callCount));
  });

  it("persists the selected preset to localStorage", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("preset-last_7_days"));
    expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe("last_7_days");
  });

  it("restores last-used preset from localStorage on mount", async () => {
    localStorage.setItem(PRESET_STORAGE_KEY, "this_year");
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    const activeBtn = screen.getByTestId("preset-this_year");
    expect(activeBtn.className).toMatch(/bg-stellar-blue/);
  });

  it("all_time preset does not include from/to in the API request", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    mockedAxios.get.mockClear();
    fireEvent.click(screen.getByTestId("preset-all_time"));

    // Switching presets can leave a couple of stale in-flight requests from the
    // previous range, so assert on the most recent earnings request rather than
    // the first one recorded.
    await waitFor(() => {
      const latest = mockedAxios.get.mock.calls
        .map((c) => c[0] as string)
        .filter((u) => u.includes("/earnings?"))
        .at(-1);
      expect(latest).toBeDefined();
      expect(latest).not.toMatch(/from=/);
    });

    const url = mockedAxios.get.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.includes("/earnings?"))
      .at(-1)!;
    expect(url).not.toMatch(/from=/);
    expect(url).not.toMatch(/to=/);
  });

  it("last_30_days preset includes a from date ~30 days ago", async () => {
    await renderPage();
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    mockedAxios.get.mockClear();
    fireEvent.click(screen.getByTestId("preset-last_30_days"));

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    const url: string = mockedAxios.get.mock.calls[0][0] as string;
    expect(url).toMatch(/from=/);

    const fromMatch = url.match(/from=([^&]+)/);
    expect(fromMatch).not.toBeNull();
    const fromDate = new Date(decodeURIComponent(fromMatch![1]));
    const expectedFrom = new Date();
    expectedFrom.setDate(expectedFrom.getDate() - 30);
    const diffMs = Math.abs(fromDate.getTime() - expectedFrom.getTime());
    expect(diffMs).toBeLessThan(5000);
  });
});
