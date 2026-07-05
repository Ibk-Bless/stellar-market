import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";
import ClientEarningsPage from "../client-earnings-page";

jest.mock("axios", () => ({
  get: jest.fn(),
  isAxiosError: jest.fn(),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Return a stable user reference; a fresh object per call would change the
// identity of the page's `useCallback`/`useEffect` deps and re-trigger the fetch
// on every render, flipping the component back into its loading state.
jest.mock("@/context/AuthContext", () => {
  const user = { id: "client-1", role: "CLIENT" };
  return { useAuth: () => ({ user }) };
});

// Recharts' ResponsiveContainer relies on layout measurements jsdom doesn't
// provide; stub the pieces this page uses so the chart renders deterministically.
jest.mock("recharts", () => {
  const React = require("react");
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
    Line: () => null,
    BarChart: ({ children, data }: any) => {
      const barChild = React.Children.toArray(children).find(
        (child: any) => child?.props?.dataKey === "totalPaid",
      ) as any;
      return (
        <div data-testid="bar-chart">
          {data.map((entry: any) => (
            <button
              key={entry.freelancerId}
              data-testid={`bar-${entry.freelancerId}`}
              onClick={() => barChild?.props?.onClick?.(entry)}
            >
              {entry.displayName}: {entry.totalPaid}
            </button>
          ))}
        </div>
      );
    },
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});

const mockResponse = {
  data: {
    summary: { totalSpent: 2900, spentThisMonth: 500 },
    monthlySpend: [{ month: "2026-06", spend: 2900 }],
    freelancerBreakdown: [
      { freelancerId: "f-1", displayName: "alpha", totalPaid: 1500, jobCount: 4 },
      { freelancerId: "f-3", displayName: "charlie", totalPaid: 900, jobCount: 1 },
      { freelancerId: "f-2", displayName: "bravo", totalPaid: 500, jobCount: 2 },
    ],
    range: { from: "2025-07-01", to: "2026-06-25" },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAxios.get.mockResolvedValue(mockResponse);
});

describe("ClientEarningsPage", () => {
  it("renders the spend summary and freelancer breakdown chart", async () => {
    render(<ClientEarningsPage />);

    await waitFor(() => expect(screen.getByTestId("bar-chart")).toBeInTheDocument());

    expect(screen.getByText(/2[,\s\xA0]900 XLM/)).toBeInTheDocument();
    expect(screen.getByTestId("bar-f-1")).toHaveTextContent("alpha: 1500");
    expect(screen.getByTestId("bar-f-2")).toHaveTextContent("bravo: 500");
  });

  it("navigates to the freelancer's profile when a bar is clicked", async () => {
    render(<ClientEarningsPage />);

    await waitFor(() => expect(screen.getByTestId("bar-f-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("bar-f-1"));

    expect(mockPush).toHaveBeenCalledWith("/u/alpha");
  });

  it("shows an error message when the request fails with 403", async () => {
    mockedAxios.get.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    (mockedAxios.isAxiosError as jest.Mock).mockReturnValue(true);

    render(<ClientEarningsPage />);

    await waitFor(() =>
      expect(screen.getByText("Only clients can access this page.")).toBeInTheDocument(),
    );
  });
});
