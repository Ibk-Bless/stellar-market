"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronRight, Briefcase, Search, User, CheckCircle2, Loader2, Wallet, ExternalLink } from "lucide-react";
import axios from "axios";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";
const TOTAL_STEPS = 4;

interface StepProps {
  onNext: () => void;
  onSkip: () => void;
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
            i < step ? "bg-stellar-blue" : "bg-theme-border"
          }`}
        />
      ))}
      <span className="text-xs text-theme-text ml-1 shrink-0">
        {step}/{TOTAL_STEPS}
      </span>
    </div>
  );
}

function StepOne({ onNext, onSkip, role }: StepProps & { role: string }) {
  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-stellar-blue/10 flex items-center justify-center mb-4">
        <User size={24} className="text-stellar-blue" />
      </div>
      <h2 className="text-xl font-bold text-theme-heading mb-2">Welcome to StellarMarket!</h2>
      <p className="text-theme-text text-sm mb-6">
        You&apos;re registered as a{" "}
        <span className="font-semibold text-stellar-blue capitalize">{role.toLowerCase()}</span>.
        Let&apos;s get you set up in just a few steps.
      </p>
      <div className="flex gap-3">
        <button onClick={onNext} className="btn-primary flex items-center gap-2">
          Get Started <ChevronRight size={16} />
        </button>
        <button onClick={onSkip} className="btn-secondary text-sm">
          Skip
        </button>
      </div>
    </div>
  );
}

function StepTwo({
  onNext,
  onSkip,
  bio,
  setBio,
  skills,
  toggleSkill,
  isSaving,
}: StepProps & {
  bio: string;
  setBio: (v: string) => void;
  skills: string[];
  toggleSkill: (s: string) => void;
  isSaving: boolean;
}) {
  const SUGGESTED = ["React", "Next.js", "TypeScript", "Node.js", "Rust", "Soroban", "Stellar", "Figma", "Python", "Solidity"];

  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-stellar-purple/10 flex items-center justify-center mb-4">
        <User size={24} className="text-stellar-purple" />
      </div>
      <h2 className="text-xl font-bold text-theme-heading mb-1">Complete your profile</h2>
      <p className="text-theme-text text-sm mb-5">A filled-out profile gets you noticed faster.</p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-theme-text mb-1">Bio</label>
        <textarea
          className="input-field resize-none h-20 text-sm"
          placeholder="Tell clients or freelancers a bit about yourself…"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
        />
        <p className="text-xs text-theme-text/60 mt-1 text-right">{bio.length}/500</p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-theme-text mb-2">Skills</label>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSkill(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                skills.includes(s)
                  ? "bg-stellar-blue text-white"
                  : "bg-theme-card border border-theme-border text-theme-text hover:border-stellar-blue"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onNext}
          disabled={isSaving}
          className="btn-primary flex items-center gap-2 disabled:opacity-60"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
          Save &amp; Continue <ChevronRight size={16} />
        </button>
        <button onClick={onSkip} className="btn-secondary text-sm">
          Skip
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Connect Wallet (issue #475) ─────────────────────────────────────

type WalletState = "idle" | "connecting" | "connected" | "not_installed" | "skipped";

function StepWallet({
  onNext,
  onSkip,
  walletAddress,
  setWalletAddress,
}: StepProps & { walletAddress: string | null; setWalletAddress: (a: string | null) => void }) {
  const [state, setState] = useState<WalletState>("idle");
  const { token, updateUser } = useAuth();

  const handleConnect = useCallback(async () => {
    // Detect Freighter via the injected window global
    const freighter = (window as unknown as { freighter?: { requestAccess: () => Promise<string> } }).freighter;
    if (!freighter) {
      setState("not_installed");
      return;
    }

    setState("connecting");
    try {
      const publicKey = await freighter.requestAccess();
      setWalletAddress(publicKey);
      setState("connected");

      // Persist wallet address to user profile
      try {
        await axios.patch(
          `${API}/users/me`,
          { walletAddress: publicKey },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        updateUser({ walletAddress: publicKey });
      } catch {
        // Profile update failure is non-blocking — key is stored in local state
      }
    } catch {
      // User rejected or error occurred
      setState("idle");
    }
  }, [token, updateUser, setWalletAddress]);

  const truncate = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-stellar-blue/10 flex items-center justify-center mb-4">
        <Wallet size={24} className="text-stellar-blue" />
      </div>
      <h2 className="text-xl font-bold text-theme-heading mb-1">Connect your wallet</h2>
      <p className="text-theme-text text-sm mb-5">
        Link a Stellar wallet to fund jobs and receive payments. You can also do this later from Settings.
      </p>

      {state === "not_installed" && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-4 text-sm text-amber-400">
          <p className="font-semibold mb-1">Freighter not detected</p>
          <p className="mb-2">Install the Freighter browser extension to connect a Stellar wallet.</p>
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline hover:no-underline"
          >
            Get Freighter <ExternalLink size={12} />
          </a>
        </div>
      )}

      {state === "connected" && walletAddress && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 mb-4 flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>Connected: <span className="font-mono">{truncate(walletAddress)}</span></span>
        </div>
      )}

      <div className="flex gap-3">
        {state === "connected" ? (
          <button onClick={onNext} className="btn-primary flex items-center gap-2">
            Continue <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={state === "connecting"}
            className="btn-primary flex items-center gap-2 disabled:opacity-60"
          >
            {state === "connecting" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Wallet size={16} />
            )}
            {state === "connecting" ? "Connecting…" : "Connect Freighter"}
          </button>
        )}
        <button onClick={onSkip} className="btn-secondary text-sm">
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────

function StepThree({ onSkip, role }: { onSkip: () => void; role: string }) {
  const isClient = role === "CLIENT";
  return (
    <div>
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isClient ? "bg-theme-success/10" : "bg-stellar-blue/10"}`}>
        {isClient ? (
          <Briefcase size={24} className="text-theme-success" />
        ) : (
          <Search size={24} className="text-stellar-blue" />
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 size={20} className="text-theme-success" />
        <h2 className="text-xl font-bold text-theme-heading">You&apos;re all set!</h2>
      </div>
      <p className="text-theme-text text-sm mb-6">
        {isClient
          ? "Start by posting your first job and find skilled freelancers on Stellar."
          : "Browse open jobs and apply to ones that match your skills."}
      </p>
      <div className="flex gap-3">
        <Link
          href={isClient ? "/post-job" : "/jobs"}
          className="btn-primary flex items-center gap-2"
          onClick={onSkip}
        >
          {isClient ? <Briefcase size={16} /> : <Search size={16} />}
          {isClient ? "Post a Job" : "Browse Jobs"}
        </Link>
        <button onClick={onSkip} className="btn-secondary text-sm">
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const { user, token, updateUser } = useAuth();
  const [step, setStep] = useState(1);
  const [bio, setBio] = useState(user?.bio ?? "");
  const [skills, setSkills] = useState<string[]>(user?.skills ?? []);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && user.completedOnboarding === false) {
      setOpen(true);
    }
  }, [user]);

  const markComplete = useCallback(async () => {
    try {
      await axios.patch(
        `${API}/users/me/onboarding`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      updateUser({ completedOnboarding: true });
    } catch {
      // silently ignore — wizard will not reappear after page refresh
      // since the optimistic updateUser already hid it
    }
  }, [token, updateUser]);

  const handleSkip = useCallback(async () => {
    setOpen(false);
    await markComplete();
  }, [markComplete]);

  useFocusTrap(modalRef, { open, onClose: handleSkip });

  useFocusTrap(modalRef, { open, onClose: handleSkip });

  const handleStepOneNext = () => setStep(2);

  const handleStepTwoNext = async () => {
    setIsSaving(true);
    try {
      await axios.put(
        `${API}/users/me`,
        { bio, skills },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      updateUser({ bio, skills });
    } catch {
      // profile save failure is non-blocking — still advance
    } finally {
      setIsSaving(false);
      setStep(3);
    }
  };

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill],
    );
  };

  if (!open || !user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div ref={modalRef} className="bg-theme-card border border-theme-border rounded-2xl shadow-2xl w-full max-w-md p-6 relative animate-in fade-in slide-in-from-bottom-4">
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-1.5 text-theme-text hover:text-theme-heading transition-colors"
          aria-label="Close onboarding"
        >
          <X size={18} />
        </button>

        <ProgressBar step={step} />

        {step === 1 && (
          <StepOne onNext={handleStepOneNext} onSkip={handleSkip} role={user.role} />
        )}
        {step === 2 && (
          <StepTwo
            onNext={handleStepTwoNext}
            onSkip={handleSkip}
            bio={bio}
            setBio={setBio}
            skills={skills}
            toggleSkill={toggleSkill}
            isSaving={isSaving}
          />
        )}
        {step === 3 && (
          <StepWallet
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
            walletAddress={walletAddress}
            setWalletAddress={setWalletAddress}
          />
        )}
        {step === 4 && <StepThree onSkip={handleSkip} role={user.role} />}
      </div>
    </div>
  );
}
