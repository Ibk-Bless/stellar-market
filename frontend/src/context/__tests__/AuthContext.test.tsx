import "@testing-library/jest-dom";
import React from "react";
import { render, act, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import { SocketProvider, useSocket } from "@/context/SocketContext";
import axios from "axios";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock Toast
jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    toast: { success: jest.fn(), error: jest.fn() },
  }),
}));

// Mock Freighter API & Stellar SDK
jest.mock("@stellar/freighter-api", () => ({
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  isConnected: jest.fn().mockResolvedValue({ isConnected: false }),
  getPublicKey: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn().mockResolvedValue({ balances: [] }),
    })),
  },
  rpc: { Server: jest.fn() },
  Transaction: jest.fn(),
}));

// Mock socket.io-client
jest.mock("socket.io-client", () => {
  const socket = {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connected: false,
    disconnect: jest.fn(),
  };
  return { io: jest.fn(() => socket) };
});

jest.mock("axios");
const mockAxiosGet = axios.get as jest.Mock;

const MOCK_USER = {
  id: "user-123",
  email: "test@example.com",
  username: "testuser",
  role: "CLIENT",
};

function TestApp() {
  const { user, token, logout, login } = useAuth();
  const { address } = useWallet();
  const { isConnected } = useSocket();

  return (
    <div>
      <div data-testid="auth-status">{token ? "authenticated" : "unauthenticated"}</div>
      <div data-testid="user-email">{user?.email || "no-user"}</div>
      <div data-testid="wallet-address">{address || "no-wallet"}</div>
      <div data-testid="socket-status">{isConnected ? "connected" : "disconnected"}</div>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
      <button
        data-testid="login-btn"
        onClick={() => login("new-token-123", MOCK_USER as any)}
      >
        Login
      </button>
    </div>
  );
}

describe("AuthContext Cross-Tab Session Synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = "stellarmarket_jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    mockAxiosGet.mockResolvedValue({ data: MOCK_USER });
  });

  it("updates Tab B auth state to unauthenticated when Tab A logs out via storage event", async () => {
    localStorage.setItem("stellarmarket_jwt", "valid-token-123");
    localStorage.setItem("stellarmarket_user", JSON.stringify(MOCK_USER));

    const { unmount } = render(
      <WalletProvider>
        <AuthProvider>
          <SocketProvider>
            <TestApp />
          </SocketProvider>
        </AuthProvider>
      </WalletProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");

    await act(async () => {
      localStorage.removeItem("stellarmarket_jwt");
      localStorage.removeItem("stellarmarket_user");

      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "stellarmarket_jwt",
          oldValue: "valid-token-123",
          newValue: null,
        })
      );
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("user-email")).toHaveTextContent("no-user");
    expect(mockPush).toHaveBeenCalledWith("/auth/login");

    unmount();
  });

  it("tears down wallet and socket sessions on cross-tab logout", async () => {
    localStorage.setItem("stellarmarket_jwt", "valid-token-123");
    localStorage.setItem("stellarmarket_user", JSON.stringify(MOCK_USER));
    localStorage.setItem("stellarmarket_wallet_connected", "true");
    localStorage.setItem(
      "stellarmarket_wallet_session",
      JSON.stringify({ address: "GABC123", connectedAt: Date.now(), lastActivityAt: Date.now() })
    );

    render(
      <WalletProvider>
        <AuthProvider>
          <SocketProvider>
            <TestApp />
          </SocketProvider>
        </AuthProvider>
      </WalletProvider>
    );

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "stellarmarket_jwt",
          oldValue: "valid-token-123",
          newValue: null,
        })
      );
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
    expect(screen.getByTestId("wallet-address")).toHaveTextContent("no-wallet");
    expect(localStorage.getItem("stellarmarket_wallet_session")).toBeNull();
  });

  it("does NOT log in Tab B if Tab B was logged out and Tab A logs in", async () => {
    render(
      <WalletProvider>
        <AuthProvider>
          <SocketProvider>
            <TestApp />
          </SocketProvider>
        </AuthProvider>
      </WalletProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");

    await act(async () => {
      localStorage.setItem("stellarmarket_jwt", "new-token-tab-a");
      localStorage.setItem("stellarmarket_user", JSON.stringify(MOCK_USER));

      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "stellarmarket_jwt",
          oldValue: null,
          newValue: "new-token-tab-a",
        })
      );
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
  });

  it("handles in-flight request failures gracefully when token is cleared", async () => {
    localStorage.setItem("stellarmarket_jwt", "valid-token-123");
    localStorage.setItem("stellarmarket_user", JSON.stringify(MOCK_USER));

    mockAxiosGet.mockRejectedValue(new Error("401 Unauthorized"));

    render(
      <WalletProvider>
        <AuthProvider>
          <SocketProvider>
            <TestApp />
          </SocketProvider>
        </AuthProvider>
      </WalletProvider>
    );

    await act(async () => {
      localStorage.removeItem("stellarmarket_jwt");
    });

    expect(screen.getByTestId("auth-status")).toHaveTextContent("unauthenticated");
  });
});
