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
import { Loader2, QrCode, Wallet, Smartphone } from "lucide-react";
import { useToast } from "@/components/Toast";

export class FreighterTimeoutError extends Error {
  constructor() {
    super("Wallet connection timed out. Make sure Freighter is unlocked and try again.");
    this.name = "FreighterTimeoutError";
  }
}

async function getPublicKey(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const api = require("@stellar/freighter-api");
  if (api.getPublicKey) {
    const res = await api.getPublicKey();
    if (typeof res === "string") return res;
    if (res && res.address) return res.address;
    if (res && res.error) throw new Error(res.error);
    return res;
  }
  
  const result = await getAddress();
  if (result.error) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : (result.error as any).message || "Failed to retrieve address"
    );
  }
  return result.address;
}

interface WalletBalance {
  asset: string;
  balance: string;
}

interface WalletSession {
  address: string;
  connectedAt: number;
  lastActivityAt: number;
}

type WalletProviderType = "freighter" | "walletconnect" | "lobstr";

export type TxResolutionStatus = "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED";

export interface TxTrackingMeta {
  type: "DEPOSIT" | "RELEASE" | "REFUND" | "DISPUTE_PAYOUT";
  jobId?: string;
  milestoneId?: string;
}

interface WalletState {
  address: string | null;
  isConnecting: boolean;
  isFreighterInstalled: boolean | null;
  isLobstrInstalled: boolean | null;
  error: string | null;
  balance: string | null;
  balances: WalletBalance[];
  isLoadingBalance: boolean;
  walletType: WalletProviderType | null;
  connect: (provider?: WalletProviderType) => Promise<string | null>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  /**
   * Signs and broadcasts a Soroban transaction.
   *
   * When `meta` is supplied, the transaction is pre-registered with the
   * backend (`POST /transactions/pre-register`) and its terminal state is
   * resolved by polling the backend's `GET /transactions/:hash/status`
   * endpoint — the same DB-tracked source of truth used to detect ledger
   * expiry — instead of raw RPC polling. This is what allows `status` and
   * `canRetry` to be populated so callers can distinguish a transaction that
   * has permanently expired (safe to rebuild with a fresh sequence number and
   * resubmit) from one that is merely slow. Callers that omit `meta` keep the
   * legacy RPC-only polling behavior (no `status`/`canRetry`).
   */
  signAndBroadcastTransaction: (
    xdr: string,
    meta?: TxTrackingMeta
  ) => Promise<{
    hash: string;
    success: boolean;
    error?: string;
    resultXdr?: string;
    status?: TxResolutionStatus;
    canRetry?: boolean;
  }>;
  /**
   * Bind the currently-connected wallet address to the authenticated account
   * by completing a server-issued challenge / ed25519 signature round-trip.
   * Calls POST /auth/wallet/challenge, signs with Freighter/LOBSTR signMessage,
   * then calls POST /auth/wallet/verify. On success, updates the stored JWT
   * and returns { success: true, token }.
   */
  bindWallet: (authToken: string) => Promise<{ success: boolean; token?: string; error?: string }>;
  isSessionActive: boolean;
  sessionExpiresIn: number | null;
  extendSession: () => void;
  isReconnecting: boolean;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

const STORAGE_KEY = "stellarmarket_wallet_connected";
const WALLET_TYPE_KEY = "stellarmarket_wallet_type";
const SESSION_KEY = "stellarmarket_wallet_session";
const FREIGHTER_WALLET_KEY = "stellar_wallet";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000;

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export { truncateAddress };

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const horizonServer = new Horizon.Server(HORIZON_URL);
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_MAX_ATTEMPTS = 40; // ~2 minutes

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFreighterInstalled, setIsFreighterInstalled] = useState<boolean | null>(null);
  const [isLobstrInstalled, setIsLobstrInstalled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [walletType, setWalletType] = useState<WalletProviderType | null>(null);
  const [showWalletSelect, setShowWalletSelect] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const pendingConnectResolve = useRef<((address: string | null) => void) | null>(null);
  const pendingDisconnectResolve = useRef<((value: string | null) => void) | null>(null);
  const switchingToProvider = useRef<WalletProviderType | null>(null);

  const sessionTimeoutId = useRef<NodeJS.Timeout | null>(null);
  const sessionWarningId = useRef<NodeJS.Timeout | null>(null);
  const sessionCheckInterval = useRef<NodeJS.Timeout | null>(null);

  const walletKitRef = useRef<any>(null);

  const getWalletKit = useCallback(async () => {
    if (walletKitRef.current) return walletKitRef.current;
    const kitModule: any = await import("@creit.tech/stellar-wallets-kit");
    const modules: any[] = [];

    if (kitModule.WalletConnectModule) {
      modules.push(
        new kitModule.WalletConnectModule({
          url: typeof window !== "undefined" ? window.location.origin : "https://stellarmarket.app",
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "stellar-market-dev",
          name: "StellarMarket",
          description: "StellarMarket wallet connection",
          icons: [],
          method: kitModule.WalletConnectAllowedMethods?.SIGN,
        }),
      );
    }

    if (kitModule.LobstrModule) {
      modules.push(new kitModule.LobstrModule());
    }

    const kit = new kitModule.StellarWalletsKit({
      network: kitModule.WalletNetwork?.TESTNET ?? "testnet",
      selectedWalletId: kitModule.WALLET_CONNECT_ID ?? "walletconnect",
      modules,
    });
    walletKitRef.current = kit;
    return kit;
  }, []);

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

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

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setIsSessionActive(false);
    setSessionExpiresIn(null);
    if (sessionTimeoutId.current) clearTimeout(sessionTimeoutId.current);
    if (sessionWarningId.current) clearTimeout(sessionWarningId.current);
    if (sessionCheckInterval.current) clearInterval(sessionCheckInterval.current);
  }, []);

  const updateSessionActivity = useCallback(() => {
    const session = getStoredSession();
    if (session) {
      session.lastActivityAt = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setSessionExpiresIn(SESSION_TIMEOUT_MS);
      if (sessionTimeoutId.current) clearTimeout(sessionTimeoutId.current);
      if (sessionWarningId.current) clearTimeout(sessionWarningId.current);
      sessionWarningId.current = setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("stellarmarket:sessionWarning", {
            detail: { expiresIn: SESSION_WARNING_MS },
          }),
        );
      }, SESSION_TIMEOUT_MS - SESSION_WARNING_MS);
      sessionTimeoutId.current = setTimeout(() => {
        disconnect();
        window.dispatchEvent(new CustomEvent("stellarmarket:sessionExpired"));
      }, SESSION_TIMEOUT_MS);
    }
  }, [getStoredSession]);

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

  const checkLobstrInstalled = useCallback(async () => {
    try {
      const kit = await getWalletKit();
      await kit.setWallet("LOBSTR");
      setIsLobstrInstalled(true);
      return true;
    } catch {
      setIsLobstrInstalled(false);
      return false;
    }
  }, [getWalletKit]);

  // Refresh wallet balance from Stellar Horizon
  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setBalances([]);
      return;
    }
    setIsLoadingBalance(true);
    try {
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
      allBalances.sort((a, b) => {
        if (a.asset === "XLM") return -1;
        if (b.asset === "XLM") return 1;
        return parseFloat(b.balance) - parseFloat(a.balance);
      });
      setBalances(allBalances);
      const xlmBalance = allBalances.find((b) => b.asset === "XLM");
      if (xlmBalance) {
        setBalance(parseFloat(xlmBalance.balance).toFixed(2));
      }
    } catch {
      // Keep last known balance on error
    } finally {
      setIsLoadingBalance(false);
    }
  }, [address]);

  const restoreSession = useCallback(async () => {
    const wasConnected = localStorage.getItem(STORAGE_KEY);
    if (wasConnected !== "true") return;

    const storedWalletType = localStorage.getItem(WALLET_TYPE_KEY) as WalletProviderType | null;

    if (storedWalletType === "walletconnect") {
      try {
        const kit = await getWalletKit();
        const result = await kit.getAddress();
        setAddress(result.address);
        setWalletType("walletconnect");
        saveSession(result.address);
        updateSessionActivity();
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
      }
      return;
    }

    if (storedWalletType === "lobstr") {
      try {
        const kit = await getWalletKit();
        await kit.setWallet("LOBSTR");
        const result = await kit.getAddress();
        setAddress(result.address);
        setWalletType("lobstr");
        saveSession(result.address);
        updateSessionActivity();
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
      }
      return;
    }

    const storedSession = getStoredSession();
    if (!storedSession) return;

    const sessionAge = Date.now() - storedSession.lastActivityAt;
    if (sessionAge > SESSION_TIMEOUT_MS) {
      clearSession();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(FREIGHTER_WALLET_KEY);
      return;
    }

    const installed = await checkFreighterInstalled();
    if (!installed) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(FREIGHTER_WALLET_KEY);
      clearSession();
      return;
    }

    setIsReconnecting(true);
    try {
      const connectedResult = await freighterIsConnected();
      if (connectedResult.error || !connectedResult.isConnected) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        localStorage.removeItem(FREIGHTER_WALLET_KEY);
        clearSession();
        return;
      }

      const result = await getAddress();
      if (result.error) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        localStorage.removeItem(FREIGHTER_WALLET_KEY);
        clearSession();
        return;
      }

      const storedFreighterWallet = (() => {
        try {
          const raw = localStorage.getItem(FREIGHTER_WALLET_KEY);
          return raw ? (JSON.parse(raw) as { walletAddress: string; connectedAt: number }) : null;
        } catch {
          return null;
        }
      })();

      if (storedFreighterWallet && storedFreighterWallet.walletAddress !== result.address) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        localStorage.removeItem(FREIGHTER_WALLET_KEY);
        clearSession();
        return;
      }

      setAddress(result.address);
      setWalletType("freighter");
      saveSession(result.address);
      updateSessionActivity();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(WALLET_TYPE_KEY);
      localStorage.removeItem(FREIGHTER_WALLET_KEY);
      clearSession();
    } finally {
      setIsReconnecting(false);
    }
  }, [checkFreighterInstalled, getWalletKit, getStoredSession, clearSession, saveSession, updateSessionActivity]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Fetch balance when the connected address changes. We intentionally avoid a
  // fixed polling interval here (which fired even when the tab was idle and was
  // the source of redundant Horizon calls); the header balance is kept fresh by
  // the cached useWalletBalance hook (30s stale-time + refetch-on-focus), and
  // other consumers refresh explicitly via refreshBalance after transactions.
  useEffect(() => {
    if (address) {
      refreshBalance();
    } else {
      setBalance(null);
      setBalances([]);
    }
  }, [address, refreshBalance]);

  // Listen for Freighter account changes
  useEffect(() => {
    const handleAccountChanged = async () => {
      try {
        const result = await getAddress();
        if (result.error) {
          setAddress(null);
          setError(null);
          setBalance(null);
          setBalances([]);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(WALLET_TYPE_KEY);
          clearSession();
        } else {
          setAddress(result.address);
          updateSessionActivity();
        }
      } catch {
        // Ignore transient errors
      }
    };
    window.addEventListener("freighter#accountChanged", handleAccountChanged);
    return () => {
      window.removeEventListener("freighter#accountChanged", handleAccountChanged);
    };
  }, [clearSession, updateSessionActivity]);

  // Listen for wallet disconnect events
  useEffect(() => {
    const handleDisconnect = async () => {
      if (walletType !== "freighter") return;
      try {
        const result = await freighterIsConnected();
        if (result.error || !result.isConnected) {
          setAddress(null);
          setError(null);
          setBalance(null);
          setBalances([]);
          localStorage.removeItem(STORAGE_KEY);
          clearSession();
          window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
        }
      } catch {
        setAddress(null);
        setError(null);
        setBalance(null);
        setBalances([]);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(WALLET_TYPE_KEY);
        window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
        clearSession();
      }
    };

    window.addEventListener("freighter#disconnected", handleDisconnect);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && address && walletType === "freighter") {
        handleDisconnect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("freighter#disconnected", handleDisconnect);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [address, walletType, clearSession]);

  const connectFreighter = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new FreighterTimeoutError()), 10000)
      );

      const pubKeyPromise = (async () => {
        const accessResult = await requestAccess();
        if (accessResult.error) {
          throw new Error(
            typeof accessResult.error === "string"
              ? accessResult.error
              : ((accessResult.error as { message?: string }).message ?? "")
          );
        }
        return await getPublicKey();
      })();

      const addressResult = await Promise.race([
        pubKeyPromise,
        timeoutPromise,
      ]);

      setAddress(addressResult);
      setWalletType("freighter");
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(WALLET_TYPE_KEY, "freighter");
      localStorage.setItem(FREIGHTER_WALLET_KEY, JSON.stringify({ walletAddress: addressResult, connectedAt: Date.now() }));
      saveSession(addressResult);
      updateSessionActivity();
      return addressResult;
    } catch (err: unknown) {
      if (err instanceof FreighterTimeoutError) {
        setError("TIMEOUT");
        toast.error("Wallet connection timed out. Make sure Freighter is unlocked and try again.");
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.toLowerCase().includes("locked") || errMsg.toLowerCase().includes("unlock")) {
          setError("LOCKED");
        } else {
          setError(errMsg || "An unexpected error occurred while connecting the wallet");
        }
      }
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [checkFreighterInstalled, saveSession, updateSessionActivity, toast]);

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
      saveSession(result.address);
      updateSessionActivity();
      return result.address;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "WalletConnect connection was rejected");
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [getWalletKit, saveSession, updateSessionActivity]);

  const connectLOBSTR = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
      const kit = await getWalletKit();
      await kit.setWallet("LOBSTR");
      const result = await kit.getAddress();
      const lobstrAddress = result.address;

      // Verify testnet connection
      try {
        const account = await horizonServer.loadAccount(lobstrAddress);
        const networkMismatch = (account as any)._baseUrl?.includes("horizon.stellar.org");
        if (networkMismatch) {
          setError("NETWORK_MISMATCH");
          return null;
        }
      } catch {
        // Account fetch failure may mean testnet account doesn't exist yet
      }

      setAddress(lobstrAddress);
      setWalletType("lobstr");
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(WALLET_TYPE_KEY, "lobstr");
      saveSession(lobstrAddress);
      updateSessionActivity();
      return lobstrAddress;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not installed") || msg.includes("not found") || msg.includes("LOBSTR")) {
        setIsLobstrInstalled(false);
        setError("NOT_INSTALLED");
      } else if (msg.includes("network") || msg.includes("Network")) {
        setError("NETWORK_MISMATCH");
      } else {
        setError("Failed to connect LOBSTR wallet");
      }
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [getWalletKit, saveSession, updateSessionActivity]);

  const handleProviderSwitch = useCallback(async (targetProvider: WalletProviderType) => {
    if (address && walletType && walletType !== targetProvider) {
      switchingToProvider.current = targetProvider;
      setShowDisconnectConfirm(true);
      return new Promise<string | null>((resolve) => {
        pendingDisconnectResolve.current = resolve;
      });
    }
    return null;
  }, [address, walletType]);

  const connect = useCallback(async (provider?: WalletProviderType) => {
    if (!provider) {
      if (address) {
        setShowDisconnectConfirm(true);
        return new Promise<string | null>((resolve) => {
          pendingDisconnectResolve.current = resolve;
        });
      }
      setShowWalletSelect(true);
      return new Promise<string | null>((resolve) => {
        pendingConnectResolve.current = resolve;
      });
    }

    const switchResult = await handleProviderSwitch(provider);
    if (switchResult !== null) {
      // User cancelled or handled the switch elsewhere
      pendingDisconnectResolve.current = null;
      switchingToProvider.current = null;
      return switchResult;
    }

    setShowWalletSelect(false);
    let connectedAddress: string | null;
    switch (provider) {
      case "walletconnect":
        connectedAddress = await connectWalletConnect();
        break;
      case "lobstr":
        connectedAddress = await connectLOBSTR();
        break;
      default:
        connectedAddress = await connectFreighter();
    }
    pendingConnectResolve.current?.(connectedAddress);
    pendingConnectResolve.current = null;
    return connectedAddress;
  }, [connectFreighter, connectWalletConnect, connectLOBSTR, handleProviderSwitch, address]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
    setBalance(null);
    setBalances([]);
    setWalletType(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WALLET_TYPE_KEY);
    localStorage.removeItem(FREIGHTER_WALLET_KEY);
    clearSession();
    window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
  }, [clearSession]);

  const handleDisconnectConfirm = useCallback(async (confirmed: boolean) => {
    setShowDisconnectConfirm(false);
    if (confirmed) {
      disconnect();
    }
    pendingDisconnectResolve.current?.(confirmed ? null : null);
    pendingDisconnectResolve.current = null;

    const targetProvider = switchingToProvider.current;
    switchingToProvider.current = null;
    if (confirmed && targetProvider) {
      await connect(targetProvider);
    }
  }, [disconnect, connect]);

  const signMessage = useCallback(async (message: string) => {
    if (walletType === "walletconnect" || walletType === "lobstr") {
      const kit = await getWalletKit();
      const result = await kit.signMessage(message);
      return result.signedMessage ?? result.signature ?? result;
    }

    const freighter = await import("@stellar/freighter-api");
    if (!("signMessage" in freighter)) {
      throw new Error("This Freighter version does not support message signing.");
    }
    const result = await (freighter as any).signMessage(message, {
      address,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    if (result.error) {
      throw new Error(typeof result.error === "string" ? result.error : result.error.message);
    }
    return result.signedMessage ?? result.signature;
  }, [getWalletKit, walletType, address]);

  const bindWallet = useCallback(async (authToken: string) => {
    if (!address) {
      return { success: false, error: "No wallet connected. Connect a wallet first." };
    }
    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
    try {
      // Step 1 — fetch a one-time challenge from the server
      const challengeRes = await fetch(`${API}/auth/wallet/challenge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!challengeRes.ok) {
        const body = await challengeRes.json().catch(() => ({}));
        return { success: false, error: body.error ?? "Failed to fetch challenge" };
      }
      const { challenge } = await challengeRes.json() as { challenge: string };

      // Step 2 — sign the challenge with the wallet's private key
      // Freighter's signMessage signs raw UTF-8 bytes (ed25519).
      // LOBSTR via StellarWalletsKit also exposes signMessage with the same
      // semantics.  Both return a base64-encoded ed25519 signature.
      const signature = await signMessage(challenge);

      // Step 3 — submit address + signature for server-side verification
      const verifyRes = await fetch(`${API}/auth/wallet/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ address, signature }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        return { success: false, error: body.error ?? "Wallet verification failed" };
      }
      const { token } = await verifyRes.json() as { token: string };
      return { success: true, token };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Wallet binding failed",
      };
    }
  }, [address, signMessage]);

  const signAndBroadcastTransaction = useCallback(async (xdr: string, meta?: TxTrackingMeta) => {
    try {
      let signedResult: any;

      if (walletType === "walletconnect" || walletType === "lobstr") {
        const kit = await getWalletKit();
        signedResult = await kit.signTransaction(xdr, {
          networkPassphrase: TESTNET_PASSPHRASE,
          address,
        });
      } else {
        signedResult = await signTransaction(xdr, {
          networkPassphrase: TESTNET_PASSPHRASE,
        });
      }

      updateSessionActivity();

      if (signedResult.error) {
        return { success: false, hash: "", error: signedResult.error };
      }

      const signedTxXdr = signedResult.signedTxXdr ?? signedResult.signedTxXdrPayload;
      if (!signedTxXdr) {
        return { success: false, hash: "", error: "No signed transaction returned" };
      }

      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const tx = new Transaction(signedTxXdr, TESTNET_PASSPHRASE);
      const sendResponse = await server.sendTransaction(tx);

      if (sendResponse.status !== "PENDING") {
        return { success: false, hash: sendResponse.hash, error: "Transaction submission failed" };
      }

      if (!meta) {
        // Legacy path — raw RPC polling only, preserved for callers that
        // don't yet track transactions with the backend.
        let attempts = 0;
        while (attempts <= 10) {
          const statusResponse = await server.getTransaction(sendResponse.hash);
          if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
            const successResponse = statusResponse as rpc.Api.GetSuccessfulTransactionResponse;
            return { success: true, hash: sendResponse.hash, resultXdr: successResponse.returnValue?.toXDR("base64") };
          }
          if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
            return { success: false, hash: sendResponse.hash, error: "Transaction failed on-chain" };
          }
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        return { success: false, hash: sendResponse.hash, error: "Transaction timed out" };
      }

      // Tracked path — pre-register with the backend, then let the backend's
      // DB-tracked status endpoint (the same one that detects ledger expiry)
      // be the single source of truth for the terminal state, instead of
      // maintaining a second, independent RPC-only status vocabulary here.
      const maxTime = tx.timeBounds?.maxTime;
      const maxLedger = maxTime ? parseInt(String(maxTime), 10) : undefined;
      const token = localStorage.getItem("token") ?? localStorage.getItem("stellarmarket_jwt");

      try {
        await fetch(`${API_URL}/transactions/pre-register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            txHash: sendResponse.hash,
            type: meta.type,
            jobId: meta.jobId,
            milestoneId: meta.milestoneId,
            maxLedger: maxLedger && !isNaN(maxLedger) ? maxLedger : undefined,
          }),
        });
      } catch {
        // Pre-registration is best-effort — if it fails we still poll below;
        // the endpoint will 404 until the record exists, which is treated the
        // same as a still-pending transaction.
      }

      let attempts = 0;
      while (attempts < STATUS_POLL_MAX_ATTEMPTS) {
        try {
          const statusRes = await fetch(`${API_URL}/transactions/${sendResponse.hash}/status`);
          if (statusRes.ok) {
            const data: { status: TxResolutionStatus; canRetry?: boolean } = await statusRes.json();

            if (data.status === "SUCCESS") {
              const successResponse = await server.getTransaction(sendResponse.hash);
              const resultXdr =
                successResponse.status === rpc.Api.GetTransactionStatus.SUCCESS
                  ? (successResponse as rpc.Api.GetSuccessfulTransactionResponse).returnValue?.toXDR("base64")
                  : undefined;
              return { success: true, hash: sendResponse.hash, status: "SUCCESS" as const, resultXdr };
            }

            if (data.status === "FAILED") {
              return {
                success: false,
                hash: sendResponse.hash,
                status: "FAILED" as const,
                canRetry: false,
                error: "Transaction failed on-chain.",
              };
            }

            if (data.status === "EXPIRED") {
              return {
                success: false,
                hash: sendResponse.hash,
                status: "EXPIRED" as const,
                canRetry: true,
                error: "Transaction expired before confirmation and can no longer be included. It can be retried with a fresh sequence number.",
              };
            }
          }
        } catch {
          // Transient network error — keep polling.
        }
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
      }

      return {
        success: false,
        hash: sendResponse.hash,
        status: "PENDING" as const,
        canRetry: false,
        error: "Still processing on-chain — this is taking longer than usual. Check back in a moment.",
      };
    } catch (err: unknown) {
      return {
        success: false,
        hash: "",
        error: err instanceof Error ? err.message : "An error occurred during transaction",
      };
    }
  }, [address, getWalletKit, walletType, updateSessionActivity]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      isConnecting,
      isFreighterInstalled,
      isLobstrInstalled,
      error,
      balance,
      balances,
      isLoadingBalance,
      walletType,
      isSessionActive,
      sessionExpiresIn,
      isReconnecting,
      connect,
      disconnect,
      refreshBalance,
      signMessage,
      bindWallet,
      signAndBroadcastTransaction,
      extendSession: updateSessionActivity,
    }),
    [
      address, isConnecting, isFreighterInstalled, isLobstrInstalled, error,
      balance, balances, isLoadingBalance, walletType, isSessionActive, sessionExpiresIn,
      isReconnecting,
      connect, disconnect, refreshBalance, signMessage, bindWallet, signAndBroadcastTransaction,
      updateSessionActivity,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}

      {/* Reconnecting wallet banner */}
      {isReconnecting && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[130] flex items-center gap-2 rounded-lg border border-theme-border bg-theme-card px-4 py-2 text-sm text-theme-text shadow-lg">
          <Loader2 size={14} className="animate-spin" />
          Reconnecting wallet&hellip;
        </div>
      )}

      {/* Wallet selection modal */}
      {showWalletSelect && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Connect wallet</h2>
              <p className="text-sm text-theme-text">Choose how you want to connect.</p>
            </div>
            <div className="space-y-3">
              <WalletOptionButton
                icon={<Wallet size={18} />}
                label="Freighter"
                isInstalled={isFreighterInstalled}
                isConnecting={isConnecting}
                onClick={() => connect("freighter")}
                installUrl="https://freighter.app"
              />
              <WalletOptionButton
                icon={<Smartphone size={18} />}
                label="LOBSTR"
                isInstalled={isLobstrInstalled}
                isConnecting={isConnecting}
                onClick={() => connect("lobstr")}
                installUrl="https://lobstr.co"
              />
              <WalletOptionButton
                icon={<QrCode size={18} />}
                label="WalletConnect"
                isInstalled={null}
                isConnecting={isConnecting}
                onClick={() => connect("walletconnect")}
                installUrl={null}
              />
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

      {/* Disconnect confirmation modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Disconnect wallet?</h2>
              <p className="text-sm text-theme-text mt-1">
                Switching wallets will disconnect your current wallet. Continue?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleDisconnectConfirm(false)}
                className="flex-1 rounded-lg border border-theme-border px-4 py-2 text-sm text-theme-text hover:text-theme-heading"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDisconnectConfirm(true)}
                className="flex-1 rounded-lg bg-stellar-blue px-4 py-2 text-sm text-white hover:bg-stellar-blue/90"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Network mismatch error */}
      {error === "NETWORK_MISMATCH" && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Network mismatch</h2>
              <p className="text-sm text-theme-text mt-1">
                Your wallet is set to Mainnet. Please switch to Testnet in your wallet settings and try again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="w-full rounded-lg bg-stellar-blue px-4 py-2 text-sm text-white hover:bg-stellar-blue/90"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Install prompt overlay */}
      {error === "NOT_INSTALLED" && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Extension not found</h2>
              <p className="text-sm text-theme-text mt-1">
                {isFreighterInstalled === false && walletType !== "lobstr"
                  ? "Freighter extension is not installed. Please install it to continue."
                  : "LOBSTR extension is not installed. Please install it to continue."}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setError(null)}
                className="flex-1 rounded-lg border border-theme-border px-4 py-2 text-sm text-theme-text hover:text-theme-heading"
              >
                Cancel
              </button>
              <a
                href={walletType === "lobstr" ? "https://lobstr.co" : "https://freighter.app"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-lg bg-stellar-blue px-4 py-2 text-sm text-white hover:bg-stellar-blue/90 text-center"
              >
                Install
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Locked wallet error */}
      {error === "LOCKED" && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Wallet locked</h2>
              <p className="text-sm text-theme-text mt-1">
                Please unlock your Freighter wallet and try again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="w-full rounded-lg bg-stellar-blue px-4 py-2 text-sm text-white hover:bg-stellar-blue/90"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Timeout wallet error */}
      {error === "TIMEOUT" && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-theme-border bg-theme-card p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-theme-heading">Connection timed out</h2>
              <p className="text-sm text-theme-text mt-1">
                Wallet connection timed out. Make sure Freighter is unlocked and try again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="w-full rounded-lg bg-stellar-blue px-4 py-2 text-sm text-white hover:bg-stellar-blue/90"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
}

function WalletOptionButton({
  icon,
  label,
  isInstalled,
  isConnecting,
  onClick,
  installUrl,
}: {
  icon: React.ReactNode;
  label: string;
  isInstalled: boolean | null;
  isConnecting: boolean;
  onClick: () => void;
  installUrl: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isConnecting}
      className="w-full flex items-center justify-between rounded-lg border border-theme-border bg-theme-bg px-4 py-3 text-left text-theme-heading hover:border-stellar-blue disabled:opacity-60"
    >
      <span className="flex items-center gap-3">{icon} {label}</span>
      <span className="flex items-center gap-2">
        {isConnecting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : isInstalled === false && installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-stellar-blue hover:underline"
          >
            Install
          </a>
        ) : null}
      </span>
    </button>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
