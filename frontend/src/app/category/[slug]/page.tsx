import { Metadata } from "next";
import { notFound } from "next/navigation";
import CategoryClient from "./CategoryClient";

const VALID_CATEGORIES = [
  "Frontend",
  "Backend",
  "Smart Contract",
  "Design",
  "Mobile",
  "Documentation",
  "DevOps",
] as const;

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Frontend:
    "Find expert frontend developers for React, Next.js, Vue, and modern web applications on StellarMarket.",
  Backend:
    "Hire skilled backend developers specializing in Node.js, Python, databases, and API development.",
  "Smart Contract":
    "Connect with Soroban and Stellar smart contract developers for blockchain solutions.",
  Design:
    "Discover talented UI/UX designers, graphic designers, and brand specialists.",
  Mobile:
    "Find mobile app developers for iOS, Android, and cross-platform development.",
  Documentation:
    "Hire technical writers and documentation specialists for your project.",
  DevOps:
    "Find DevOps engineers for CI/CD, cloud infrastructure, and platform automation.",
};

function slugToCategory(slug: string): string | null {
  const category = VALID_CATEGORIES.find(
    (cat) => cat.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase(),
  );
  return category ?? null;
}

export async function generateStaticParams() {
  return VALID_CATEGORIES.map((category) => ({
    slug: category.toLowerCase().replace(/\s+/g, "-"),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const validCategory = slugToCategory(params.slug);

  if (!validCategory) {
    return {
      title: "Category Not Found | StellarMarket",
    };
  }

  const description = CATEGORY_DESCRIPTIONS[validCategory];

  return {
    title: `${validCategory} Jobs | StellarMarket`,
    description,
    openGraph: {
      title: `${validCategory} Jobs on StellarMarket`,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${validCategory} Jobs | StellarMarket`,
      description,
    },
  };
}

export const revalidate = 600;

export default function CategoryPage({
  params,
}: {
  params: { slug: string };
}) {
  const validCategory = slugToCategory(params.slug);

  if (!validCategory) {
    notFound();
  }

  return <CategoryClient category={validCategory} slug={params.slug} />;
}
