"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ChatMessage } from "@/components/chat/ChatWindow";

const ACK_TIMEOUT_MS = 8000;
const OUTBOX_STORAGE_PREFIX = "stellar_chat_outbox:";

export type MessageStatus = "sending" | "sent" | "failed" | "queued";

export interface OutgoingMessage extends ChatMessage {
  clientId: string;
  status: MessageStatus;
}

interface SendMessageAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
}

interface QueuedPayload {
  clientId: string;
  receiverId: string;
  content: string;
  createdAt: string;
}

function outboxKey(currentUserId: string, partnerId: string): string {
  return `${OUTBOX_STORAGE_PREFIX}${currentUserId}:${partnerId}`;
}

function loadQueue(currentUserId: string, partnerId: string): QueuedPayload[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(outboxKey(currentUserId, partnerId));
    return raw ? (JSON.parse(raw) as QueuedPayload[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(currentUserId: string, partnerId: string, queue: QueuedPayload[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(outboxKey(currentUserId, partnerId), JSON.stringify(queue));
  } catch {
    // Storage unavailable (private browsing, quota) — outbox just won't survive a reload.
  }
}

function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface UseChatOutboxOptions {
  socket: Socket | null;
  isConnected: boolean;
  currentUserId: string;
  partnerId: string;
  currentUser: { id: string; username: string; avatarUrl: string | null };
  onServerMessage: (message: ChatMessage, clientId?: string) => void;
}

export function useChatOutbox({
  socket,
  isConnected,
  currentUserId,
  partnerId,
  currentUser,
  onServerMessage,
}: UseChatOutboxOptions) {
  const [pendingByClientId, setPendingByClientId] = useState<Record<string, OutgoingMessage>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // clientIds currently in flight over the socket, so a reconnect-flush that
  // fires twice in quick succession can't emit the same send twice.
  const inFlightRef = useRef<Set<string>>(new Set());

  // Conversations are keyed by (currentUserId, partnerId). Reset in-memory
  // pending state when either changes so stale "sending"/"failed" bubbles
  // from a previous conversation can't leak into this one, and so retry()
  // can never be called against a message that belongs elsewhere.
  useEffect(() => {
    Object.values(timersRef.current).forEach(clearTimeout);
    timersRef.current = {};
    inFlightRef.current.clear();
    setPendingByClientId({});
  }, [currentUserId, partnerId]);

  const clearTimer = useCallback((clientId: string) => {
    const timer = timersRef.current[clientId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[clientId];
    }
  }, []);

  const dequeue = useCallback(
    (clientId: string) => {
      const queue = loadQueue(currentUserId, partnerId).filter((q) => q.clientId !== clientId);
      saveQueue(currentUserId, partnerId, queue);
    },
    [currentUserId, partnerId]
  );

  const enqueue = useCallback(
    (payload: QueuedPayload) => {
      const queue = loadQueue(currentUserId, partnerId);
      if (queue.some((q) => q.clientId === payload.clientId)) return;
      saveQueue(currentUserId, partnerId, [...queue, payload]);
    },
    [currentUserId, partnerId]
  );

  const sendOverSocket = useCallback(
    (clientId: string, receiverId: string, content: string) => {
      if (!socket) return;
      if (inFlightRef.current.has(clientId)) return;
      inFlightRef.current.add(clientId);

      clearTimer(clientId);

      const timer = setTimeout(() => {
        inFlightRef.current.delete(clientId);
        setPendingByClientId((prev) => {
          if (!prev[clientId] || prev[clientId].status !== "sending") return prev;
          return { ...prev, [clientId]: { ...prev[clientId], status: "failed" } };
        });
      }, ACK_TIMEOUT_MS);
      timersRef.current[clientId] = timer;

      socket.emit(
        "send_message",
        { receiverId, content, clientId },
        (ack?: SendMessageAck) => {
          clearTimer(clientId);
          inFlightRef.current.delete(clientId);

          if (ack?.ok && ack.message) {
            dequeue(clientId);
            onServerMessage(ack.message, clientId);
            setPendingByClientId((prev) => {
              const next = { ...prev };
              delete next[clientId];
              return next;
            });
            return;
          }

          setPendingByClientId((prev) => {
            if (!prev[clientId]) return prev;
            return { ...prev, [clientId]: { ...prev[clientId], status: "failed" } };
          });
        }
      );
    },
    [socket, clearTimer, dequeue, onServerMessage]
  );

  const send = useCallback(
    (content: string) => {
      const clientId = makeClientId();
      const createdAt = new Date().toISOString();

      const optimistic: OutgoingMessage = {
        id: clientId,
        clientId,
        senderId: currentUserId,
        receiverId: partnerId,
        content,
        read: false,
        createdAt,
        sender: currentUser,
        status: isConnected ? "sending" : "queued",
      };

      setPendingByClientId((prev) => ({ ...prev, [clientId]: optimistic }));

      if (!isConnected || !socket) {
        enqueue({ clientId, receiverId: partnerId, content, createdAt });
        return optimistic;
      }

      sendOverSocket(clientId, partnerId, content);
      return optimistic;
    },
    [currentUserId, partnerId, currentUser, isConnected, socket, enqueue, sendOverSocket]
  );

  // Reconcile a pending message against an incoming `new_message` broadcast.
  // This covers the case where the send actually landed server-side but the
  // ack packet itself was dropped: the pending bubble would otherwise sit at
  // "sending" until the ack-timeout flips it to "failed" even though the
  // message was delivered.
  const reconcileFromBroadcast = useCallback(
    (msg: ChatMessage & { clientId?: string | null }) => {
      const clientId = msg.clientId;
      if (!clientId) return false;

      let matched = false;
      setPendingByClientId((prev) => {
        if (!prev[clientId]) return prev;
        matched = true;
        const next = { ...prev };
        delete next[clientId];
        return next;
      });

      if (matched) {
        clearTimer(clientId);
        inFlightRef.current.delete(clientId);
        dequeue(clientId);
      }
      return matched;
    },
    [clearTimer, dequeue]
  );

  const retry = useCallback(
    (clientId: string) => {
      setPendingByClientId((prev) => {
        const pending = prev[clientId];
        if (!pending) return prev;

        // Always resend to the recipient the message was originally
        // addressed to, never whatever conversation happens to be open now.
        const { receiverId, content } = pending;

        if (!isConnected || !socket) {
          enqueue({ clientId, receiverId, content, createdAt: pending.createdAt });
          return { ...prev, [clientId]: { ...pending, status: "queued" } };
        }

        sendOverSocket(clientId, receiverId, content);
        return { ...prev, [clientId]: { ...pending, status: "sending" } };
      });
    },
    [isConnected, socket, enqueue, sendOverSocket]
  );

  // Flush queued (offline-sent) messages once the socket reconnects.
  useEffect(() => {
    if (!isConnected || !socket) return;

    const queued = loadQueue(currentUserId, partnerId);
    if (queued.length === 0) return;

    for (const item of queued) {
      if (inFlightRef.current.has(item.clientId)) continue;

      setPendingByClientId((prev) => {
        const existing = prev[item.clientId];
        if (existing && existing.status !== "queued") return prev;
        return {
          ...prev,
          [item.clientId]: existing
            ? { ...existing, status: "sending" }
            : {
                id: item.clientId,
                clientId: item.clientId,
                senderId: currentUserId,
                receiverId: partnerId,
                content: item.content,
                read: false,
                createdAt: item.createdAt,
                sender: currentUser,
                status: "sending",
              },
        };
      });
      sendOverSocket(item.clientId, item.receiverId, item.content);
    }
    // Only re-run when connectivity flips or the conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, socket, currentUserId, partnerId]);

  // Clean up any outstanding ack timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
      timersRef.current = {};
    };
  }, []);

  return { pendingByClientId, send, retry, reconcileFromBroadcast };
}
