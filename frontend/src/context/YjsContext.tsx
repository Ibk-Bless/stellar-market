"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/context/AuthContext";

// ─── Close code taxonomy (mirrors backend) ────────────────────────────────────
const CLOSE_INVALID_JWT = 4001;
const CLOSE_FORBIDDEN = 4003;
const CLOSE_JOB_NOT_FOUND = 4004;

// Close codes ≥ 4100 are unexpected and should trigger a reconnect.
const RETRYABLE_THRESHOLD = 4100;

// ─── Types ────────────────────────────────────────────────────────────────────

export type YjsErrorState =
  | { type: "forbidden" }
  | { type: "invalid_auth" }
  | { type: "job_not_found" }
  | { type: "connection_error"; message: string }
  | null;

interface YjsContextValue {
  /** Send a raw binary Yjs update for the current job room. */
  sendUpdate: (update: Uint8Array) => void;
  /** Incoming CRDT updates from peers. */
  updates: Uint8Array[];
  isConnected: boolean;
  error: YjsErrorState;
}

const YjsContext = createContext<YjsContextValue>({
  sendUpdate: () => undefined,
  updates: [],
  isConnected: false,
  error: null,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

const BACKEND_WS_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5000").replace(
    /^http/,
    "ws"
  );

interface YjsProviderProps {
  jobId: string;
  children: React.ReactNode;
}

export function YjsProvider({ jobId, children }: YjsProviderProps) {
  const { token } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [updates, setUpdates] = useState<Uint8Array[]>([]);
  const [error, setError] = useState<YjsErrorState>(null);
  // Track whether we should attempt reconnect
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(() => {
    if (!token || !jobId) return;
    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) return;

    const url = `${BACKEND_WS_URL}/yjs?job=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      setUpdates((prev) => [...prev, new Uint8Array(event.data)]);
    };

    ws.onerror = () => {
      setIsConnected(false);
      setError({ type: "connection_error", message: "WebSocket error" });
    };

    ws.onclose = (event: CloseEvent) => {
      setIsConnected(false);
      wsRef.current = null;

      // Map well-known close codes to error states — never reconnect on these.
      if (event.code === CLOSE_INVALID_JWT) {
        shouldReconnectRef.current = false;
        setError({ type: "invalid_auth" });
        return;
      }
      if (event.code === CLOSE_FORBIDDEN) {
        shouldReconnectRef.current = false;
        setError({ type: "forbidden" });
        return;
      }
      if (event.code === CLOSE_JOB_NOT_FOUND) {
        shouldReconnectRef.current = false;
        setError({ type: "job_not_found" });
        return;
      }

      // Only retry on unexpected close codes (≥ 4100) or normal network drops
      // (1001 Going Away, 1006 Abnormal, etc.)
      if (!shouldReconnectRef.current) return;
      if (event.code >= RETRYABLE_THRESHOLD || event.code < 4000) {
        const delay = 2000;
        setTimeout(() => {
          if (shouldReconnectRef.current) connect();
        }, delay);
      }
    };
  }, [token, jobId]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    setError(null);
    setUpdates([]);
    connect();

    return () => {
      shouldReconnectRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendUpdate = useCallback(
    (update: Uint8Array) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(update);
    },
    []
  );

  return (
    <YjsContext.Provider value={{ sendUpdate, updates, isConnected, error }}>
      {children}
    </YjsContext.Provider>
  );
}

export function useYjs(): YjsContextValue {
  return useContext(YjsContext);
}

// ─── AccessDenied error component ─────────────────────────────────────────────

export function YjsAccessDenied() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800"
    >
      <p className="font-semibold">Access denied</p>
      <p className="text-sm mt-1">
        You are not a party to this negotiation room and cannot access it.
      </p>
    </div>
  );
}
