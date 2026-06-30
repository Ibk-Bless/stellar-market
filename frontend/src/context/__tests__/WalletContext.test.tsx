import "@testing-library/jest-dom";
import React from "react";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { WalletProvider, useWallet } from "../WalletContext";

const mockToastError = jest.fn();
jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    toast: {
      success: jest.fn(),
      error: mockToastError,
    },
  }),
}));

const mockRequestAccess = jest.fn();
const mockGetAddress = jest.fn();
const mockIsConnected = jest.fn();
const mockGetPublicKey = jest.fn();

jest.mock("@stellar/freighter-api", () => ({
  requestAccess: (...args: any[]) => mockRequestAccess(...args),
  getAddress: (...args: any[]) => mockGetAddress(...args),
  isConnected: (...args: any[]) => mockIsConnected(...args),
  getPublicKey: (...args: any[]) => mockGetPublicKey(...args),
}));

jest.mock("@stellar/stellar-sdk", () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: jest.fn().mockResolvedValue({ balances: [] }),
      })),
    },
    rpc: {
      Server: jest.fn(),
    },
    Transaction: jest.fn(),
  };
});

const FREIGHTER_WALLET_KEY = "stellar_wallet";
const SESSION_KEY = "stellarmarket_wallet_session";
const STORAGE_KEY = "stellarmarket_wallet_connected";
const WALLET_TYPE_KEY = "stellarmarket_wallet_type";

function TestConsumer() {
  const { error, connect, isConnecting, address, isReconnecting } = useWallet();
  return (
    <div>
      <button data-testid="connect-btn" onClick={() => connect("freighter")}>
        Connect
      </button>
      <div data-testid="error-state">{error || "NO_ERROR"}</div>
      <div data-testid="connecting-state">{isConnecting ? "connecting" : "idle"}</div>
      <div data-testid="address-state">{address || "NO_ADDRESS"}</div>
      <div data-testid="reconnecting-state">{isReconnecting ? "reconnecting" : "idle"}</div>
    </div>
  );
}

describe("WalletContext Freighter Connection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).freighter;
    localStorage.clear();
  });

  it("should timeout after 10 seconds if getPublicKey never resolves", async () => {
    jest.useFakeTimers();

    (window as any).freighter = {};
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: "GABC" });
    mockGetPublicKey.mockImplementation(() => new Promise(() => {}));

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    const btn = screen.getByTestId("connect-btn");
    
    // Trigger connection
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByTestId("connecting-state")).toHaveTextContent("connecting");

    // Advance Jest timers to trigger timeout
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    expect(screen.getByTestId("connecting-state")).toHaveTextContent("idle");
    expect(screen.getByTestId("error-state")).toHaveTextContent("TIMEOUT");
    expect(mockToastError).toHaveBeenCalledWith(
      "Wallet connection timed out. Make sure Freighter is unlocked and try again."
    );

    jest.useRealTimers();
  });

  it("should show install prompt if isConnected returns false", async () => {
    (window as any).freighter = {};
    mockIsConnected.mockResolvedValue({ isConnected: false });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    const btn = screen.getByTestId("connect-btn");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByTestId("connecting-state")).toHaveTextContent("idle");
    expect(screen.getByTestId("error-state")).toHaveTextContent("NOT_INSTALLED");
    expect(screen.getByText("Extension not found")).toBeInTheDocument();
  });
});

describe("WalletContext session restoration", () => {
  const STORED_ADDRESS = "GABC123STORED";

  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).freighter;
    localStorage.clear();
  });

  function seedStorage(address: string) {
    localStorage.setItem(STORAGE_KEY, "true");
    localStorage.setItem(WALLET_TYPE_KEY, "freighter");
    localStorage.setItem(FREIGHTER_WALLET_KEY, JSON.stringify({ walletAddress: address, connectedAt: Date.now() }));
    localStorage.setItem(SESSION_KEY, JSON.stringify({ address, connectedAt: Date.now(), lastActivityAt: Date.now() }));
  }

  it("restores wallet state silently when stored address matches Freighter", async () => {
    (window as any).freighter = {};
    seedStorage(STORED_ADDRESS);
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockGetAddress.mockResolvedValue({ address: STORED_ADDRESS });

    await act(async () => {
      render(
        <WalletProvider>
          <TestConsumer />
        </WalletProvider>
      );
    });

    expect(screen.getByTestId("address-state")).toHaveTextContent(STORED_ADDRESS);
    expect(screen.getByTestId("reconnecting-state")).toHaveTextContent("idle");
  });

  it("clears stored state when Freighter reports isConnected = false", async () => {
    (window as any).freighter = {};
    seedStorage(STORED_ADDRESS);
    mockIsConnected.mockResolvedValue({ isConnected: false });

    await act(async () => {
      render(
        <WalletProvider>
          <TestConsumer />
        </WalletProvider>
      );
    });

    expect(screen.getByTestId("address-state")).toHaveTextContent("NO_ADDRESS");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(FREIGHTER_WALLET_KEY)).toBeNull();
  });

  it("clears stored state when Freighter returns a different address (mismatch)", async () => {
    (window as any).freighter = {};
    seedStorage(STORED_ADDRESS);
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockGetAddress.mockResolvedValue({ address: "GDIFFERENT_ADDRESS" });

    await act(async () => {
      render(
        <WalletProvider>
          <TestConsumer />
        </WalletProvider>
      );
    });

    expect(screen.getByTestId("address-state")).toHaveTextContent("NO_ADDRESS");
    expect(localStorage.getItem(FREIGHTER_WALLET_KEY)).toBeNull();
  });
});
