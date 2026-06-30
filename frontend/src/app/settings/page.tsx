"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/components/Toast";
import WalletAddress from "@/components/WalletAddress";
import SkillCombobox from "@/components/SkillCombobox";
import { useForm, Controller } from "react-hook-form";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import UnsavedChangesModal from "@/components/UnsavedChangesModal";
import { resizeImage, createImagePreview } from "@/utils/image";
import {
  User,
  Settings,
  Mail,
  FileText,
  Link as LinkIcon,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  Upload,
  X,
  Plus,
  ImageIcon,
  GripVertical,
  Pencil,
  Trash2,
  Images,
  Wallet,
} from "lucide-react";
import { PortfolioItem } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const BASE_URL = API_URL.replace(/\/api\/?$/, "");

const PORTFOLIO_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
const PORTFOLIO_MAX_FILE_SIZE = 5 * 1024 * 1024;
const PORTFOLIO_MAX_ITEMS = 10;

interface FormErrors {
  username?: string;
  email?: string;
  bio?: string;
  avatarUrl?: string;
  skills?: string;
  general?: string;
}

export default function SettingsPage() {
  const { user, token, isLoading: authLoading, updateUser, refreshUser } = useAuth();
  const { address, connect, bindWallet, isConnecting } = useWallet();
  const { toast } = useToast();
  const router = useRouter();

  // ─── Tab State ─────────────────────────────────────────────────────────────
  const [activeSettingsTab, setActiveSettingsTab] = useState<"profile" | "security" | "portfolio">("profile");

  // Seed form fields immediately from auth-context user so the form is never
  // blank while the fresh API fetch is in-flight (or if it fails).
  type ProfileFormValues = {
    username: string;
    email: string;
    bio: string;
    avatarUrl: string;
    role: "CLIENT" | "FREELANCER";
    availabilityStatus: "available" | "busy" | "unavailable";
    skills: string[];
  };

  const { 
    register, 
    handleSubmit: hookFormSubmit, 
    setValue, 
    watch, 
    control, 
    reset, 
    formState: { errors: formErrors, isDirty } 
  } = useForm<ProfileFormValues>({
    defaultValues: {
      username: user?.username ?? "",
      email: user?.email ?? "",
      bio: user?.bio ?? "",
      avatarUrl: user?.avatarUrl ?? "",
      role: user?.role === "CLIENT" || user?.role === "FREELANCER" ? user.role : "FREELANCER",
      availabilityStatus: user?.availability === false ? "unavailable" : "available",
      skills: user?.skills ?? [],
    }
  });

  const { showModal, confirmLeave, cancelLeave } = useUnsavedChangesWarning(isDirty);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(!user);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // ─── 2FA State ──────────────────────────────────────────────────────────────
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [twoFASetupData, setTwoFASetupData] = useState<{
    qrCode: string;
    secret: string;
  } | null>(null);
  const [recoveryCodesPending, setRecoveryCodesPending] = useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [regenerateTotp, setRegenerateTotp] = useState("");
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);

  // ─── Portfolio State ─────────────────────────────────────────────────────────
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [isUploadingPortfolio, setIsUploadingPortfolio] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const portfolioFileRef = useRef<HTMLInputElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/");
    }
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;

    async function fetchProfile() {
      try {
        const res = await axios.get(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = res.data;
        reset({
          username: data.username ?? "",
          email: data.email ?? "",
          bio: data.bio ?? "",
          avatarUrl: data.avatarUrl ?? "",
          role: data.role ?? "FREELANCER",
          availabilityStatus: data.availability === false ? "unavailable" : "available",
          skills: data.skills ?? [],
        });
        setTwoFAEnabled(data.twoFactorEnabled ?? false);
        updateUser({
          walletAddress: data.walletAddress ?? null,
          email: data.email ?? undefined,
          authMethods: data.authMethods,
        });
      } catch {
        if (!user) {
          toast.error("Failed to load profile data.");
        }
      } finally {
        setIsPageLoading(false);
      }
    }

    fetchProfile();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || !user) return;
    fetchPortfolioItems();
  }, [token, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Portfolio Functions ────────────────────────────────────────────────────

  async function fetchPortfolioItems() {
    if (!user) return;
    setPortfolioLoading(true);
    try {
      const res = await axios.get(`${API_URL}/portfolio/user/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPortfolioItems(res.data.items ?? []);
    } catch {
      // Portfolio might not exist yet — silently ignore
    } finally {
      setPortfolioLoading(false);
    }
  }

  async function handlePortfolioFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (!PORTFOLIO_MIME_TYPES.includes(file.type)) {
      toast.error("Only JPG, PNG, GIF, WebP, or PDF files are allowed");
      return;
    }

    if (file.size > PORTFOLIO_MAX_FILE_SIZE) {
      toast.error("File must be less than 5MB");
      return;
    }

    if (portfolioItems.length >= PORTFOLIO_MAX_ITEMS) {
      toast.error(`Maximum ${PORTFOLIO_MAX_ITEMS} portfolio items allowed`);
      return;
    }

    const titlePrompt = window.prompt("Enter a title for this portfolio item:", file.name.replace(/\.[^/.]+$/, ""));
    if (titlePrompt === null) return;
    const cleanTitle = titlePrompt.trim() || file.name.replace(/\.[^/.]+$/, "");

    setIsUploadingPortfolio(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", cleanTitle);

      const res = await axios.post(`${API_URL}/portfolio`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      setPortfolioItems((prev) => [...prev, res.data]);
      toast.success("Portfolio item added!");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const message = error.response?.data?.error || "Failed to upload file";
      toast.error(message);
    } finally {
      setIsUploadingPortfolio(false);
    }
  }

  async function handlePortfolioDelete(id: string) {
    if (!window.confirm("Delete this portfolio item?")) return;
    try {
      await axios.delete(`${API_URL}/portfolio/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPortfolioItems((prev) => prev.filter((item) => item.id !== id));
      toast.success("Portfolio item removed");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to delete item");
    }
  }

  function startEditItem(item: PortfolioItem) {
    setEditingItemId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
  }

  async function handleSaveItemEdit(id: string) {
    try {
      const res = await axios.put(
        `${API_URL}/portfolio/${id}`,
        { title: editTitle, description: editDescription || null },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setPortfolioItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...res.data } : item)),
      );
      setEditingItemId(null);
      toast.success("Portfolio item updated");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to update item");
    }
  }

  function handleDragStart(id: string) {
    setDragItemId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    setDragOverId(id);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  async function handleDrop(targetId: string) {
    setDragOverId(null);
    if (!dragItemId || dragItemId === targetId) {
      setDragItemId(null);
      return;
    }

    const items = [...portfolioItems];
    const fromIdx = items.findIndex((i) => i.id === dragItemId);
    const toIdx = items.findIndex((i) => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);

    const reordered = items.map((item, index) => ({ ...item, displayOrder: index }));
    setPortfolioItems(reordered);
    setDragItemId(null);

    try {
      await axios.put(
        `${API_URL}/portfolio/reorder`,
        { ids: reordered.map((i) => i.id) },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch {
      await fetchPortfolioItems();
      toast.error("Failed to save new order");
    }
  }

  // ─── Profile Functions ──────────────────────────────────────────────────────

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    try {
      const resizedFile = await resizeImage(file, {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.85,
        mimeType: file.type === "image/png" ? "image/png" : "image/jpeg",
      });

      setAvatarFile(resizedFile);
      const preview = await createImagePreview(resizedFile);
      setAvatarPreview(preview);
    } catch (error) {
      toast.error("Failed to process image. Please try another file.");
    }
  }
  async function handleAvatarUpload() {
    if (!avatarFile || !token) return;

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("avatar", avatarFile);

      const res = await axios.post(`${API_URL}/users/me/avatar`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      setValue("avatarUrl", res.data.avatarUrl, { shouldDirty: true });
      updateUser({ avatarUrl: res.data.avatarUrl });
      setAvatarFile(null);
      setAvatarPreview("");
      toast.success("Avatar uploaded successfully!");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const message = error.response?.data?.error || "Failed to upload avatar";
      toast.error(message);
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  const onSubmit = async (data: ProfileFormValues) => {
    setIsSaving(true);
    setGeneralError(null);

    try {
      const payload: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
        username: data.username,
        role: data.role,
        skills: data.skills,
        availability: data.availabilityStatus !== "unavailable",
      };
      if (data.email) payload.email = data.email;
      else payload.email = null;
      if (data.bio) payload.bio = data.bio;
      else payload.bio = null;
      if (data.avatarUrl) payload.avatarUrl = data.avatarUrl;
      else payload.avatarUrl = null;

      const res = await axios.put(`${API_URL}/users/me`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      updateUser(res.data);
      reset(data);
      toast.success("Profile updated successfully!");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const message =
        error.response?.data?.error || "Failed to update profile. Please try again.";
      setGeneralError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || isPageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-stellar-blue" />
      </div>
    );
  }

  // ─── 2FA Functions ──────────────────────────────────────────────────────────

  async function handleSetup2FA() {
    setTwoFALoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/2fa/setup`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTwoFASetupData(res.data);
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to setup 2FA.");
    } finally {
      setTwoFALoading(false);
    }
  }

  async function handleVerify2FA(e: React.FormEvent) {
    e.preventDefault();
    setTwoFALoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/2fa/verify`, { code: verifyCode }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTwoFAEnabled(true);
      setTwoFASetupData(null);
      setVerifyCode("");
      if (res.data?.recoveryCodes) {
        setRecoveryCodesPending(res.data.recoveryCodes);
      }
      toast.success("2FA has been enabled successfully!");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Invalid verification code.");
    } finally {
      setTwoFALoading(false);
    }
  }

  async function handleDisable2FA(e: React.FormEvent) {
    e.preventDefault();
    setTwoFALoading(true);
    try {
      await axios.post(`${API_URL}/auth/2fa/disable`, { password: disablePassword }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTwoFAEnabled(false);
      setShowDisableModal(false);
      setDisablePassword("");
      toast.success("2FA has been disabled.");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to disable 2FA.");
    } finally {
      setTwoFALoading(false);
    }
  }

  async function handleRegenerateRecovery(e: React.FormEvent) {
    e.preventDefault();
    setTwoFALoading(true);
    try {
      const res = await axios.post(
        `${API_URL}/auth/2fa/recovery/regenerate`,
        { code: regenerateTotp },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setRecoveryCodesPending(res.data.recoveryCodes);
      setShowRegenerateModal(false);
      setRegenerateTotp("");
      toast.success("Recovery codes regenerated.");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to regenerate recovery codes.");
    } finally {
      setTwoFALoading(false);
    }
  }

  async function handleLinkWallet() {
    if (!token || !user) return;
    setWalletLoading(true);
    try {
      // Ensure a wallet is connected before starting the challenge flow
      if (!address) {
        const connected = await connect();
        if (!connected) {
          toast.error("Select a wallet to link.");
          return;
        }
      }

      // Challenge-response: fetch nonce → sign with wallet → verify on server
      const result = await bindWallet(token);
      if (!result.success) {
        toast.error(result.error ?? "Failed to link wallet.");
        return;
      }

      // Store the refreshed JWT (now carries a verified walletAddress claim)
      if (result.token) {
        localStorage.setItem("stellarmarket_jwt", result.token);
      }

      // Sync user state so the UI reflects the newly bound address
      await refreshUser();
      toast.success("Wallet linked.");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error?.message ?? "Failed to link wallet.");
    } finally {
      setWalletLoading(false);
    }
  }

  async function handleUnlinkWallet() {
    if (!token) return;
    const confirmed = window.confirm("Unlink this wallet from your account?");
    if (!confirmed) return;

    setWalletLoading(true);
    try {
      const res = await axios.delete(`${API_URL}/auth/wallet/link`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      updateUser(res.data.user);
      toast.success("Wallet unlinked.");
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(error.response?.data?.error || "Failed to unlink wallet.");
    } finally {
      setWalletLoading(false);
    }
  }

  function copyRecoveryCodes() {
    if (recoveryCodesPending?.length) {
      navigator.clipboard.writeText(recoveryCodesPending.join("\n"));
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
  }

  if (!user) return null;

  const tabClass = (tab: string) =>
    `pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
      activeSettingsTab === tab
        ? "border-stellar-blue text-stellar-blue"
        : "border-transparent text-theme-text hover:text-theme-heading hover:border-theme-border"
    }`;

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Settings size={28} className="text-stellar-blue" />
          <h1 className="text-3xl font-bold text-theme-heading">Settings</h1>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-6 mb-6 border-b border-theme-border">
          <button className={tabClass("profile")} onClick={() => setActiveSettingsTab("profile")}>
            <span className="flex items-center gap-2">
              <User size={14} />
              Profile
            </span>
          </button>
          <button className={tabClass("security")} onClick={() => setActiveSettingsTab("security")}>
            <span className="flex items-center gap-2">
              <ShieldCheck size={14} />
              Security
            </span>
          </button>
          <button className={tabClass("portfolio")} onClick={() => setActiveSettingsTab("portfolio")}>
            <span className="flex items-center gap-2">
              <Images size={14} />
              Portfolio
            </span>
          </button>
        </div>

        {/* Profile Tab */}
        {activeSettingsTab === "profile" && (
          <form onSubmit={hookFormSubmit(onSubmit)} className="card space-y-6">
            <h2 className="text-xl font-semibold text-theme-heading">Edit Profile</h2>

            {generalError && (
              <div className="bg-theme-error/10 border border-theme-error/20 text-theme-error rounded-lg px-4 py-3 text-sm">
                {generalError}
              </div>
            )}

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-theme-heading mb-2">
                <span className="flex items-center gap-2">
                  <User size={14} />
                  Username
                </span>
              </label>
              <input
                id="username"
                type="text"
                {...register("username", { 
                  required: "Username is required", 
                  minLength: { value: 3, message: "Username must be at least 3 characters." },
                  maxLength: { value: 30, message: "Username must be at most 30 characters." },
                  pattern: { value: /^[a-zA-Z0-9_-]+$/, message: "Username can only contain letters, numbers, hyphens, and underscores." }
                })}
                className="input-field"
                placeholder="Your username"
                aria-describedby={formErrors.username ? "username-error" : undefined}
              />
              {formErrors.username && (
                <p id="username-error" className="text-theme-error text-xs mt-1">
                  {formErrors.username.message}
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-theme-heading mb-2">
                <span className="flex items-center gap-2">
                  <Mail size={14} />
                  Email
                </span>
              </label>
              <input
                id="email"
                type="email"
                {...register("email", {
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Please enter a valid email address." }
                })}
                className="input-field"
                placeholder="your@email.com"
                aria-describedby={formErrors.email ? "email-error" : undefined}
              />
              {formErrors.email && (
                <p id="email-error" className="text-theme-error text-xs mt-1">
                  {formErrors.email.message}
                </p>
              )}
            </div>

            {/* Bio */}
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-theme-heading mb-2">
                <span className="flex items-center gap-2">
                  <FileText size={14} />
                  Bio
                </span>
              </label>
              <textarea
                id="bio"
                {...register("bio", {
                  maxLength: { value: 500, message: "Bio must be at most 500 characters." }
                })}
                className="input-field min-h-[120px] resize-y"
                placeholder="Tell us about yourself..."
                aria-describedby={formErrors.bio ? "bio-error" : "bio-count"}
              />
              <div className="flex justify-between mt-1">
                {formErrors.bio ? (
                  <p id="bio-error" className="text-theme-error text-xs">
                    {formErrors.bio.message}
                  </p>
                ) : (
                  <span />
                )}
                <span id="bio-count" className="text-theme-text text-xs">
                  {(watch("bio") || "").length}/500
                </span>
              </div>
            </div>

            {/* Avatar URL */}
            <div>
              <label htmlFor="avatarUrl" className="block text-sm font-medium text-theme-heading mb-2">
                <span className="flex items-center gap-2">
                  <LinkIcon size={14} />
                  Avatar URL
                </span>
              </label>
              <input
                id="avatarUrl"
                type="url"
                {...register("avatarUrl", {
                  pattern: { value: /^https?:\/\/.+/, message: "Please enter a valid URL." }
                })}
                className="input-field"
                placeholder="https://example.com/avatar.png"
                aria-describedby={formErrors.avatarUrl ? "avatar-error" : undefined}
              />
              {formErrors.avatarUrl && (
                <p id="avatar-error" className="text-theme-error text-xs mt-1">
                  {formErrors.avatarUrl.message}
                </p>
              )}
              {watch("avatarUrl") && !formErrors.avatarUrl && (
                <div className="mt-3 flex items-center gap-3">
                  <Image
                    src={watch("avatarUrl")}
                    alt="Avatar preview"
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full object-cover border border-theme-border"
                    unoptimized
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="text-theme-text text-xs">Preview</span>
                </div>
              )}
            </div>

            {/* Avatar Upload */}
            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                <span className="flex items-center gap-2">
                  <Upload size={14} />
                  Upload Avatar
                </span>
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                  id="avatar-upload"
                />
                <label
                  htmlFor="avatar-upload"
                  className="btn-secondary cursor-pointer flex items-center gap-2 text-sm"
                >
                  <Upload size={16} />
                  Choose File
                </label>
                {avatarFile && (
                  <button
                    type="button"
                    onClick={handleAvatarUpload}
                    disabled={isUploadingAvatar}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isUploadingAvatar ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        Upload
                      </>
                    )}
                  </button>
                )}
              </div>
              {avatarPreview && (
                <div className="mt-3 flex items-center gap-3">
                  <Image
                    src={avatarPreview}
                    alt="Avatar preview"
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full object-cover border border-theme-border"
                    unoptimized
                  />
                  <span className="text-theme-text text-xs">Preview</span>
                </div>
              )}
              <p className="text-theme-text text-xs mt-2">
                Max file size: 5MB. Supported formats: JPG, PNG, GIF
              </p>
            </div>

            {/* Skills */}
            <div>
              <label className="block text-sm font-medium text-theme-heading mb-2">
                Skills
              </label>
              <Controller
                name="skills"
                control={control}
                render={({ field }) => (
                  <SkillCombobox skills={field.value} onChange={field.onChange} />
                )}
              />
              {watch("skills").length === 0 && (
                <p className="text-theme-text text-sm mt-3">No skills added yet</p>
              )}
            </div>

            {/* Role Toggle */}
            <div>
              <label className="block text-sm font-medium text-theme-heading mb-3">
                Role
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setValue("role", "CLIENT", { shouldDirty: true })}
                  className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                    watch("role") === "CLIENT"
                      ? "bg-stellar-blue/20 border-stellar-blue text-stellar-blue"
                      : "bg-theme-card border-theme-border text-theme-text hover:border-theme-text"
                  }`}
                  aria-pressed={watch("role") === "CLIENT"}
                >
                  Client
                </button>
                <button
                  type="button"
                  onClick={() => setValue("role", "FREELANCER", { shouldDirty: true })}
                  className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                    watch("role") === "FREELANCER"
                      ? "bg-stellar-purple/20 border-stellar-purple text-stellar-purple"
                      : "bg-theme-card border-theme-border text-theme-text hover:border-theme-text"
                  }`}
                  aria-pressed={watch("role") === "FREELANCER"}
                >
                  Freelancer
                </button>
              </div>
            </div>

            {/* Availability Status (freelancers only) */}
            {watch("role") === "FREELANCER" && (
              <div>
                <label className="block text-sm font-medium text-theme-heading mb-3">
                  Availability Status
                </label>
                <div className="flex gap-3">
                  {(["available", "busy", "unavailable"] as const).map((status) => {
                    const config = {
                      available: { label: "Available", active: "bg-green-500/20 border-green-500 text-green-600 dark:text-green-400" },
                      busy: { label: "Busy", active: "bg-amber-400/20 border-amber-400 text-amber-600 dark:text-amber-400" },
                      unavailable: { label: "Unavailable", active: "bg-gray-400/20 border-gray-400 text-gray-500" },
                    }[status];
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setValue("availabilityStatus", status, { shouldDirty: true })}
                        className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                          watch("availabilityStatus") === status
                            ? config.active
                            : "bg-theme-card border-theme-border text-theme-text hover:border-theme-text"
                        }`}
                        aria-pressed={watch("availabilityStatus") === status}
                      >
                        {config.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-theme-text mt-2">
                  Clients can see your availability status on your profile and job applications.
                </p>
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </form>
        )}

        <UnsavedChangesModal 
          isOpen={showModal} 
          onConfirm={confirmLeave} 
          onCancel={cancelLeave} 
        />

        {/* Security Tab */}
        {activeSettingsTab === "security" && (
          <div className="card space-y-6">
            <h2 className="text-xl font-semibold text-dark-heading flex items-center gap-2">
              <ShieldCheck size={20} />
              Security
            </h2>

            <div className="rounded-lg border border-theme-border bg-theme-bg p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-theme-heading">
                    <Wallet size={16} />
                    Authentication methods
                  </h3>
                  <p className="text-xs text-theme-text">Keep at least one sign-in method connected.</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-2 rounded-lg border border-theme-border bg-theme-card p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-theme-heading">Email</p>
                    <p className="text-xs text-theme-text">
                      {user?.authMethods?.email || user?.email ? user.email : "No email login linked"}
                    </p>
                  </div>
                  <span className={`w-fit rounded-full border px-2.5 py-1 text-xs ${
                    user?.authMethods?.email || user?.email
                      ? "border-theme-success/30 bg-theme-success/10 text-theme-success"
                      : "border-theme-warning/30 bg-theme-warning/10 text-theme-warning"
                  }`}>
                    {user?.authMethods?.email || user?.email ? "Linked" : "Not linked"}
                  </span>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-theme-border bg-theme-card p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-theme-heading">Wallet</p>
                    <WalletAddress address={user?.walletAddress} className="mt-1" />
                  </div>
                  {user?.walletAddress ? (
                    <button
                      type="button"
                      onClick={handleUnlinkWallet}
                      disabled={walletLoading}
                      className="w-fit rounded-lg border border-theme-error/50 px-3 py-2 text-sm text-theme-error hover:bg-theme-error/10 disabled:opacity-60"
                    >
                      {walletLoading ? "Updating..." : "Unlink"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleLinkWallet}
                      disabled={walletLoading || isConnecting}
                      className="btn-primary flex w-fit items-center gap-2 text-sm disabled:opacity-60"
                    >
                      {walletLoading || isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
                      Link wallet
                    </button>
                  )}
                </div>
              </div>
            </div>

            {recoveryCodesPending && recoveryCodesPending.length > 0 ? (
              <div className="space-y-4 rounded-lg border border-theme-warning/40 bg-theme-warning/10 p-4">
                <p className="text-theme-warning text-sm font-medium">
                  Save these recovery codes now. Each code works once instead of your authenticator at login. They will not be shown again.
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-dark-muted text-xs">Recovery codes</p>
                  <button
                    type="button"
                    onClick={copyRecoveryCodes}
                    className="flex items-center gap-1 text-xs text-stellar-blue hover:underline shrink-0"
                  >
                    {copiedRecovery ? <Check size={12} /> : <Copy size={12} />}
                    {copiedRecovery ? "Copied!" : "Copy all"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {recoveryCodesPending.map((code, i) => (
                    <code
                      key={i}
                      className="block p-2 bg-dark-bg border border-dark-border rounded text-center text-sm text-dark-text font-mono"
                    >
                      {code}
                    </code>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRecoveryCodesPending(null)}
                  className="btn-primary text-sm"
                >
                  I have stored my recovery codes safely
                </button>
              </div>
            ) : twoFAEnabled && !twoFASetupData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-theme-success/10 border border-theme-success/30 rounded-lg">
                  <ShieldCheck size={20} className="text-theme-success" />
                  <p className="text-theme-success text-sm">Two-factor authentication is enabled.</p>
                </div>

                {showRegenerateModal ? (
                  <form onSubmit={handleRegenerateRecovery} className="space-y-3 rounded-lg border border-dark-border p-4">
                    <p className="text-dark-muted text-sm">
                      Enter a 6-digit code from your authenticator. This replaces all existing recovery codes.
                    </p>
                    <input
                      type="text"
                      value={regenerateTotp}
                      onChange={(e) => setRegenerateTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="input-field text-center tracking-widest"
                      placeholder="000000"
                      maxLength={6}
                      required
                      autoComplete="one-time-code"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={twoFALoading || regenerateTotp.length !== 6}
                        className="flex items-center gap-2 px-4 py-2 bg-stellar-blue hover:bg-stellar-blue/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {twoFALoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                        Generate new codes
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowRegenerateModal(false); setRegenerateTotp(""); }}
                        className="px-4 py-2 border border-dark-border text-dark-text rounded-lg text-sm hover:bg-dark-bg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : showDisableModal ? (
                  <form onSubmit={handleDisable2FA} className="space-y-3">
                    <p className="text-dark-muted text-sm">Enter your password to disable 2FA:</p>
                    <input
                      type="password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      className="input-field"
                      placeholder="Your password"
                      required
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={twoFALoading}
                        className="flex items-center gap-2 px-4 py-2 bg-theme-error hover:bg-theme-error/80 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {twoFALoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                        Confirm Disable
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowDisableModal(false); setDisablePassword(""); }}
                        className="px-4 py-2 border border-dark-border text-dark-text rounded-lg text-sm hover:bg-dark-bg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRegenerateModal(true)}
                      className="flex items-center gap-2 px-4 py-2 border border-stellar-blue/50 text-stellar-blue rounded-lg text-sm hover:bg-stellar-blue/10 transition-colors"
                    >
                      <ShieldCheck size={14} />
                      Regenerate recovery codes
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDisableModal(true)}
                      className="flex items-center gap-2 px-4 py-2 border border-theme-error/50 text-theme-error rounded-lg text-sm hover:bg-theme-error/10 transition-colors"
                    >
                      <ShieldOff size={14} />
                      Disable 2FA
                    </button>
                  </div>
                )}
              </div>
            ) : twoFASetupData ? (
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-dark-muted text-sm mb-4">
                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                  </p>
                  <img
                    src={twoFASetupData.qrCode}
                    alt="2FA QR Code"
                    className="mx-auto w-48 h-48 rounded-lg border border-dark-border"
                  />
                </div>

                <div>
                  <p className="text-dark-muted text-xs mb-1">Manual entry key:</p>
                  <code className="block p-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text break-all">
                    {twoFASetupData.secret}
                  </code>
                </div>

                <p className="text-dark-muted text-xs">
                  After you verify with a 6-digit app code, you will receive one-time recovery codes to download or copy. Store them offline.
                </p>

                <form onSubmit={handleVerify2FA} className="space-y-3">
                  <label className="block text-sm font-medium text-dark-heading">
                    Enter a code from your authenticator app to verify:
                  </label>
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    className="input-field text-center tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={twoFALoading || verifyCode.length !== 6}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {twoFALoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                      Verify &amp; Enable
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTwoFASetupData(null); setVerifyCode(""); }}
                      className="px-4 py-2 border border-dark-border text-dark-text rounded-lg text-sm hover:bg-dark-bg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-dark-muted text-sm">
                  Add an extra layer of security to your account by enabling two-factor authentication with an authenticator app.
                </p>
                <button
                  onClick={handleSetup2FA}
                  disabled={twoFALoading}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {twoFALoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  Enable 2FA
                </button>
              </div>
            )}
          </div>
        )}

        {/* Portfolio Tab */}
        {activeSettingsTab === "portfolio" && (
          <div className="space-y-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-theme-heading flex items-center gap-2">
                    <Images size={20} />
                    Portfolio
                  </h2>
                  <p className="text-sm text-theme-text mt-1">
                    Showcase your best work. Up to {PORTFOLIO_MAX_ITEMS} items &middot; max 5MB each (JPG, PNG, GIF, WebP, PDF).
                  </p>
                </div>
                <span className="text-sm text-theme-text">
                  {portfolioItems.length}/{PORTFOLIO_MAX_ITEMS}
                </span>
              </div>

              {portfolioLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-stellar-blue" />
                </div>
              ) : portfolioItems.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-theme-border rounded-xl">
                  <ImageIcon size={40} className="mx-auto mb-3 text-theme-text opacity-40" />
                  <p className="text-theme-text text-sm">No portfolio items yet.</p>
                  <p className="text-theme-text text-xs mt-1">Upload images or PDFs to showcase your work.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {portfolioItems.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(item.id)}
                      onDragOver={(e) => handleDragOver(e, item.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={() => handleDrop(item.id)}
                      className={`flex gap-3 p-3 rounded-xl border transition-colors ${
                        dragOverId === item.id
                          ? "border-stellar-blue bg-stellar-blue/5"
                          : "border-theme-border bg-theme-card"
                      } ${dragItemId === item.id ? "opacity-50" : ""}`}
                    >
                      {/* Drag handle */}
                      <div className="flex-shrink-0 flex items-center text-theme-text cursor-grab active:cursor-grabbing">
                        <GripVertical size={18} />
                      </div>

                      {/* Thumbnail */}
                      <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-theme-bg border border-theme-border flex items-center justify-center">
                        {item.mimeType.startsWith("image/") ? (
                          <Image
                            src={`${BASE_URL}${item.fileUrl}`}
                            alt={item.title}
                            width={64}
                            height={64}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <FileText size={24} className="text-theme-text opacity-60" />
                        )}
                      </div>

                      {/* Info / edit */}
                      <div className="flex-1 min-w-0">
                        {editingItemId === item.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="input-field text-sm py-1"
                              placeholder="Title"
                              maxLength={100}
                            />
                            <textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="input-field text-sm py-1 resize-none"
                              placeholder="Description (optional)"
                              maxLength={500}
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveItemEdit(item.id)}
                                className="btn-primary text-xs py-1 px-3"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingItemId(null)}
                                className="btn-secondary text-xs py-1 px-3"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="font-medium text-theme-heading text-sm truncate">{item.title}</p>
                            {item.description && (
                              <p className="text-theme-text text-xs mt-0.5 line-clamp-2">{item.description}</p>
                            )}
                            <p className="text-theme-text text-xs mt-1 opacity-60">{item.fileName}</p>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      {editingItemId !== item.id && (
                        <div className="flex-shrink-0 flex items-start gap-1">
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            className="p-1.5 text-theme-text hover:text-stellar-blue transition-colors rounded"
                            title="Edit"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePortfolioDelete(item.id)}
                            className="p-1.5 text-theme-text hover:text-theme-error transition-colors rounded"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Upload button */}
              {portfolioItems.length < PORTFOLIO_MAX_ITEMS && (
                <div className="mt-4">
                  <input
                    ref={portfolioFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                    onChange={handlePortfolioFileChange}
                    className="hidden"
                    id="portfolio-upload"
                  />
                  <label
                    htmlFor="portfolio-upload"
                    className={`btn-secondary cursor-pointer flex items-center gap-2 text-sm w-full justify-center py-3 border-dashed ${isUploadingPortfolio ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    {isUploadingPortfolio ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        Add Portfolio Item
                      </>
                    )}
                  </label>
                </div>
              )}

              {portfolioItems.length > 1 && (
                <p className="text-theme-text text-xs mt-3 text-center opacity-60">
                  Drag items to reorder them on your profile.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
