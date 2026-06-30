"use client";

import { useState } from "react";
import { X, Mail, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export default function EmailVerificationBanner() {
  const { user, token } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!user || user.emailVerified || dismissed) {
    return null;
  }

  const handleResend = async () => {
    if (!token) return;

    setSending(true);
    setMessage(null);

    try {
      await axios.post(
        `${API}/auth/send-verification`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setMessage("Verification email sent! Check your inbox.");
    } catch (error: any) {
      setMessage(
        error.response?.data?.error || "Failed to send verification email."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-theme-warning/10 border-b border-theme-warning/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <AlertCircle className="text-theme-warning flex-shrink-0" size={20} />
            <div className="flex-1">
              <p className="text-sm text-theme-heading">
                Your email is not verified. Check your inbox or resend the verification email.
              </p>
              {message && (
                <p className={`text-xs mt-1 ${message.includes("sent") ? "text-theme-success" : "text-theme-error"}`}>
                  {message}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResend}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-1.5 bg-theme-warning hover:bg-theme-warning/80 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              <Mail size={14} />
              {sending ? "Sending..." : "Resend"}
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="text-theme-warning hover:text-theme-warning/80 transition-colors"
              aria-label="Dismiss banner"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
