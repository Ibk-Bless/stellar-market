"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Star,
  Briefcase,
  User,
  ExternalLink,
  ShieldCheck,
  Calendar,
  Edit,
  Award,
  Info,
  CheckCircle2,
  AlertCircle,
  FileText,
  Images,
  UserPlus,
} from "lucide-react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { UserProfile, PortfolioItem, BadgeTier, PlatformConfig } from "@/types";
import Link from "next/link";
import Image from "next/image";
import Skeleton from "@/components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { ContractService, ReputationResult, DEFAULT_BADGE_TIERS } from "@/services/ContractService";
import ShareMenu from "@/components/ShareMenu";
import ProfileSkeleton from "@/components/skeletons/ProfileSkeleton";
import WalletAddress from "@/components/WalletAddress";
import InviteToJobModal from "@/components/InviteToJobModal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
// Base URL without /api for serving static files
const BASE_URL = API_URL.replace(/\/api\/?$/, "");

export default function ProfileClient() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "reviews" | "clientJobs" | "freelancerJobs"
  >("reviews");

  const [reputationLoading, setReputationLoading] = useState(false);
  const [reputation, setReputation] = useState<ReputationResult | null>(null);

  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [lightboxItem, setLightboxItem] = useState<PortfolioItem | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_URL}/users/${id}`);
        setProfile(response.data);
      } catch (err) {
        console.error("Fetch profile error:", err);
        setError((err as Error).message || "Failed to load user profile.");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchProfile();
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    axios
      .get(`${API_URL}/portfolio/user/${id}`)
      .then((res) => setPortfolioItems(res.data.items ?? []))
      .catch(() => setPortfolioItems([]));
  }, [id]);

  const { data: badgeTiers } = useQuery<BadgeTier[]>({
    queryKey: ["badgeTiers"],
    queryFn: async () => {
      const res = await axios.get<PlatformConfig>(`${API_URL}/platform/config`);
      return res.data.badgeTiers;
    },
    staleTime: 3_600_000,
    placeholderData: DEFAULT_BADGE_TIERS,
  });

  useEffect(() => {
    const fetchReputation = async () => {
      if (!profile?.walletAddress) {
        setReputation(null);
        return;
      }

      try {
        setReputationLoading(true);
        const result = await ContractService.getReputation(profile.walletAddress, badgeTiers);
        setReputation(result);
      } catch (err) {
        console.error("Fetch reputation error:", err);
        setReputation(null);
      } finally {
        setReputationLoading(false);
      }
    };

    fetchReputation();
  }, [profile?.walletAddress, badgeTiers]);

  const isOwnProfile = currentUser && profile && currentUser.id === profile.id;
  // A client viewing another user's freelancer profile gets a hiring CTA.
  const canInvite =
    !!currentUser &&
    !!profile &&
    !isOwnProfile &&
    currentUser.role === "CLIENT" &&
    profile.role === "FREELANCER";

  if (loading) {
    return <ProfileSkeleton />;
  }

  if (error || !profile) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <h2 className="text-2xl font-bold text-theme-heading mb-4">
          Profile Not Found
        </h2>
        <p className="text-theme-text mb-8">
          {error || "The user you are looking for does not exist."}
        </p>
        <Link href="/jobs" className="btn-primary inline-block">
          Browse Jobs
        </Link>
      </div>
    );
  }

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            size={16}
            className={
              s <= rating
                ? "fill-theme-warning text-theme-warning"
                : "text-theme-border"
            }
          />
        ))}
      </div>
    );
  };

  const getProfileCompleteness = (prof: UserProfile) => {
    const steps = [
      { label: "Profile Photo", value: !!prof.avatarUrl, weight: 20 },
      { label: "Bio", value: !!prof.bio, weight: 20 },
      { label: "Skills", value: prof.skills && prof.skills.length > 0, weight: 20 },
      { label: "Email Address", value: !!prof.email, weight: 10 },
      { label: "Email Verified", value: !!prof.emailVerified, weight: 10 },
      { label: "Availability", value: prof.availability !== undefined, weight: 10 },
      { label: "On-chain Identity", value: !!prof.walletAddress, weight: 10 },
    ];

    const completedWeight = steps
      .filter((s) => s.value)
      .reduce((acc, s) => acc + s.weight, 0);

    return {
      percentage: completedWeight,
      steps: steps,
    };
  };

  const completeness = getProfileCompleteness(profile);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row gap-8 items-start mb-12">
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex-shrink-0 flex items-center justify-center text-4xl overflow-hidden border-4 border-theme-card shadow-xl">
          {profile.avatarUrl ? (
            <Image
              src={profile.avatarUrl}
              alt={profile.username}
              width={128}
              height={128}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <User size={64} className="text-white/50" />
          )}
        </div>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h1 className="text-4xl font-bold text-theme-heading">
              {profile.username}
            </h1>
            <span className="text-sm font-medium text-stellar-purple bg-stellar-purple/10 px-3 py-1 rounded-full border border-stellar-purple/20">
              {profile.role}
            </span>
            {profile.role === "FREELANCER" && (() => {
              const avail = profile.availability;
              const label = avail === false ? "Unavailable" : "Available";
              const cls = avail === false
                ? "bg-gray-400/20 border-gray-400/40 text-gray-500"
                : "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400";
              return (
                <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${cls}`}>
                  {label}
                </span>
              );
            })()}
            {isOwnProfile && (
              <Link
                href="/settings"
                className="ml-auto btn-secondary flex items-center gap-2 text-sm"
              >
                <Edit size={16} />
                Edit Profile
              </Link>
            )}
            {canInvite && (
              <button
                type="button"
                onClick={() => setInviteModalOpen(true)}
                className="ml-auto btn-primary flex items-center gap-2 text-sm"
              >
                <UserPlus size={16} />
                Invite to Job
              </button>
            )}
            <ShareMenu
              title={profile.username}
              url={`/profile/${profile.id}`}
              description={`Check out ${profile.username}'s profile on StellarMarket`}
            />
          </div>

          <p className="text-lg text-theme-text mb-4 max-w-2xl">
            {profile.bio || "No bio yet"}
          </p>

          {profile.skills && profile.skills.length > 0 ? (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-theme-heading mb-2">Skills</h3>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-theme-card border border-theme-border rounded-full text-sm text-theme-text"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-theme-text mb-6">No skills listed</p>
          )}

          <div className="flex flex-wrap gap-6 text-sm text-theme-text">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-stellar-blue" />
              <WalletAddress address={profile.walletAddress} />
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-stellar-blue" />
              Member since{" "}
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </div>
            <div className="flex items-center gap-2">
              {renderStars(profile.averageRating)}
              <span className="text-theme-heading font-medium">
                {profile.averageRating.toFixed(1)}/5
              </span>
              <span>&middot;</span>
              <span>
                {profile.reviewCount}{" "}
                {profile.reviewCount === 1 ? "review" : "reviews"}
              </span>
            </div>
          </div>

          <div className="mt-6 card">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-theme-heading">
                  On-chain Reputation
                </h3>
                <div
                  className="inline-flex items-center gap-1 text-sm text-theme-text mt-1"
                  title="Calculated from Soroban contract review data using weighted on-chain reputation."
                >
                  <Info size={14} />
                  <span>How score is calculated</span>
                </div>
              </div>

              {!reputationLoading && reputation && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-stellar-purple/20 bg-stellar-purple/10 text-stellar-purple text-sm font-medium">
                  <Award size={14} />
                  {reputation.badgeTier}
                </span>
              )}
            </div>

            {!profile.walletAddress ? (
              <p className="text-theme-text text-sm">No on-chain score yet</p>
            ) : reputationLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : reputation ? (
              <div>
                <div className="flex items-center gap-2">
                  <Star className="text-theme-warning fill-theme-warning" size={20} />
                  <span className="text-2xl font-bold text-theme-heading">
                    {reputation.score.toFixed(1)} / 5
                  </span>
                </div>
                <p className="mt-2 text-sm text-theme-text">
                  Based on {reputation.reviewCount} on-chain{" "}
                  {reputation.reviewCount === 1 ? "review" : "reviews"}.
                </p>
              </div>
            ) : (
              <p className="text-theme-text text-sm">No on-chain score yet</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="space-y-6">
          {isOwnProfile && completeness.percentage < 100 && (
            <div className="card border-stellar-blue/30 bg-stellar-blue/5">
              <h3 className="text-lg font-semibold text-theme-heading mb-2 flex items-center justify-between">
                Profile Completeness
                <span className="text-stellar-blue font-bold">
                  {completeness.percentage}%
                </span>
              </h3>
              <div className="w-full bg-theme-border rounded-full h-2.5 mb-4 overflow-hidden">
                <div
                  className="bg-stellar-blue h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${completeness.percentage}%` }}
                ></div>
              </div>
              <p className="text-sm text-theme-text mb-4">
                Complete your profile to increase trust and visibility.
              </p>
              <ul className="space-y-2">
                {completeness.steps
                  .filter((s) => !s.value)
                  .map((step, idx) => (
                    <li
                      key={idx}
                      className="text-xs flex items-center gap-2 text-theme-text"
                    >
                      <AlertCircle size={14} className="text-theme-warning" />
                      Add {step.label}
                    </li>
                  ))}
              </ul>
              <Link
                href="/settings"
                className="mt-4 block text-center py-2 px-4 bg-stellar-blue text-white rounded-lg text-sm font-medium hover:bg-stellar-blue/90 transition-colors"
              >
                Complete Profile
              </Link>
            </div>
          )}

          <div className="card">
            <h3 className="text-lg font-semibold text-theme-heading mb-4">
              Stats
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-theme-bg rounded-lg border border-theme-border">
                <span className="text-theme-text flex items-center gap-2">
                  <Briefcase size={18} className="text-stellar-purple" /> Jobs
                  Completed
                </span>
                <span className="text-theme-heading font-bold">
                  {profile.clientJobs.length + profile.freelancerJobs.length}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-theme-bg rounded-lg border border-theme-border">
                <span className="text-theme-text flex items-center gap-2">
                  <Star size={18} className="text-theme-warning" /> Reputation
                </span>
                <span className="text-theme-heading font-bold">
                  {reputation ? reputation.badgeTier : "No score yet"}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-theme-heading mb-4">
              Verified
            </h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-sm text-theme-text">
                <ShieldCheck size={18} className="text-theme-success" /> Wallet
                Verified
              </li>
              <li className="flex items-center gap-3 text-sm text-theme-text">
                <ShieldCheck size={18} className="text-theme-success" /> Email
                Verified
              </li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex gap-8 mb-8 border-b border-theme-border overflow-x-auto pb-px">
            <button
              onClick={() => setActiveTab("reviews")}
              className={`pb-4 transition-all relative font-medium whitespace-nowrap ${
                activeTab === "reviews"
                  ? "text-stellar-blue"
                  : "text-theme-text hover:text-theme-heading"
              }`}
            >
              Reviews ({profile.reviewCount})
              {activeTab === "reviews" && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-stellar-blue rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("freelancerJobs")}
              className={`pb-4 transition-all relative font-medium whitespace-nowrap ${
                activeTab === "freelancerJobs"
                  ? "text-stellar-blue"
                  : "text-theme-text hover:text-theme-heading"
              }`}
            >
              Completed as Freelancer ({profile.freelancerJobs.length})
              {activeTab === "freelancerJobs" && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-stellar-blue rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("clientJobs")}
              className={`pb-4 transition-all relative font-medium whitespace-nowrap ${
                activeTab === "clientJobs"
                  ? "text-stellar-blue"
                  : "text-theme-text hover:text-theme-heading"
              }`}
            >
              Completed as Client ({profile.clientJobs.length})
              {activeTab === "clientJobs" && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-stellar-blue rounded-full" />
              )}
            </button>
          </div>

          <div className="space-y-6">
            {activeTab === "reviews" &&
              (profile.reviewsReceived.length > 0 ? (
                profile.reviewsReceived.map((review) => (
                  <div key={review.id} className="card">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex-shrink-0" />
                        <div>
                          <div className="font-semibold text-theme-heading">
                            {review.reviewer.username}
                          </div>
                          <div className="text-xs text-theme-text">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      {renderStars(review.rating)}
                    </div>
                    <p className="text-theme-text text-sm italic">
                      &quot;{review.comment}&quot;
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-20 text-theme-text bg-theme-card/30 rounded-2xl border border-dashed border-theme-border">
                  No reviews yet.
                </div>
              ))}

            {activeTab === "freelancerJobs" &&
              (profile.freelancerJobs.length > 0 ? (
                profile.freelancerJobs.map((job) => (
                  <div
                    key={job.id}
                    className="card hover:border-stellar-blue/30 transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-bold text-theme-heading mb-1">
                          {job.title}
                        </h4>
                        <div className="text-sm text-theme-text">
                          {job.category} &middot;{" "}
                          {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-stellar-blue hover:underline flex items-center gap-1 text-sm font-medium"
                      >
                        View Case <ExternalLink size={14} />
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-20 text-theme-text bg-theme-card/30 rounded-2xl border border-dashed border-theme-border">
                  No completed jobs as a freelancer.
                </div>
              ))}

            {activeTab === "clientJobs" &&
              (profile.clientJobs.length > 0 ? (
                profile.clientJobs.map((job) => (
                  <div
                    key={job.id}
                    className="card hover:border-stellar-blue/30 transition-colors"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-bold text-theme-heading mb-1">
                          {job.title}
                        </h4>
                        <div className="text-sm text-theme-text">
                          {job.category} &middot;{" "}
                          {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-stellar-blue hover:underline flex items-center gap-1 text-sm font-medium"
                      >
                        View Project <ExternalLink size={14} />
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-20 text-theme-text bg-theme-card/30 rounded-2xl border border-dashed border-theme-border">
                  No projects completed as a client.
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Portfolio Gallery - shown for freelancers with items */}
      {profile.role === "FREELANCER" && portfolioItems.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <h2 className="text-2xl font-bold text-theme-heading mb-6 flex items-center gap-2">
            <Images size={22} />
            Portfolio
          </h2>
          <div className="columns-1 sm:columns-2 md:columns-3 gap-4 space-y-4">
            {portfolioItems.map((item) => (
              <div
                key={item.id}
                className="break-inside-avoid rounded-xl overflow-hidden border border-theme-border bg-theme-card cursor-pointer hover:border-stellar-blue/40 transition-colors group"
                onClick={() => setLightboxItem(item)}
              >
                {item.mimeType.startsWith("image/") ? (
                  <Image
                    src={`${BASE_URL}${item.fileUrl}`}
                    alt={item.title}
                    width={400}
                    height={300}
                    className="w-full object-cover group-hover:opacity-90 transition-opacity"
                    unoptimized
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 px-4">
                    <FileText size={40} className="text-theme-text opacity-50 mb-3" />
                    <p className="text-theme-text text-xs text-center">{item.fileName}</p>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium text-theme-heading text-sm">{item.title}</p>
                  {item.description && (
                    <p className="text-theme-text text-xs mt-1 line-clamp-2">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-theme-card rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxItem(null)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
            {lightboxItem.mimeType.startsWith("image/") ? (
              <Image
                src={`${BASE_URL}${lightboxItem.fileUrl}`}
                alt={lightboxItem.title}
                width={1200}
                height={900}
                className="w-full max-h-[70vh] object-contain"
                unoptimized
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-8">
                <FileText size={64} className="text-theme-text opacity-50 mb-4" />
                <p className="text-theme-heading font-medium text-lg mb-2">{lightboxItem.title}</p>
                <p className="text-theme-text text-sm mb-4">{lightboxItem.fileName}</p>
                <a
                  href={`${BASE_URL}${lightboxItem.fileUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex items-center gap-2"
                >
                  <ExternalLink size={16} />
                  Open PDF
                </a>
              </div>
            )}
            <div className="p-4 border-t border-theme-border">
              <p className="font-semibold text-theme-heading">{lightboxItem.title}</p>
              {lightboxItem.description && (
                <p className="text-theme-text text-sm mt-1">{lightboxItem.description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {canInvite && profile && (
        <InviteToJobModal
          freelancerId={profile.id}
          freelancerName={profile.username}
          isOpen={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
        />
      )}
    </div>
  );
}
