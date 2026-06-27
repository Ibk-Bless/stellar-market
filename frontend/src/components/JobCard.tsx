"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Bookmark,
  BookmarkCheck,
  Clock,
  DollarSign,
  Tag,
  Users,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import EscrowStatusBadge from "./EscrowStatusBadge";
import { Job, User as UserType } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { useRelativeTime } from "@/hooks/useRelativeTime";

interface JobCardProps {
  job: Job;
  /**
   * Position of this card in the list (0-based).
   * The first 3 cards (index 0-2) load eagerly with priority;
   * all others are lazy-loaded.
   */
  index?: number;
  viewer?: Partial<UserType> | null;
  searchTerm?: string;
  isSaved?: boolean;
  onToggleSave?: (job: Job) => void | Promise<void>;
  onTagClick?: (tag: string, type: "category" | "skill") => void;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query?: string) {
  const cleaned = query?.trim();
  if (!cleaned) return text;

  const terms = cleaned
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);

  return parts.map((part, index) =>
    terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded px-0.5 bg-stellar-blue/20 text-stellar-blue"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

export default function JobCard({
  job,
  index = 0,
  viewer,
  searchTerm,
  isSaved = false,
  onToggleSave,
  onTagClick,
}: JobCardProps) {
  const authUser = useAuth().user ?? null;
  const user = viewer ?? authUser;
  const postedAt = useRelativeTime(new Date(job.createdAt));
  const isFreelancer = user?.role === "FREELANCER";
  const isClient = user?.role === "CLIENT";
  const isOwnJob = user?.id === job.client.id;

  const isPriority = index < 3;
  const canSave = Boolean(onToggleSave);

  const handleTagClick = (
    tag: string,
    type: "category" | "skill",
  ) => {
    onTagClick?.(tag, type);
  };

  return (
    <div className="card hover:border-stellar-blue/50 transition-all duration-200">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => handleTagClick(job.category, "category")}
            className="text-xs font-medium text-stellar-purple bg-stellar-purple/10 px-2 py-1 rounded w-fit hover:bg-stellar-purple/20 transition-colors"
            title={`Filter by ${job.category}`}
          >
            {job.category}
          </button>
          {job.escrowStatus && <EscrowStatusBadge status={job.escrowStatus} />}
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {canSave && (
            <button
              type="button"
              onClick={() => void onToggleSave?.(job)}
              className={`inline-flex items-center justify-center rounded-full border px-2.5 py-2 text-xs font-medium transition-colors ${
                isSaved
                  ? "border-stellar-blue/30 bg-stellar-blue/10 text-stellar-blue"
                  : "border-theme-border bg-theme-bg text-theme-text hover:border-stellar-blue hover:text-stellar-blue"
              }`}
              aria-label={isSaved ? "Remove bookmark" : "Bookmark job"}
              title={isSaved ? "Remove bookmark" : "Bookmark job"}
            >
              {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            </button>
          )}
        </div>
      </div>

      <Link href={`/jobs/${job.id}`} className="block">
        {job.imageUrl && (
          <div className="relative w-full h-48 mb-4 rounded-lg overflow-hidden bg-theme-card">
            <Image
              src={job.imageUrl}
              alt={job.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              priority={isPriority}
              loading={isPriority ? undefined : "lazy"}
              placeholder="empty"
              className="object-cover"
            />
          </div>
        )}

        <h3 className="text-lg font-semibold text-theme-heading mb-2">
          {highlightText(job.title, searchTerm)}
        </h3>

        <p className="text-sm text-theme-text mb-4 line-clamp-2">
          {highlightText(job.description, searchTerm)}
        </p>
      </Link>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => handleTagClick(job.category, "category")}
          className="inline-flex items-center gap-1 rounded-full border border-stellar-purple/20 bg-stellar-purple/5 px-3 py-1 text-xs font-medium text-stellar-purple transition-colors hover:bg-stellar-purple/10"
        >
          <Tag size={12} />
          {job.category}
        </button>
        {job.skills.slice(0, 4).map((skill) => (
          <button
            key={skill}
            type="button"
            onClick={() => handleTagClick(skill, "skill")}
            className="inline-flex items-center gap-1 rounded-full border border-theme-border bg-theme-bg px-3 py-1 text-xs font-medium text-theme-text transition-colors hover:border-stellar-blue hover:text-stellar-blue"
          >
            <Tag size={12} />
            {highlightText(skill, searchTerm)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 text-sm text-theme-text">
        <div className="flex items-center gap-1">
          <DollarSign size={14} />
          <span>{job.budget.toLocaleString()} XLM</span>
        </div>
        <div className="flex items-center gap-1">
          <Users size={14} />
          <span>{job._count?.applications || 0} applicants</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={14} />
          <span>{postedAt}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-theme-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple" />
          <span className="text-sm text-theme-text">{job.client.username}</span>
        </div>

        {isFreelancer && job.status === "OPEN" && !isOwnJob && (
          <Link
            href={`/jobs/${job.id}`}
            className="text-xs font-medium px-3 py-1 bg-stellar-blue/10 text-stellar-blue rounded-full hover:bg-stellar-blue/20 transition-colors"
          >
            Apply
          </Link>
        )}

        {isClient && isOwnJob && (
          <Link
            href={`/jobs/${job.id}`}
            className="text-xs font-medium px-3 py-1 bg-stellar-purple/10 text-stellar-purple rounded-full hover:bg-stellar-purple/20 transition-colors"
          >
            View Applicants
          </Link>
        )}
      </div>
    </div>
  );
}
