import Link from "next/link";
import { Star, User } from "lucide-react";
import { User as UserType } from "@/types";
import Image from "next/image";
import StarRating from "./StarRating";

interface FreelancerCardProps {
  freelancer: UserType;
  /**
   * Position of this card in the list (0-based).
   * The first 3 cards (index 0-2) load eagerly with priority;
   * all others are lazy-loaded.
   */
  index?: number;
}

const AVAILABILITY_CONFIG = {
  available: { color: "bg-green-500", label: "Available" },
  busy: { color: "bg-amber-400", label: "Busy" },
  unavailable: { color: "bg-gray-400", label: "Unavailable" },
};

function getAvailabilityStatus(freelancer: UserType): keyof typeof AVAILABILITY_CONFIG | null {
  if (freelancer.availabilityStatus) return freelancer.availabilityStatus;
  if (freelancer.availability === true) return "available";
  if (freelancer.availability === false) return "unavailable";
  return null;
}

export default function FreelancerCard({ freelancer, index = 0 }: FreelancerCardProps) {
  let averageRating = freelancer.averageRating || 0;
  let reviewCount = freelancer.reviewCount || 0;

  // Use on-chain reputation if available
  if (freelancer.reputation) {
    const totalScore = BigInt(freelancer.reputation.totalScore);
    const totalWeight = BigInt(freelancer.reputation.totalWeight);

    if (totalWeight > 0n) {
      averageRating = Number(totalScore) / Number(totalWeight);
    }
    reviewCount = freelancer.reputation.reviewCount;
  }

  // First 3 cards are above-the-fold — load eagerly with priority
  const isPriority = index < 3;
  const availStatus = getAvailabilityStatus(freelancer);
  const availConfig = availStatus ? AVAILABILITY_CONFIG[availStatus] : null;

  return (
    <Link href={`/profile/${freelancer.id}`}>
      <div className="card hover:border-stellar-blue/50 transition-all duration-200 cursor-pointer h-full flex flex-col p-6 group">
        <div className="flex items-center gap-4 mb-5">
          <div className="relative w-16 h-16 flex-shrink-0">
            {freelancer.avatarUrl ? (
              <Image
                src={freelancer.avatarUrl}
                alt={`${freelancer.username} avatar`}
                fill
                sizes="64px"
                priority={isPriority}
                loading={isPriority ? undefined : "lazy"}
                placeholder="empty"
                className="rounded-full object-cover border-2 border-theme-border group-hover:border-stellar-blue/30 transition-colors"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-stellar-blue/20 to-stellar-purple/20 flex items-center justify-center text-stellar-blue border-2 border-theme-border group-hover:border-stellar-blue/30 transition-colors">
                <User size={32} />
              </div>
            )}
            {availConfig && (
              <div
                className={`absolute bottom-0 right-0 w-4 h-4 ${availConfig.color} border-2 border-theme-bg rounded-full`}
                title={availConfig.label}
                aria-label={availConfig.label}
              />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-theme-heading group-hover:text-stellar-blue transition-colors">
                {freelancer.username}
              </h3>
              {availConfig && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white ${availConfig.color}`}>
                  {availConfig.label}
                </span>
              )}
            </div>
            <div className="mt-1">
              <StarRating rating={averageRating} reviewCount={reviewCount} />
            </div>
          </div>
        </div>

        <p className="text-sm text-theme-text mb-6 line-clamp-3 leading-relaxed flex-grow">
          {freelancer.bio || "No bio description provided."}
        </p>

        <div className="flex flex-wrap gap-2 pt-4 border-t border-theme-border mt-auto">
          {freelancer.skills?.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="text-[10px] uppercase tracking-wider font-bold bg-theme-bg border border-theme-border text-theme-text px-2 py-1 rounded-md"
            >
              {skill}
            </span>
          ))}
          {freelancer.skills && freelancer.skills.length > 4 && (
            <span className="text-[10px] font-bold text-stellar-blue px-2 py-1">
              +{freelancer.skills.length - 4}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
