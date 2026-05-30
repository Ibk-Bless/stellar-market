import { Metadata } from "next";
import ProfileClient from "./ProfileClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

async function getProfile(id: string) {
  try {
    const res = await fetch(`${API_URL}/users/${id}`, {
      next: { revalidate: 60 } as RequestInit["next"],
    });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error("Error fetching profile for metadata:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const profile = await getProfile(params.id);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io";
  const canonical = `${baseUrl}/profile/${params.id}`;

  if (!profile) {
    return {
      title: "Profile Not Found | StellarMarket",
      description: "The requested profile could not be found.",
      alternates: { canonical },
    };
  }

  const title = `${profile.username} | StellarMarket`;
  const description =
    profile.bio?.substring(0, 160) ||
    `Check out ${profile.username}'s profile on StellarMarket.`;
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

export default function ProfilePage() {
  return <ProfileClient />;
}
