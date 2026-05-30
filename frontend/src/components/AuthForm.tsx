"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { Loader2, Mail, Lock, User as UserIcon, Wallet, ShieldCheck, Gift, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface AuthFormProps {
  type: "login" | "register";
}

export default function AuthForm({ type }: AuthFormProps) {
  const { login, register } = useAuth();
  const { address, connect, isConnecting, error: walletError, signMessage } = useWallet();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referralOpen, setReferralOpen] = useState(false);

  // 2FA state
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    role: "FREELANCER" as "CLIENT" | "FREELANCER",
    referralCode: "",
  });

  // Auto-fill referral code from ?ref= query param
  useEffect(() => {
    if (type !== "register") return;
    const ref = searchParams?.get("ref");
    if (ref) {
      setFormData((prev) => ({ ...prev, referralCode: ref }));
      setReferralOpen(true);
    }
  }, [type, searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

    try {
      const response = await fetch(`${API}/auth/2fa/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode, tempToken }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed");
      login(data.token, data.user);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

    try {
      if (type === "login") {
        const response = await fetch(`${API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Login failed");

        if (data.requiresTwoFactor) {
          setTwoFactorPending(true);
          setTempToken(data.tempToken);
          return;
        }

        login(data.token, data.user);
      } else {
        const body: Record<string, string> = {
          name: formData.username,
          email: formData.email,
          password: formData.password,
          role: formData.role,
        };
        if (address) {
          body.stellarAddress = address;
        }
        if (formData.referralCode.trim()) {
          body.referralCode = formData.referralCode.trim();
        }
        const response = await fetch(`${API}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Registration failed");
        register(data.token, data.user);
      }
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWalletLogin = async () => {
    setIsLoading(true);
    setError(null);
    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

    try {
      let publicKey = address;
      if (!address) {
        const connectedAddress = await connect();
        if (!connectedAddress) {
          setError("Connect a wallet before continuing.");
          return;
        }
        publicKey = connectedAddress;
      }
      if (!publicKey) {
        setError("Connect a wallet before continuing.");
        return;
      }
      const message = `Sign in to StellarMarket with ${publicKey} at ${Date.now()}`;
      const signature = await signMessage(message);
      const response = await fetch(`${API}/auth/wallet/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, message, signature }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Wallet login failed");
      login(data.token, data.user);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (twoFactorPending) {
    return (
      <div className="w-full max-w-md p-8 bg-dark-card border border-dark-border rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <ShieldCheck size={48} className="mx-auto mb-4 text-stellar-blue" />
          <h1 className="text-3xl font-bold text-dark-heading mb-2">Two-Factor Authentication</h1>
          <p className="text-dark-muted">
            Enter the 6-digit code from your authenticator app, or an 8-character recovery code.
          </p>
        </div>

        <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark-text mb-1">
              Verification Code
            </label>
            <div className="relative">
              <ShieldCheck
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-muted"
              />
              <input
                type="text"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-dark-bg border border-dark-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-dark-text text-center tracking-widest"
                placeholder="000000 or recovery"
                autoFocus
                autoComplete="one-time-code"
                maxLength={32}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2 font-semibold"
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Verify"}
          </button>

          <button
            type="button"
            onClick={() => {
              setTwoFactorPending(false);
              setTempToken("");
              setTotpCode("");
              setError(null);
            }}
            className="w-full py-2 text-dark-muted hover:text-dark-text text-sm transition-colors"
          >
            Back to login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-theme-card border border-theme-border rounded-2xl shadow-xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-theme-heading mb-2">
          {type === "login" ? "Welcome Back" : "Create Account"}
        </h1>
        <p className="text-theme-text">
          {type === "login"
            ? "Sign in to access your stellar dashboard"
            : "Join the future of decentralized freelance work"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {type === "register" && (
          <>
            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">
                Username
              </label>
              <div className="relative">
                <UserIcon
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
                />
                <input
                  type="text"
                  name="username"
                  required
                  value={formData.username}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-2 bg-theme-bg border border-theme-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-theme-text"
                  placeholder="johndoe"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">
                Role
              </label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-theme-bg border border-theme-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-theme-text"
              >
                <option value="FREELANCER">Freelancer</option>
                <option value="CLIENT">Client</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text mb-1">
                Wallet Address
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Wallet
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
                  />
                  <input
                    type="text"
                    readOnly
                    value={address || ""}
                    className="w-full pl-10 pr-4 py-2 bg-theme-bg border border-theme-border rounded-lg text-theme-text cursor-not-allowed text-sm"
                    placeholder="Connect wallet..."
                  />
                </div>
                {!address && (
                  <button
                    type="button"
                    onClick={connect}
                    disabled={isConnecting}
                    className="btn-primary py-2 px-4 text-sm flex items-center gap-2 disabled:opacity-60"
                  >
                    {isConnecting ? <Loader2 size={14} className="animate-spin" /> : null}
                    {isConnecting ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
              {walletError === "NOT_INSTALLED" && (
                <p className="text-xs text-theme-error mt-1">
                  Freighter wallet extension is not installed.{" "}
                  <a
                    href="https://freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80"
                  >
                    Install Freighter ↗
                  </a>
                </p>
              )}
              {walletError === "LOCKED" && (
                <p className="text-xs text-theme-error mt-1">
                  Please unlock your Freighter wallet and try again.
                </p>
              )}
              {walletError && walletError !== "NOT_INSTALLED" && walletError !== "LOCKED" && (
                <p className="text-xs text-theme-error mt-1">{walletError}</p>
              )}
              {!address && !walletError && type === "register" && (
                <p className="text-xs text-theme-text mt-1">Optional: link a wallet now or from settings later.</p>
              )}
            </div>

            {/* Collapsible referral code field */}
            <div>
              <button
                type="button"
                onClick={() => setReferralOpen((o) => !o)}
                className="flex items-center gap-2 text-sm text-theme-text hover:text-stellar-blue transition-colors"
              >
                <Gift size={16} />
                Have a referral code?
                <ChevronDown
                  size={14}
                  className={`transition-transform ${referralOpen ? "rotate-180" : ""}`}
                />
              </button>
              {referralOpen && (
                <div className="mt-2">
                  <div className="relative">
                    <Gift
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
                    />
                    <input
                      type="text"
                      name="referralCode"
                      value={formData.referralCode}
                      onChange={handleChange}
                      className="w-full pl-10 pr-4 py-2 bg-theme-bg border border-theme-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-theme-text"
                      placeholder="Enter referral code (optional)"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-theme-text mb-1">
            Email Address
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
            />
            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="w-full pl-10 pr-4 py-2 bg-theme-bg border border-theme-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-theme-text"
              placeholder="name@example.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-text mb-1">
            Password
          </label>
          <div className="relative">
            <Lock
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
            />
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              className="w-full pl-10 pr-4 py-2 bg-theme-bg border border-theme-border rounded-lg focus:ring-2 focus:ring-stellar-blue outline-none transition-all text-theme-text"
              placeholder="••••••••"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 bg-theme-error/10 border border-theme-error/20 rounded-lg text-theme-error text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full btn-primary py-3 flex items-center justify-center gap-2 font-semibold"
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin" />
          ) : type === "login" ? (
            "Sign In"
          ) : (
            "Create Account"
          )}
        </button>
      </form>

      {type === "login" && (
        <div className="mt-4">
          <button
            type="button"
            onClick={handleWalletLogin}
            disabled={isLoading || isConnecting}
            className="w-full btn-secondary py-3 flex items-center justify-center gap-2 font-semibold disabled:opacity-60"
          >
            {isConnecting || isLoading ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
            Continue with wallet
          </button>
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-theme-border text-center">
        <p className="text-theme-text">
          {type === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/register"
                className="text-stellar-blue hover:underline font-medium"
              >
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="text-stellar-blue hover:underline font-medium"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
