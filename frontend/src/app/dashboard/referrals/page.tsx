"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { Gift, Copy, CheckCheck, Users, Star, Loader2 } from "lucide-react";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

interface ReferralEntry {
  id: string;
  username: string;
  createdAt: string;
}

interface ReferralStats {
  referralCode: string | null;
  totalReferrals: number;
  bonusEarned: number;
  referrals: ReferralEntry[];
}

export default function ReferralsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get<ReferralStats>(`${API}/referrals/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStats(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const referralLink =
    typeof window !== "undefined" && stats?.referralCode
      ? `${window.location.origin}/auth/register?ref=${stats.referralCode}`
      : null;

  const handleCopy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={40} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="flex items-center gap-3 mb-8">
        <Gift size={28} className="text-stellar-blue" />
        <h1 className="text-3xl font-bold text-theme-heading">Referral Programme</h1>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="card flex items-center gap-4">
          <Users size={24} className="text-stellar-blue" />
          <div>
            <div className="text-2xl font-bold text-theme-heading">
              {stats?.totalReferrals ?? 0}
            </div>
            <div className="text-sm text-theme-text">Successful Referrals</div>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <Star size={24} className="text-stellar-purple" />
          <div>
            <div className="text-2xl font-bold text-theme-heading">
              {(stats?.bonusEarned ?? 0).toLocaleString()} XLM
            </div>
            <div className="text-sm text-theme-text">Total Bonus Earned</div>
          </div>
        </div>
      </div>

      {/* Referral link */}
      <div className="card mb-8">
        <h2 className="text-lg font-semibold text-theme-heading mb-3">Your Referral Link</h2>
        {referralLink ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-theme-bg border border-theme-border rounded-lg px-4 py-2.5 text-sm text-theme-text font-mono truncate">
              {referralLink}
            </div>
            <button
              onClick={() => void handleCopy()}
              className="btn-primary flex items-center gap-2 py-2.5 px-4 shrink-0"
            >
              {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-theme-text">No referral code assigned yet.</p>
        )}
        <p className="text-xs text-theme-text/70 mt-2">
          Share this link — when someone registers using it, they are linked to your account and
          you earn a reputation bonus when they complete their first job.
        </p>
      </div>

      {/* Referrals list */}
      <div className="card">
        <h2 className="text-lg font-semibold text-theme-heading mb-4">
          People You&apos;ve Referred
        </h2>
        {stats?.referrals && stats.referrals.length > 0 ? (
          <div className="space-y-3">
            {stats.referrals.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 border-b border-theme-border last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex items-center justify-center text-white font-bold text-sm">
                    {r.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-theme-heading">{r.username}</span>
                </div>
                <span className="text-xs text-theme-text">
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Users className="mx-auto text-theme-text mb-3" size={36} />
            <p className="text-theme-text">No referrals yet. Share your link to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
