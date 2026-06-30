"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  FormEvent,
} from "react";
import { Send, ChevronDown } from "lucide-react";
import { useSocket } from "@/context/SocketContext";
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
}

interface ChatWindowProps {
  currentUserId: string;
  partnerId: string;
  partnerUsername: string;
  initialMessages: ChatMessage[];
}

export default function ChatWindow({
  currentUserId,
  partnerId,
  partnerUsername,
  initialMessages,
}: ChatWindowProps) {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

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
    if (messages.length === 0) return;
    
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowNewMessageBadge(false);
    } else {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.senderId !== currentUserId) {
        setShowNewMessageBadge(true);
      }
    }
  }, [messages, isAtBottom, currentUserId]);

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
      if (!content || !socket) return;

      // Stop typing indicator
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        socket.emit("typing_stop", { receiverId: partnerId });
      }

      setIsSending(true);
      socket.emit("send_message", { receiverId: partnerId, content });
      setInput("");
      setIsSending(false);
    },
    [input, socket, partnerId]
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
        {messages.map((msg) => {
          const isOwn = msg.senderId === currentUserId;
          return (
            <div
              key={msg.id}
              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${isOwn
                    ? "bg-stellar-blue text-white rounded-br-sm"
                    : "bg-theme-card text-theme-text border border-theme-border rounded-bl-sm"
                  }`}
              >
                {msg.content}
                <div
                  className={`text-xs mt-1 ${isOwn ? "text-white/70" : "text-theme-text"
                    }`}
                >
                  {new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
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
          disabled={!input.trim() || isSending}
          id="send-message-btn"
          className="btn-primary p-2.5 rounded-xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
