import "@testing-library/jest-dom";
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import Navbar from "@/components/Navbar";

// ─── Mock axios ───────────────────────────────────────────────────────────────
jest.mock("axios", () => ({
  get: jest.fn().mockResolvedValue({ data: { count: 0 } }),
}));
import axios from "axios";
const mockAxios = axios as jest.Mocked<typeof axios>;

// ─── Mock AuthContext ─────────────────────────────────────────────────────────
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    token: "mock-token",
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
    isLoading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ─── Mock ThemeContext ────────────────────────────────────────────────────────
jest.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ─── Mock WalletContext ───────────────────────────────────────────────────────
jest.mock("@/context/WalletContext", () => ({
  useWallet: () => ({
    address: null,
    isConnecting: false,
    error: null,
    balance: null,
    balances: [],
    isLoadingBalance: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    refreshBalance: jest.fn(),
  }),
  truncateAddress: (a: string) => a,
}));

// ─── Mock cached wallet balance hook (avoids needing a QueryClientProvider) ──────
jest.mock("@/hooks/useWalletBalance", () => ({
  useWalletBalance: () => ({
    balances: [],
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// ─── Mock Socket mock ──────────────────────────────────────────────────────────
const mockSocketHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
const mockSocket = {
  on: jest.fn((event: string, fn: (...args: unknown[]) => void) => {
    mockSocketHandlers[event] = mockSocketHandlers[event] ?? [];
    mockSocketHandlers[event].push(fn);
  }),
  off: jest.fn(),
  emit: jest.fn(),
  _trigger: (event: string, ...args: unknown[]) => {
    mockSocketHandlers[event]?.forEach((fn) => fn(...args));
  },
};

jest.mock("@/context/SocketContext", () => ({
  useSocket: () => ({ socket: mockSocket, isConnected: true }),
}));

// ─── Mock Toast ───────────────────────────────────────────────────────────────
jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    toast: {
      success: jest.fn(),
      error: jest.fn(),
    },
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ─── next/link stub ───────────────────────────────────────────────────────────
jest.mock("next/link", () => {
  const Link = ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>;
  Link.displayName = "Link";
  return Link;
});

// ─── next/navigation stub ─────────────────────────────────────────────────────
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/",
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockSocketHandlers).forEach((k) => delete mockSocketHandlers[k]);
  localStorage.setItem("stellarmarket_jwt", "mock-token");
});
afterEach(() => {
  localStorage.clear();
});

describe("Navbar", () => {
  it("renders the Messages link pointing to /messages", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 0 } });
    await act(async () => {
      render(<Navbar />);
    });
    const link = document.querySelector('a[href="/messages"]');
    expect(link).toBeInTheDocument();
  });

  it("shows the unread badge with count from API", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 5 } });

    render(<Navbar />);

    await waitFor(() => {
      const badges = screen.getAllByTestId("unread-badge");
      expect(badges[0]).toHaveTextContent("5");
    });
  });

  it("increments badge when new_message socket event fires", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 2 } });

    render(<Navbar />);

    await waitFor(() => {
      const badges = screen.getAllByTestId("unread-badge");
      expect(badges[0]).toHaveTextContent("2");
    });

    await act(async () => {
      mockSocket._trigger("new_message", {});
    });

    const badges = screen.getAllByTestId("unread-badge");
    expect(badges[0]).toHaveTextContent("3");
  });

  it("clears badge when messages_read event fires", async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { count: 4 } });

    render(<Navbar />);

    await waitFor(() => {
      const badges = screen.getAllByTestId("unread-badge");
      expect(badges[0]).toHaveTextContent("4");
    });

    await act(async () => {
      mockSocket._trigger("messages_read", {});
    });

    expect(screen.queryByTestId("unread-badge")).not.toBeInTheDocument();
  });
});
