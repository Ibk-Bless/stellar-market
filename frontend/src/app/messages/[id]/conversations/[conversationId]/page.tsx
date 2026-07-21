"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import ChatWindow from "@/components/chat/ChatWindow";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export default function ConversationPage() {
  const params = useParams();
  const { token, user: currentUser } = useAuth();
  const partnerId = params?.conversationId as string;

  const [messages, setMessages] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [partnerUsername, setPartnerUsername] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !partnerId) {
      if (!token) setError("Please log in to view this conversation.");
      setLoading(false);
      return;
    }

    axios
      .get<any[]>(`${API}/messages/${partnerId}`, { // eslint-disable-line @typescript-eslint/no-explicit-any
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setMessages(res.data);
        // Derive partner username from first message
        const first = res.data[0];
        if (first && currentUser) {
          const partner =
            first.senderId === currentUser.id ? first.receiver : first.sender;
          setPartnerUsername(partner?.username || "");
        }
      })
      .catch(() => setError("Failed to load conversation."))
      .finally(() => setLoading(false));
  }, [partnerId, token, currentUser]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="h-96 bg-theme-card rounded-xl animate-pulse border border-theme-border" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col h-[calc(100vh-4rem)]">
      <Link
        href="/messages"
        className="flex items-center gap-2 text-theme-text hover:text-theme-heading text-sm mb-4 transition-colors w-fit"
      >
        <ArrowLeft size={16} />
        Back to messages
      </Link>

      <div className="flex-1 bg-theme-card border border-theme-border rounded-xl overflow-hidden flex flex-col">
        <ChatWindow
          key={partnerId}
          currentUserId={currentUser?.id || ""}
          partnerId={partnerId}
          partnerUsername={partnerUsername || partnerId}
          currentUsername={currentUser?.username || ""}
          currentUserAvatarUrl={currentUser?.avatarUrl || null}
          initialMessages={messages}
        />
      </div>
    </main>
  );
}
