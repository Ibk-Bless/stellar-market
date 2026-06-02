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
  signAndBroadcastTransaction: (
    xdr: string
  ) => Promise<{ hash: string; success: boolean; error?: string; resultXdr?: string }>;
  isSessionActive: boolean;
  sessionExpiresIn: number | null;
  extendSession: () => void;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

const STORAGE_KEY = "stellarmarket_wallet_connected";
const WALLET_TYPE_KEY = "stellarmarket_wallet_type";
const SESSION_KEY = "stellarmarket_wallet_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000;

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export { truncateAddress };

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const horizonServer = new Horizon.Server(HORIZON_URL);

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function WalletProvider({ children }: { children: React.ReactNode }) {
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
  const pendingDisconnectResolve = useRef<((confirmed: boolean) => void) | null>(null);
  const switchingToProvider = useRef<WalletProviderType | null>(null);

  const balanceRefreshInterval = useRef<NodeJS.Timeout | null>(null);
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
      saveSession(result.address);
      updateSessionActivity();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(WALLET_TYPE_KEY);
    }
  }, [checkFreighterInstalled, getWalletKit, getStoredSession, clearSession, saveSession, updateSessionActivity]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Fetch balance when address changes
  useEffect(() => {
    if (address) {
      refreshBalance();
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
      const accessResult = await requestAccess();
      if (accessResult.error) {
        const msg = typeof accessResult.error === "string"
          ? accessResult.error
          : ((accessResult.error as { message?: string }).message ?? "");
        if (msg.toLowerCase().includes("locked") || msg.toLowerCase().includes("unlock")) {
          setError("LOCKED");
        } else {
          setError(msg || "Failed to connect wallet");
        }
        return null;
      }
      const addressResult = await getAddress();
      if (addressResult.error) {
        const msg = typeof addressResult.error === "string"
          ? addressResult.error
          : ((addressResult.error as { message?: string }).message ?? "");
        setError(msg || "Failed to retrieve address");
        return null;
      }
      setAddress(addressResult.address);
      setWalletType("freighter");
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(WALLET_TYPE_KEY, "freighter");
      saveSession(addressResult.address);
      updateSessionActivity();
      return addressResult.address;
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
        const networkMismatch = account._baseUrl?.includes("horizon.stellar.org");
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

  const signAndBroadcastTransaction = useCallback(async (xdr: string) => {
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
      connect,
      disconnect,
      refreshBalance,
      signMessage,
      signAndBroadcastTransaction,
      extendSession: updateSessionActivity,
    }),
    [
      address, isConnecting, isFreighterInstalled, isLobstrInstalled, error,
      balance, balances, isLoadingBalance, walletType, isSessionActive, sessionExpiresIn,
      connect, disconnect, refreshBalance, signMessage, signAndBroadcastTransaction, updateSessionActivity,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}

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
