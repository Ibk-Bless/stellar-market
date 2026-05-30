import { Metadata } from 'next';

interface SEOMetadataProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'profile';
}

export function generateSEOMetadata({
  title,
  description,
  image = '/og-image.png',
  url,
  type = 'website'
}: SEOMetadataProps): Metadata {
  const siteName = 'StellarMarket';
  const fullTitle = `${title} | ${siteName}`;
  
  return {
    title: fullTitle,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      url,
      siteName,
      type,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image],
    },
    alternates: {
      canonical: url,
    },
  };
}

// Job-specific metadata generator
export function generateJobMetadata(job: {
  title: string;
  description: string;
  id: string;
}): Metadata {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io";
  const title = job.title;
  const description = job.description.length > 160
    ? `${job.description.substring(0, 157)}...`
    : job.description;
  const canonical = new URL(`/jobs/${job.id}`, siteUrl).toString();
  
  return generateSEOMetadata({
    title,
    description,
    url: canonical,
    type: 'article',
  });
}

// Profile-specific metadata generator
export function generateProfileMetadata(profile: {
  name: string;
  tagline?: string;
  bio: string;
  avatar?: string;
  username: string;
}): Metadata {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io";
  const title = profile.tagline 
    ? `${profile.name} - ${profile.tagline}`
    : profile.name;
  
  const description = profile.bio.length > 160 
    ? `${profile.bio.substring(0, 157)}...` 
    : profile.bio;
  const canonical = new URL(`/profile/${profile.username}`, siteUrl).toString();
  
  return generateSEOMetadata({
    title,
    description,
    image: profile.avatar || '/og-image.png',
    url: canonical,
    type: 'profile',
  });
}
