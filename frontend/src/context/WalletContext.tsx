"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  isConnected as freighterIsConnected,
  getAddress,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { rpc, Transaction, Horizon } from "@stellar/stellar-sdk";
import { Loader2, QrCode, Wallet } from "lucide-react";

interface WalletBalance {
  asset: string;
  balance: string;
}

interface WalletSession {
  address: string;
  connectedAt: number;
  lastActivityAt: number;
}

interface WalletState {
  address: string | null;
  isConnecting: boolean;
  isFreighterInstalled: boolean | null;
  error: string | null;
  balance: string | null;
  balances: WalletBalance[];
  isLoadingBalance: boolean;
  walletType: "freighter" | "walletconnect" | null;
  connect: (provider?: "freighter" | "walletconnect") => Promise<string | null>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  signAndBroadcastTransaction: (
    xdr: string
  ) => Promise<{ hash: string; success: boolean; error?: string; resultXdr?: string }>;
  isSessionActive: boolean;
  sessionExpiresIn: number | null; // milliseconds until session expires
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  signAndBroadcastTransaction: (xdr: string) => Promise<{
    hash: string;
    success: boolean;
    error?: string;
    resultXdr?: string;
  }>;
  extendSession: () => void;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

const STORAGE_KEY = "stellarmarket_wallet_connected";
const WALLET_TYPE_KEY = "stellarmarket_wallet_type";
const SESSION_KEY = "stellarmarket_wallet_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_WARNING_MS = 5 * 60 * 1000; // Warn 5 minutes before expiry

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export { truncateAddress };

// Stellar Horizon server for fetching balances
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const horizonServer = new Horizon.Server(HORIZON_URL);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState<
    boolean | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [walletType, setWalletType] = useState<"freighter" | "walletconnect" | null>(null);
  const [showWalletSelect, setShowWalletSelect] = useState(false);
  const balanceRefreshInterval = useRef<NodeJS.Timeout | null>(null);
  const walletKitRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const pendingConnectResolve = useRef<((address: string | null) => void) | null>(null);

  const getWalletKit = useCallback(async () => {
    if (walletKitRef.current) return walletKitRef.current;
    const kitModule: any = await import("@creit.tech/stellar-wallets-kit"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const kit = new kitModule.StellarWalletsKit({
      network: kitModule.WalletNetwork.TESTNET,
      selectedWalletId: kitModule.WALLET_CONNECT_ID ?? "walletconnect",
      modules: [
        new kitModule.WalletConnectModule({
          url: typeof window !== "undefined" ? window.location.origin : "https://stellarmarket.app",
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "stellar-market-dev",
          name: "StellarMarket",
          description: "StellarMarket wallet connection",
          icons: [],
          method: kitModule.WalletConnectAllowedMethods?.SIGN,
        }),
      ],
    });
    walletKitRef.current = kit;
    return kit;
  }, []);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | null>(null);

  const balanceRefreshInterval = useRef<NodeJS.Timeout | null>(null);
  const sessionTimeoutId = useRef<NodeJS.Timeout | null>(null);
  const sessionWarningId = useRef<NodeJS.Timeout | null>(null);
  const sessionCheckInterval = useRef<NodeJS.Timeout | null>(null);

  const checkFreighterInstalled = useCallback(async () => {
    try {
      const result = await freighterIsConnected();
      if (result.error) {
        setIsFreighterInstalled(false);
        return false;
      }
      setIsFreighterInstalled(result.isConnected);
      return result.isConnected;
    } catch {
      setIsFreighterInstalled(false);
      return false;
    }
  }, []);

  // Session management functions
  const getStoredSession = useCallback((): WalletSession | null => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }, []);

  const saveSession = useCallback((addr: string) => {
    const session: WalletSession = {
      address: addr,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setIsSessionActive(true);
  }, []);

  const updateSessionActivity = useCallback(() => {
    const session = getStoredSession();
    if (session) {
      session.lastActivityAt = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setSessionExpiresIn(SESSION_TIMEOUT_MS);

      // Clear existing timeouts
      if (sessionTimeoutId.current) clearTimeout(sessionTimeoutId.current);
      if (sessionWarningId.current) clearTimeout(sessionWarningId.current);

      // Set warning timeout (5 minutes before expiry)
      sessionWarningId.current = setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("stellarmarket:sessionWarning", {
            detail: { expiresIn: SESSION_WARNING_MS },
          }),
        );
      }, SESSION_TIMEOUT_MS - SESSION_WARNING_MS);

      // Set expiry timeout
      sessionTimeoutId.current = setTimeout(() => {
        disconnect();
        window.dispatchEvent(new CustomEvent("stellarmarket:sessionExpired"));
      }, SESSION_TIMEOUT_MS);
    }
  }, [getStoredSession]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setIsSessionActive(false);
    setSessionExpiresIn(null);
    if (sessionTimeoutId.current) clearTimeout(sessionTimeoutId.current);
    if (sessionWarningId.current) clearTimeout(sessionWarningId.current);
    if (sessionCheckInterval.current)
      clearInterval(sessionCheckInterval.current);
  }, []);

  // Fetch wallet balance from Stellar Horizon
  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setBalances([]);
      return;
    }

    setIsLoadingBalance(true);
    try {
      // Fetch all balances from Horizon
      const account = await horizonServer.loadAccount(address);
      const allBalances: WalletBalance[] = account.balances.map((b) => {
        if (b.asset_type === "native") {
          return { asset: "XLM", balance: b.balance };
        }
        return {
          asset:
            b.asset_type === "credit_alphanum4" ||
            b.asset_type === "credit_alphanum12"
              ? `${b.asset_code}`
              : b.asset_type,
          balance: b.balance,
        };
      });

      // Sort XLM first, then by balance
      allBalances.sort((a, b) => {
        if (a.asset === "XLM") return -1;
        if (b.asset === "XLM") return 1;
        return parseFloat(b.balance) - parseFloat(a.balance);
      });

      setBalances(allBalances);

      // Set primary XLM balance (truncated to 2 decimal places)
      const xlmBalance = allBalances.find((b) => b.asset === "XLM");
      if (xlmBalance) {
        const truncated = parseFloat(xlmBalance.balance).toFixed(2);
        setBalance(truncated);
      }
    } catch (err) {
      console.error("Failed to fetch wallet balance:", err);
      // Don't clear existing balance on error - keep showing last known
    } finally {
      setIsLoadingBalance(false);
    }
  }, [address]);

  const restoreSession = useCallback(async () => {
    const wasConnected = localStorage.getItem(STORAGE_KEY);
    if (wasConnected !== "true") return;
    const storedWalletType = localStorage.getItem(WALLET_TYPE_KEY);
    if (storedWalletType === "walletconnect") {
      try {
        const kit = await getWalletKit();
        const result = await kit.getAddress();
        setAddress(result.address);
        setWalletType("walletconnect");
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
      }
      return;
    }

    const storedSession = getStoredSession();
    if (!storedSession) return;

    // Check if session has expired
    const sessionAge = Date.now() - storedSession.lastActivityAt;
    if (sessionAge > SESSION_TIMEOUT_MS) {
      clearSession();
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const installed = await checkFreighterInstalled();
    if (!installed) return;

    try {
      const result = await getAddress();
      if (result.error) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        return;
      }
      setAddress(result.address);
      setWalletType("freighter");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(WALLET_TYPE_KEY);
    }
  }, [checkFreighterInstalled, getWalletKit]);
        clearSession();
        return;
      }
      setAddress(result.address);
      setIsSessionActive(true);
      updateSessionActivity();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      clearSession();
    }
  }, [
    checkFreighterInstalled,
    getStoredSession,
    clearSession,
    updateSessionActivity,
  ]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Fetch balance when address changes and set up periodic refresh
  useEffect(() => {
    if (address) {
      refreshBalance();
      // Refresh balance every 30 seconds
      balanceRefreshInterval.current = setInterval(refreshBalance, 30000);
    } else {
      setBalance(null);
      setBalances([]);
    }

    return () => {
      if (balanceRefreshInterval.current) {
        clearInterval(balanceRefreshInterval.current);
      }
    };
  }, [address, refreshBalance]);

  // Listen for Freighter's accountChanged event and auto-update publicKey.
  // Freighter dispatches a custom DOM event when the user switches accounts.
  useEffect(() => {
    const handleAccountChanged = async () => {
      try {
        const result = await getAddress();
        if (result.error) {
          // Switched to an account that revoked access — treat as disconnect.
          setAddress(null);
          setError(null);
          setBalance(null);
          setBalances([]);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(WALLET_TYPE_KEY);
          localStorage.removeItem(WALLET_TYPE_KEY);
          clearSession();
        } else {
          setAddress(result.address);
          updateSessionActivity();
        }
      } catch {
        // Ignore transient errors during account switching.
      }
    };

    window.addEventListener("freighter#accountChanged", handleAccountChanged);
    return () => {
      window.removeEventListener(
        "freighter#accountChanged",
        handleAccountChanged,
      );
    };
  }, [clearSession, updateSessionActivity]);

  // Listen for wallet disconnect events (wallet locked, extension removed, etc.)
  useEffect(() => {
    const handleDisconnect = async () => {
      // Verify if wallet is actually disconnected
      try {
        const result = await freighterIsConnected();
        if (result.error || !result.isConnected) {
          // Wallet is disconnected - clear state
          setAddress(null);
          setError(null);
          setBalance(null);
          setBalances([]);
          localStorage.removeItem(STORAGE_KEY);
          clearSession();

          // Dispatch custom event for other components to react
          window.dispatchEvent(
            new CustomEvent("stellarmarket:walletDisconnected"),
          );
        }
      } catch {
        // Error checking connection - assume disconnected
        setAddress(null);
        setError(null);
        setBalance(null);
        setBalances([]);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
        clearSession();
        window.dispatchEvent(
          new CustomEvent("stellarmarket:walletDisconnected"),
        );
      }
    };

    // Listen for Freighter's disconnect event
    window.addEventListener("freighter#disconnected", handleDisconnect);

    // Also listen for visibility change to re-check connection
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && address) {
        // Re-verify connection when tab becomes visible
        handleDisconnect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("freighter#disconnected", handleDisconnect);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [address, clearSession]);

  const connectFreighter = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      // Detect not-installed: window.freighter is undefined before the SDK
      // even attempts a connection.
      if (
        typeof window !== "undefined" &&
        !(window as unknown as Record<string, unknown>).freighter
      ) {
        setError("NOT_INSTALLED");
        return null;
      }

      const installed = await checkFreighterInstalled();
      if (!installed) {
        setError("NOT_INSTALLED");
        return null;
      }

      const accessResult = await requestAccess();
      if (accessResult.error) {
        const msg =
          typeof accessResult.error === "string"
            ? accessResult.error
            : ((accessResult.error as { message?: string }).message ?? "");
        // Freighter returns a specific message when the wallet is locked
        if (
          msg.toLowerCase().includes("locked") ||
          msg.toLowerCase().includes("unlock")
        ) {
          setError("LOCKED");
        } else {
          setError(msg || "Failed to connect wallet");
        }
        return null;
      }

      const addressResult = await getAddress();
      if (addressResult.error) {
        const msg =
          typeof addressResult.error === "string"
            ? addressResult.error
            : ((addressResult.error as { message?: string }).message ?? "");
        setError(msg || "Failed to retrieve address");
        return null;
      }

      setAddress(addressResult.address);
      setWalletType("freighter");
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(WALLET_TYPE_KEY, "freighter");
      return addressResult.address;
      saveSession(addressResult.address);
      updateSessionActivity();
    } catch {
      setError("An unexpected error occurred while connecting the wallet");
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [checkFreighterInstalled, saveSession, updateSessionActivity]);

  const connectWalletConnect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      const kit = await getWalletKit();
      await kit.openModal({
        modalTitle: "Connect WalletConnect",
        notAvailableText: "WalletConnect is not available",
      });
      const result = await kit.getAddress();
      setAddress(result.address);
      setWalletType("walletconnect");
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(WALLET_TYPE_KEY, "walletconnect");
      return result.address;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "WalletConnect connection was rejected");
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [getWalletKit]);

  const connect = useCallback(async (provider?: "freighter" | "walletconnect") => {
    if (!provider) {
      setShowWalletSelect(true);
      return new Promise<string | null>((resolve) => {
        pendingConnectResolve.current = resolve;
      });
    }

    setShowWalletSelect(false);
    let connectedAddress: string | null;
    if (provider === "walletconnect") {
      connectedAddress = await connectWalletConnect();
    } else {
      connectedAddress = await connectFreighter();
    }
    pendingConnectResolve.current?.(connectedAddress);
    pendingConnectResolve.current = null;
    return connectedAddress;
  }, [connectFreighter, connectWalletConnect]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
    setBalance(null);
    setBalances([]);
    setWalletType(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WALLET_TYPE_KEY);
  }, []);
    clearSession();
    window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
  }, [clearSession]);

  const signMessage = useCallback(async (message: string) => {
    if (walletType === "walletconnect") {
      const kit = await getWalletKit();
      const result = await kit.signMessage(message);
      return result.signedMessage ?? result.signature ?? result;
    }

    const freighter = await import("@stellar/freighter-api");
    if (!("signMessage" in freighter)) {
      throw new Error("This Freighter version does not support message signing.");
    }
    const result = await (freighter as any).signMessage(message, { // eslint-disable-line @typescript-eslint/no-explicit-any
      address,
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    if (result.error) {
      throw new Error(typeof result.error === "string" ? result.error : result.error.message);
    }
    return result.signedMessage ?? result.signature;
  }, [getWalletKit, walletType]);

  const signAndBroadcastTransaction = useCallback(
    async (xdr: string) => {
      try {
        const signedResult = walletType === "walletconnect"
          ? await (await getWalletKit()).signTransaction(xdr, {
              networkPassphrase: "Test SDF Network ; September 2015",
              address,
            })
          : await signTransaction(xdr, {
              networkPassphrase: "Test SDF Network ; September 2015",
            });
        updateSessionActivity();

        const signedResult = await signTransaction(xdr, {
          networkPassphrase: "Test SDF Network ; September 2015",
        });

        if (signedResult.error) {
          return {
            success: false,
            hash: "",
            error: signedResult.error,
          };
        }

        const server = new rpc.Server("https://soroban-testnet.stellar.org");
        const tx = new Transaction(signedResult.signedTxXdr ?? signedResult.signedTxXdrPayload, "Test SDF Network ; September 2015");
        
        const tx = new Transaction(
          signedResult.signedTxXdr,
          "Test SDF Network ; September 2015",
        );

        const sendResponse = await server.sendTransaction(tx);

        if (sendResponse.status !== "PENDING") {
          return {
            success: false,
            hash: sendResponse.hash,
            error: "Transaction submission failed",
          };
        }

        // Poll for confirmation
        let statusResponse;
        let attempts = 0;
        while (attempts <= 10) {
          statusResponse = await server.getTransaction(sendResponse.hash);

          if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
            const successResponse =
              statusResponse as rpc.Api.GetSuccessfulTransactionResponse;
            return {
              success: true,
              hash: sendResponse.hash,
              resultXdr: successResponse.returnValue?.toXDR("base64"),
            };
          }

          if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
            return {
              success: false,
              hash: sendResponse.hash,
              error: "Transaction failed on-chain",
            };
          }

          // NOT_FOUND = still pending, keep polling
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        return {
          success: false,
          hash: sendResponse.hash,
          error: "Transaction timed out or failed to confirm",
        };
      } catch (err: unknown) {
        return {
          success: false,
          hash: "",
          error:
            err instanceof Error
              ? err.message
              : "An error occurred during transaction",
        };
      }
    },
    [address, getWalletKit, walletType]
    [updateSessionActivity],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      isConnecting,
      isFreighterInstalled,
      error,
      balance,
      balances,
      isLoadingBalance,
      walletType,
      isSessionActive,
      sessionExpiresIn,
      connect,
      disconnect,
      refreshBalance,
      signMessage,
      signAndBroadcastTransaction,
      extendSession: updateSessionActivity,
    }),
    [
      address,
      isConnecting,
      isFreighterInstalled,
      error,
      balance,
      balances,
      isLoadingBalance,
      walletType,
      isSessionActive,
      sessionExpiresIn,
      connect,
      disconnect,
      refreshBalance,
      signMessage,
      signAndBroadcastTransaction,
      updateSessionActivity,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {showWalletSelect && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Connect wallet</h2>
              <p className="text-sm text-theme-text">Choose how you want to connect.</p>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => connect("freighter")}
                disabled={isConnecting}
                className="w-full flex items-center justify-between rounded-lg border border-theme-border bg-theme-bg px-4 py-3 text-left text-theme-heading hover:border-stellar-blue disabled:opacity-60"
              >
                <span className="flex items-center gap-3"><Wallet size={18} /> Freighter</span>
                {isConnecting ? <Loader2 size={16} className="animate-spin" /> : null}
              </button>
              <button
                type="button"
                onClick={() => connect("walletconnect")}
                disabled={isConnecting}
                className="w-full flex items-center justify-between rounded-lg border border-theme-border bg-theme-bg px-4 py-3 text-left text-theme-heading hover:border-stellar-blue disabled:opacity-60"
              >
                <span className="flex items-center gap-3"><QrCode size={18} /> WalletConnect</span>
                {isConnecting ? <Loader2 size={16} className="animate-spin" /> : null}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                pendingConnectResolve.current?.(null);
                pendingConnectResolve.current = null;
                setShowWalletSelect(false);
              }}
              className="mt-4 w-full rounded-lg border border-theme-border px-4 py-2 text-sm text-theme-text hover:text-theme-heading"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
