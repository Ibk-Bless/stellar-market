import "@testing-library/jest-dom";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Single shared loadAccount mock so we can count Horizon calls across mounts.
const mockLoadAccount = jest.fn();
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: (...args: unknown[]) => mockLoadAccount(...args),
    })),
  },
}));

// Imported after the mock so the module-level Horizon.Server uses it.
import { useWalletBalance } from "@/hooks/useWalletBalance";

const ADDRESS = "GTESTADDRESS";

const accountFixture = {
  balances: [
    { asset_type: "native", balance: "100.5000000" },
    { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "42.0000000" },
  ],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadAccount.mockResolvedValue(accountFixture);
});

describe("useWalletBalance", () => {
  it("loads and normalizes balances (XLM first)", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useWalletBalance(ADDRESS), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.balances[0]).toEqual({ asset: "XLM", balance: "100.5000000" });
    expect(result.current.balances[1]).toEqual({ asset: "USDC", balance: "42.0000000" });
    expect(result.current.error).toBeNull();
  });

  it("serves from cache on a second mount within the 30s stale window (no extra Horizon call)", async () => {
    // A shared client preserves the cache across the two mounts, mimicking the
    // same session navigating back to the dashboard.
    const client = new QueryClient();

    const first = renderHook(() => useWalletBalance(ADDRESS), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    first.unmount();

    // Remount within the stale window: data is served from cache immediately.
    const second = renderHook(() => useWalletBalance(ADDRESS), { wrapper: makeWrapper(client) });
    expect(second.result.current.isLoading).toBe(false);
    expect(second.result.current.balances[0].asset).toBe("XLM");
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when address is null", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useWalletBalance(null), { wrapper: makeWrapper(client) });

    expect(result.current.balances).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it("refetches in the background on refresh() while keeping the cached value visible", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useWalletBalance(ADDRESS), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    // Cached data stayed visible throughout; a fresh Horizon call was made.
    expect(result.current.balances[0].asset).toBe("XLM");
    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
  });
});
