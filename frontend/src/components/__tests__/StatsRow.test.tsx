import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import StatsRow from "../StatsRow";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { AuthContext } from "@/context/AuthContext";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("@/context/AuthContext", () => ({
  useAuth: jest.fn(),
  AuthContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));
import { useAuth } from "@/context/AuthContext";

describe("StatsRow component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <StatsRow />
      </QueryClientProvider>
    );
  };

  it("renders loading skeleton initially", () => {
    (useAuth as jest.Mock).mockReturnValue({ token: "fake-token" });
    // mock unresolved promise so it stays loading
    mockedAxios.get.mockImplementation(() => new Promise(() => {}));
    
    const { container } = renderComponent();
    // Verify skeleton elements are present
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders stats correctly when data is loaded", async () => {
    (useAuth as jest.Mock).mockReturnValue({ token: "fake-token" });
    
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        totalEarnedXlm: 2500,
        completedJobs: 10,
        activeJobs: 3,
        averageRating: 4.5,
        reviewCount: 20,
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument(); // activeJobs
      expect(screen.getByText("10")).toBeInTheDocument(); // completedJobs
      expect(screen.getByText("2,500 XLM")).toBeInTheDocument(); // totalEarnedXlm
      expect(screen.getByText("4.5/5")).toBeInTheDocument(); // averageRating
    });

    expect(screen.getByText("Active Work")).toBeInTheDocument();
    expect(screen.getByText("Completed Jobs")).toBeInTheDocument();
    expect(screen.getByText("Total Earned")).toBeInTheDocument();
    expect(screen.getByText("Rating")).toBeInTheDocument();
    expect(screen.getByText("20 reviews")).toBeInTheDocument();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining("/freelancers/me/stats"),
      expect.objectContaining({
        headers: { Authorization: "Bearer fake-token" },
      })
    );
  });

  it("does not fetch if token is missing", () => {
    (useAuth as jest.Mock).mockReturnValue({ token: null });
    
    renderComponent();
    
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
