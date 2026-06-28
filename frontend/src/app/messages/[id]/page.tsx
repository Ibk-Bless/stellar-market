"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Send, ArrowLeft, User, Briefcase, Paperclip } from "lucide-react";
import axios from "axios";
import { Message } from "@/types";
import MessageBubble from "@/components/MessageBubble";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";

type Job = {
  [key: string]: string;
};

type User = {
  [key: string]: string;
};

export default function ChatThreadPage() {
  const { id } = useParams();
  const { token, user: currentUser } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [otherUserId, jobId] = (id as string).split("-");
  const actualJobId = jobId === "no-job" ? null : jobId;

  const fetchChat = useCallback(async () => {
    try {
      if (!token) return;
      setLoading(true);
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1"}/messages?participantId=${otherUserId}${actualJobId ? `&jobId=${actualJobId}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const fetchedMessages = response.data;
      setMessages(fetchedMessages);

      if (fetchedMessages.length > 0) {
        const firstMsg = fetchedMessages[0];
        const other =
          firstMsg.senderId === otherUserId
            ? firstMsg.sender
            : firstMsg.receiver;
        setOtherUser(other);
        setJob(firstMsg.job);
      }

      await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1"}/messages/${otherUserId}${actualJobId ? `?jobId=${actualJobId}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
    } catch (err) {
      console.error("Fetch chat error:", err);
    } finally {
      setLoading(false);
    }
  }, [token, otherUserId, actualJobId]);

  useEffect(() => {
    if (id && token) {
      fetchChat();
    }
  }, [id, token, fetchChat]);

  useEffect(() => {
    if (!socket || !currentUser?.id) return;

    const handleNewMessage = (message: Message) => {
      const isRelevant =
        (message.senderId === otherUserId || message.receiverId === otherUserId) &&
        (message.senderId === currentUser.id || message.receiverId === currentUser.id);

      if (!isRelevant) return;

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === message.id);
        if (exists) return prev;
        return [...prev, message];
      });

      if (message.senderId === otherUserId) {
        socket.emit("mark_read", { senderId: otherUserId });
      }
    };

    socket.on("new_message", handleNewMessage);

    return () => {
      socket.off("new_message", handleNewMessage);
    };
  }, [socket, otherUserId, currentUser?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    try {
      if (!token) return;
      setSending(true);

      if (socket?.connected) {
        socket.emit("send_message", {
          receiverId: otherUserId,
          jobId: actualJobId,
          content: newMessage,
        });
        setNewMessage("");
      } else {
        const response = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1"}/messages`,
          {
            receiverId: otherUserId,
            jobId: actualJobId,
            content: newMessage,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        setMessages([...messages, response.data]);
        setNewMessage("");
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setSending(false);
    }
  };

  if (loading && messages.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 flex flex-col h-[80vh]">
        <div className="animate-pulse flex items-center gap-4 mb-8">
          <div className="w-10 h-10 bg-theme-border rounded-full" />
          <div className="h-6 bg-theme-border rounded w-48" />
        </div>
        <div className="flex-1 bg-theme-card/30 rounded-2xl border border-theme-border" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-theme-border">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-theme-card rounded-full transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex items-center justify-center text-white font-bold overflow-hidden">
              {otherUser?.avatarUrl ? (
                <Image
                  src={otherUser.avatarUrl}
                  alt={otherUser.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User size={20} className="text-white/50" />
              )}
            </div>
            <div>
              <h2 className="font-bold text-theme-heading">
                {otherUser?.username || "Chat"}
              </h2>
              {job && (
                <div className="flex items-center gap-1 text-[10px] text-stellar-purple uppercase tracking-wider font-semibold">
                  <Briefcase size={10} /> {job.title}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto mb-6 pr-4 space-y-2 scrollbar-hide"
      >
        {messages.length > 0 ? (
          messages.map((msg) => {
            const isMe = msg.senderId !== otherUserId;
            return <MessageBubble key={msg.id} message={msg} isMe={isMe} />;
          })
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-theme-text opacity-50">
            <MessageSquare size={48} className="mb-4" />
            <p>No messages yet. Send a message to start the conversation!</p>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSendMessage} className="relative">
        <div className="flex items-end gap-3 bg-theme-card p-2 rounded-2xl border border-theme-border focus-within:border-stellar-blue/50 transition-all shadow-xl">
          <button
            type="button"
            className="p-2.5 text-theme-text hover:text-stellar-blue transition-colors"
          >
            <Paperclip size={20} />
          </button>
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            placeholder="Type your message..."
            className="flex-1 bg-transparent border-none focus:ring-0 text-theme-heading py-2.5 resize-none max-h-32 text-sm"
            rows={1}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className={`p-2.5 rounded-xl transition-all ${
              newMessage.trim() && !sending
                ? "bg-stellar-blue text-white shadow-lg shadow-stellar-blue/20 hover:scale-105 active:scale-95"
                : "bg-theme-border text-theme-text opacity-50 cursor-not-allowed"
            }`}
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageSquare({
  size,
  className,
}: {
  size: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
