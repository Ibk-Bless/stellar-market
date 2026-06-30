import React, { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProfileShell from "./ProfileShell";
import ProfileHeader from "./ProfileHeader.server";
import JobHistory from "./JobHistory.server";
import ReputationPanel from "./ReputationPanel.server";
import ReviewsSection from "./ReviewsSection.server";
import PortfolioSection from "./PortfolioSection.server";
import EarningsSummary from "./EarningsSummary.server";
import HeaderSkeleton from "./skeletons/HeaderSkeleton";
import JobsSkeleton from "./skeletons/JobsSkeleton";
import ReputationSkeleton from "./skeletons/ReputationSkeleton";
import ReviewsSkeleton from "./skeletons/ReviewsSkeleton";
import PortfolioSkeleton from "./skeletons/PortfolioSkeleton";
import EarningsSkeleton from "./skeletons/EarningsSkeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

async function getPublicUser(username: string) {
  const res = await fetch(`${API_URL}/users/public/${encodeURIComponent(username)}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicUser(username);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io";
  const canonical = `${baseUrl}/u/${username}`;

  if (!profile) {
    return {
      title: "Profile Not Found | StellarMarket",
      description: "The requested freelancer profile could not be found.",
      alternates: { canonical },
    };
  }

  const title = `${profile.username} — Freelancer | StellarMarket`;
  const description =
    profile.bio?.substring(0, 160) ||
    `Hire ${profile.username} on StellarMarket — decentralized freelance marketplace.`;
  const image = profile.avatarUrl ?? `${baseUrl}/og-image.png`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "profile",
      images: [{ url: image, width: 1200, height: 630, alt: profile.username }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  // Start the user fetch as the single sequential call
  const userPromise = getPublicUser(username);
  const user = await userPromise;
  if (!user) notFound();

  return (
    <ProfileShell>
      <Suspense fallback={<HeaderSkeleton />}>
        <ProfileHeader userPromise={userPromise} />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        <div>
          <Suspense fallback={<JobsSkeleton />}>
            <JobHistory userPromise={userPromise} />
          </Suspense>

          <Suspense fallback={<EarningsSkeleton />}>
            <EarningsSummary userPromise={userPromise} />
          </Suspense>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <Suspense fallback={<ReputationSkeleton />}>
            <ReputationPanel userPromise={userPromise} />
          </Suspense>

          <Suspense fallback={<ReviewsSkeleton />}>
            <ReviewsSection userPromise={userPromise} />
          </Suspense>

          <Suspense fallback={<PortfolioSkeleton />}>
            <PortfolioSection userPromise={userPromise} />
          </Suspense>
        </div>
      </div>
    </ProfileShell>
  );
}
