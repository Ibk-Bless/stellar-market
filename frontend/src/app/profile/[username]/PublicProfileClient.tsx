"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Award,
  Briefcase,
  Calendar,
  ExternalLink,
  FileText,
  Images,
  Star,
  User,
} from "lucide-react";
import { useState } from "react";
import ShareMenu from "@/components/ShareMenu";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const BASE_URL = API_URL.replace(/\/api\/?$/, "");

type Review = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  reviewer: { id: string; username: string; avatarUrl: string | null };
};

type PortfolioItem = {
  id: string;
  title: string;
  description?: string | null;
  fileUrl: string;
  fileName: string;
  mimeType: string;
};

type Job = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
};

type PublicProfile = {
  id: string;
  username: string;
  bio?: string | null;
  avatarUrl?: string | null;
  role: string;
  skills: string[];
  averageRating: number;
  reviewCount: number;
  createdAt: string;
  reviewsReceived: Review[];
  freelancerJobs: Job[];
  portfolioItems: PortfolioItem[];
};

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={14}
          className={s <= rating ? "fill-yellow-400 text-yellow-400" : "text-theme-border"}
        />
      ))}
    </div>
  );
}

export default function PublicProfileClient({ profile }: { profile: PublicProfile }) {
  const [lightbox, setLightbox] = useState<PortfolioItem | null>(null);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row gap-6 items-start mb-10">
        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex-shrink-0 flex items-center justify-center overflow-hidden border-4 border-theme-card shadow-xl">
          {profile.avatarUrl ? (
            <Image
              src={profile.avatarUrl}
              alt={profile.username}
              width={112}
              height={112}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <User size={56} className="text-white/50" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h1 className="text-3xl font-bold text-theme-heading truncate">{profile.username}</h1>
            <span className="text-xs font-medium text-stellar-purple bg-stellar-purple/10 px-2.5 py-1 rounded-full border border-stellar-purple/20">
              {profile.role}
            </span>
            <ShareMenu
              title={`${profile.username} on StellarMarket`}
              url={`/profile/${profile.username}`}
              description={`Check out ${profile.username}'s freelancer profile on StellarMarket`}
            />
          </div>

          <p className="text-base text-theme-text mb-4 max-w-2xl">
            {profile.bio || "No bio provided."}
          </p>

          {profile.skills.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {profile.skills.map((s, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-theme-card border border-theme-border rounded-full text-xs text-theme-text"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-5 text-sm text-theme-text">
            <div className="flex items-center gap-1.5">
              <StarRow rating={Math.round(profile.averageRating)} />
              <span className="font-semibold text-theme-heading ml-1">
                {profile.averageRating.toFixed(1)}
              </span>
              <span className="text-theme-text/60">
                ({profile.reviewCount} {profile.reviewCount === 1 ? "review" : "reviews"})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar size={15} className="text-stellar-blue" />
              Member since{" "}
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* ── Sidebar ── */}
        <aside className="space-y-6">
          <div className="card">
            <h2 className="text-base font-semibold text-theme-heading mb-3 flex items-center gap-2">
              <Briefcase size={16} className="text-stellar-purple" />
              Stats
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-theme-text">Jobs completed</span>
                <span className="font-semibold text-theme-heading">
                  {profile.freelancerJobs.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-text">Average rating</span>
                <span className="font-semibold text-theme-heading">
                  {profile.averageRating.toFixed(1)} / 5
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-theme-heading mb-3 flex items-center gap-2">
              <Award size={16} className="text-stellar-blue" />
              Hire this freelancer
            </h2>
            <p className="text-sm text-theme-text mb-4">
              Create a free account to post a job and invite {profile.username} to apply.
            </p>
            <Link
              href="/auth/register"
              className="btn-primary block text-center text-sm py-2 px-4"
            >
              Get started
            </Link>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="lg:col-span-2 space-y-10">
          {/* Reviews */}
          <section aria-labelledby="reviews-heading">
            <h2
              id="reviews-heading"
              className="text-xl font-semibold text-theme-heading mb-4 flex items-center gap-2"
            >
              <Star size={18} className="text-yellow-400 fill-yellow-400" />
              Reviews ({profile.reviewsReceived.length})
            </h2>
            {profile.reviewsReceived.length > 0 ? (
              <div className="space-y-4">
                {profile.reviewsReceived.map((r) => (
                  <div key={r.id} className="card">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex-shrink-0" />
                        <span className="font-medium text-theme-heading text-sm">
                          {r.reviewer.username}
                        </span>
                        <span className="text-xs text-theme-text/60">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <StarRow rating={r.rating} />
                    </div>
                    <p className="text-sm text-theme-text italic">&quot;{r.comment}&quot;</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-theme-text/60 py-8 text-center border border-dashed border-theme-border rounded-xl">
                No reviews yet.
              </p>
            )}
          </section>

          {/* Past work */}
          {profile.freelancerJobs.length > 0 && (
            <section aria-labelledby="past-work-heading">
              <h2
                id="past-work-heading"
                className="text-xl font-semibold text-theme-heading mb-4 flex items-center gap-2"
              >
                <Briefcase size={18} className="text-stellar-purple" />
                Completed projects
              </h2>
              <div className="space-y-3">
                {profile.freelancerJobs.map((job) => (
                  <div key={job.id} className="card hover:border-stellar-blue/30 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-semibold text-theme-heading text-sm">{job.title}</p>
                        <p className="text-xs text-theme-text/70 mt-0.5">
                          {job.category} ·{" "}
                          {new Date(job.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="text-stellar-blue hover:underline flex items-center gap-1 text-xs font-medium"
                      >
                        View <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── Portfolio ── */}
      {profile.portfolioItems.length > 0 && (
        <section aria-labelledby="portfolio-heading" className="mt-12">
          <h2
            id="portfolio-heading"
            className="text-xl font-semibold text-theme-heading mb-6 flex items-center gap-2"
          >
            <Images size={18} />
            Portfolio
          </h2>
          <div className="columns-1 sm:columns-2 md:columns-3 gap-4 space-y-4">
            {profile.portfolioItems.map((item) => (
              <div
                key={item.id}
                className="break-inside-avoid rounded-xl overflow-hidden border border-theme-border bg-theme-card cursor-pointer hover:border-stellar-blue/40 transition-colors"
                onClick={() => setLightbox(item)}
                role="button"
                tabIndex={0}
                aria-label={`View portfolio item: ${item.title}`}
                onKeyDown={(e) => e.key === "Enter" && setLightbox(item)}
              >
                {item.mimeType.startsWith("image/") ? (
                  <Image
                    src={`${BASE_URL}${item.fileUrl}`}
                    alt={item.title}
                    width={400}
                    height={300}
                    className="w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 px-4">
                    <FileText size={36} className="text-theme-text/40 mb-2" />
                    <p className="text-xs text-theme-text text-center">{item.fileName}</p>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium text-theme-heading text-sm">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-theme-text/70 mt-1 line-clamp-2">
                      {item.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Portfolio item: ${lightbox.title}`}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-theme-card rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              aria-label="Close portfolio lightbox"
            >
              ✕
            </button>
            {lightbox.mimeType.startsWith("image/") ? (
              <Image
                src={`${BASE_URL}${lightbox.fileUrl}`}
                alt={lightbox.title}
                width={1200}
                height={900}
                className="w-full max-h-[70vh] object-contain"
                unoptimized
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-8">
                <FileText size={56} className="text-theme-text/40 mb-4" />
                <p className="text-theme-heading font-medium text-lg mb-2">{lightbox.title}</p>
                <p className="text-theme-text text-sm mb-4">{lightbox.fileName}</p>
                <a
                  href={`${BASE_URL}${lightbox.fileUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex items-center gap-2"
                >
                  <ExternalLink size={14} />
                  Open file
                </a>
              </div>
            )}
            <div className="p-4 border-t border-theme-border">
              <p className="font-semibold text-theme-heading">{lightbox.title}</p>
              {lightbox.description && (
                <p className="text-theme-text text-sm mt-1">{lightbox.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
