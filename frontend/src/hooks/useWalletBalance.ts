"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

// Balances are considered fresh for 30s. Within this window remounts and
// window-focus events are served from the TanStack Query cache instead of
// hitting Horizon again, capping calls at ~once per 30s per session.
export const WALLET_BALANCE_STALE_TIME_MS = 30_000;

export interface WalletBalance {
  asset: string;
  balance: string;
}

export interface UseWalletBalanceResult {
  balances: WalletBalance[];
  /** True only on the very first load when there is no cached data to show. */
  isLoading: boolean;
  /** True whenever a request is in flight, including background refreshes. */
  isFetching: boolean;
  /** True for background refreshes while cached data is already displayed. */
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const horizonServer = new Horizon.Server(HORIZON_URL);

async function fetchBalances(address: string): Promise<WalletBalance[]> {
  const account = await horizonServer.loadAccount(address);

  const all: WalletBalance[] = account.balances.map((b) => {
    if (b.asset_type === "native") {
      return { asset: "XLM", balance: b.balance };
    }
    return {
      asset:
        b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12"
          ? b.asset_code ?? b.asset_type
          : b.asset_type,
      balance: b.balance,
    };
  });

  all.sort((a, b) => {
    if (a.asset === "XLM") return -1;
    if (b.asset === "XLM") return 1;
    return parseFloat(b.balance) - parseFloat(a.balance);
  });

  return all;
}

/**
 * Fetches XLM + custom asset balances from Horizon for a given wallet address.
 *
 * Backed by TanStack Query so the value is cached per-address with a 30s
 * stale-time: remounts within the window reuse the cache (showing the stale
 * value immediately), window-focus triggers a background refresh only once the
 * data is older than 30s, and `isRefreshing` lets the UI show a subtle
 * refresh indicator without flashing a full loading state.
 */
export function useWalletBalance(address: string | null): UseWalletBalanceResult {
  const query = useQuery({
    queryKey: ["walletBalance", address],
    queryFn: () => fetchBalances(address as string),
    enabled: !!address,
    staleTime: WALLET_BALANCE_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    // Keep showing the previous address' balance while a new one loads rather
    // than flashing empty, and retain cached data on background refresh errors.
    placeholderData: (prev) => prev,
  });

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    balances: query.data ?? [],
    isLoading: query.isLoading && !!address,
    isFetching: query.isFetching,
    // A refresh is a fetch that happens while we already have data to show.
    isRefreshing: query.isFetching && query.data !== undefined,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
