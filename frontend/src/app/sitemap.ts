import type { MetadataRoute } from "next";

const SERVICE_CATEGORIES = [
  "frontend",
  "backend",
  "smart-contract",
  "design",
  "mobile",
  "documentation",
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

async function getPublicFreelancerUsernames(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/freelancers/search?limit=1000`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.freelancers ?? data.data ?? []).map(
      (u: { username: string }) => u.username,
    );
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io";

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/jobs`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/services`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/dashboard`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/messages`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.7 },
    { url: `${baseUrl}/post-job`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/settings`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];

  const categoryPages: MetadataRoute.Sitemap = SERVICE_CATEGORIES.map(
    (category) => ({
      url: `${baseUrl}/services/category/${category}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.85,
    }),
  );

  const usernames = await getPublicFreelancerUsernames();
  const profileRoutes: MetadataRoute.Sitemap = usernames.map((username) => ({
    url: `${baseUrl}/u/${encodeURIComponent(username)}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages, ...profileRoutes];
}
