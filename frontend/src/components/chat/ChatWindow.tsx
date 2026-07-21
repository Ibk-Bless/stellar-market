"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  FormEvent,
} from "react";
import { Send, ChevronDown, AlertCircle, RotateCw, Clock } from "lucide-react";
import { useSocket } from "@/context/SocketContext";
import { useChatOutbox, OutgoingMessage } from "@/hooks/useChatOutbox";
import TypingIndicator from "./TypingIndicator";

const TYPING_DEBOUNCE_MS = 1500;

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  read: boolean;
  createdAt: string;
  sender: { id: string; username: string; avatarUrl: string | null };
  /** Client-generated id echoed back by the server, used to reconcile an
   * optimistic send with its confirmed delivery. Absent on messages that
   * originated from the legacy (non-ack) send path. */
  clientId?: string | null;
}

interface ChatWindowProps {
  currentUserId: string;
  partnerId: string;
  partnerUsername: string;
  currentUsername?: string;
  currentUserAvatarUrl?: string | null;
  initialMessages: ChatMessage[];
}

export default function ChatWindow({
  currentUserId,
  partnerId,
  partnerUsername,
  currentUsername = "",
  currentUserAvatarUrl = null,
  initialMessages,
}: ChatWindowProps) {
  const { socket, isConnected } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // clientIds of optimistic messages that have been reconciled with a
  // server-confirmed message, so the outbox entry can be hidden without a
  // duplicate flashing in before the pending map catches up.
  const reconciledClientIdsRef = useRef<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const currentUser = useMemo(
    () => ({ id: currentUserId, username: currentUsername, avatarUrl: currentUserAvatarUrl }),
    [currentUserId, currentUsername, currentUserAvatarUrl]
  );

  const handleServerMessage = useCallback((msg: ChatMessage, clientId?: string) => {
    if (clientId) reconciledClientIdsRef.current.add(clientId);
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const { pendingByClientId, send, retry, reconcileFromBroadcast } = useChatOutbox({
    socket,
    isConnected,
    currentUserId,
    partnerId,
    currentUser,
    onServerMessage: handleServerMessage,
  });

  // Merge confirmed history with any outbox entries not yet reconciled into
  // `messages`, so sending/failed/queued bubbles render inline without
  // duplicating once the server-confirmed message lands.
  const displayMessages = useMemo(() => {
    const pendingEntries = Object.values(pendingByClientId).filter(
      (p) => !reconciledClientIdsRef.current.has(p.clientId)
    );
    return [...messages, ...pendingEntries].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [messages, pendingByClientId]);

  // Track if user is at bottom using IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0]?.isIntersecting;
        setIsAtBottom(isVisible ?? false);
        if (isVisible) {
          setShowNewMessageBadge(false);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Scroll to bottom on initial load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Handle new messages: auto-scroll if at bottom, show badge if not
  useEffect(() => {
    if (displayMessages.length === 0) return;

    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowNewMessageBadge(false);
    } else {
      const lastMessage = displayMessages[displayMessages.length - 1];
      if (lastMessage?.senderId !== currentUserId) {
        setShowNewMessageBadge(true);
      }
    }
  }, [displayMessages, isAtBottom, currentUserId]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowNewMessageBadge(false);
  }, []);

  // Mark messages as read when chat opens
  useEffect(() => {
    if (!socket) return;
    socket.emit("mark_read", { senderId: partnerId });
  }, [socket, partnerId]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg: ChatMessage) => {
      // Only add if relevant to this conversation
      if (
        (msg.senderId === partnerId && msg.receiverId === currentUserId) ||
        (msg.senderId === currentUserId && msg.receiverId === partnerId)
      ) {
        // Reconcile against a pending optimistic send even if its ack was
        // lost — the message still arrived, so the outbox bubble should
        // clear instead of eventually timing out to "failed".
        if (msg.clientId) reconciledClientIdsRef.current.add(msg.clientId);
        reconcileFromBroadcast(msg);

        setMessages((prev) => {
          // Deduplicate
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Auto-mark as read if from partner
        if (msg.senderId === partnerId) {
          socket.emit("mark_read", { senderId: partnerId });
        }
      }
    };

    const handleUserTyping = ({ userId }: { userId: string }) => {
      if (userId === partnerId) setIsPartnerTyping(true);
    };

    const handleUserStoppedTyping = ({ userId }: { userId: string }) => {
      if (userId === partnerId) setIsPartnerTyping(false);
    };

    socket.on("new_message", handleNewMessage);
    socket.on("user_typing", handleUserTyping);
    socket.on("user_stopped_typing", handleUserStoppedTyping);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("user_typing", handleUserTyping);
      socket.off("user_stopped_typing", handleUserStoppedTyping);
    };
  }, [socket, partnerId, currentUserId]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (!socket) return;

      if (!isTypingRef.current) {
        isTypingRef.current = true;
        socket.emit("typing_start", { receiverId: partnerId });
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        socket.emit("typing_stop", { receiverId: partnerId });
      }, TYPING_DEBOUNCE_MS);
    },
    [socket, partnerId]
  );

  const handleSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const content = input.trim();
      if (!content) return;

      // Stop typing indicator
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current && socket) {
        isTypingRef.current = false;
        socket.emit("typing_stop", { receiverId: partnerId });
      }

      send(content);
      setInput("");
    },
    [input, socket, partnerId, send]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-theme-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex items-center justify-center text-white text-sm font-bold">
          {partnerUsername[0]?.toUpperCase()}
        </div>
        <span className="font-semibold text-theme-heading">{partnerUsername}</span>
      </div>

      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative"
      >
        {displayMessages.map((msg) => {
          const isOwn = msg.senderId === currentUserId;
          const status = (msg as OutgoingMessage).status as
            | OutgoingMessage["status"]
            | undefined;
          const isFailed = status === "failed";

          return (
            <div
              key={(msg as OutgoingMessage).clientId ?? msg.id}
              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div className="flex flex-col items-end max-w-[70%]">
                <div
                  className={`px-4 py-2 rounded-2xl text-sm leading-relaxed ${isOwn
                      ? isFailed
                        ? "bg-stellar-blue/50 text-white rounded-br-sm"
                        : "bg-stellar-blue text-white rounded-br-sm"
                      : "bg-theme-card text-theme-text border border-theme-border rounded-bl-sm"
                    }`}
                >
                  {msg.content}
                  <div
                    className={`text-xs mt-1 flex items-center gap-1 ${isOwn ? "text-white/70" : "text-theme-text"
                      }`}
                  >
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {status === "sending" && <span>· Sending…</span>}
                    {status === "queued" && (
                      <span className="flex items-center gap-0.5">
                        <Clock size={10} /> Queued
                      </span>
                    )}
                    {status === "failed" && <span>· Not delivered</span>}
                  </div>
                </div>
                {isFailed && (
                  <button
                    type="button"
                    onClick={() => retry((msg as OutgoingMessage).clientId)}
                    className="mt-1 flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors"
                  >
                    <AlertCircle size={12} />
                    Failed to send
                    <RotateCw size={12} className="ml-1" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <TypingIndicator isTyping={isPartnerTyping} username={partnerUsername} />
        <div ref={sentinelRef} className="h-1" />
        <div ref={bottomRef} />

        {/* New message badge */}
        {showNewMessageBadge && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-stellar-blue text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:bg-stellar-purple transition-colors z-10 animate-slide-in"
            aria-label="Scroll to new messages"
          >
            New message
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="px-4 py-3 border-t border-theme-border flex items-end gap-3"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e as unknown as FormEvent);
            }
          }}
          placeholder={`Message ${partnerUsername}…`}
          className="flex-1 resize-none bg-theme-card border border-theme-border rounded-xl px-4 py-2.5 text-sm text-theme-text placeholder-theme-text focus:outline-none focus:border-stellar-blue transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          id="send-message-btn"
          className="btn-primary p-2.5 rounded-xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
