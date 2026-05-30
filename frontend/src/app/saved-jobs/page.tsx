"use client";

import { useMemo, useState } from "react";
import { Bookmark, Search } from "lucide-react";
import JobCard from "@/components/JobCard";
import EmptyState from "@/components/EmptyState";
import JobCardSkeleton from "@/components/skeletons/JobCardSkeleton";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { Job } from "@/types";

function matchesQuery(job: Job, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    job.title.toLowerCase().includes(needle) ||
    job.description.toLowerCase().includes(needle) ||
    job.category.toLowerCase().includes(needle) ||
    job.skills.some((skill) => skill.toLowerCase().includes(needle))
  );
}

export default function SavedJobsPage() {
  const { savedJobs, isLoading, toggleSavedJob, refreshSavedJobs } =
    useSavedJobs();
  const [query, setQuery] = useState("");

  const filteredJobs = useMemo(
    () => savedJobs.filter((job) => matchesQuery(job, query)),
    [query, savedJobs],
  );

  const handleTagClick = (tag: string, type: "category" | "skill") => {
    const params = new URLSearchParams();
    if (type === "category") {
      params.set("category", tag);
    } else {
      params.set("skills", tag);
    }
    window.location.href = `/jobs?${params.toString()}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-theme-heading mb-2">
            Saved Jobs
          </h1>
          <p className="text-theme-text">
            Jobs you bookmarked will stay here until you remove them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshSavedJobs()}
          className="btn-secondary w-fit"
        >
          Refresh
        </button>
      </div>

      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
          size={18}
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search saved jobs..."
          className="input-field pl-10"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <JobCardSkeleton key={index} />
          ))}
        </div>
      ) : filteredJobs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredJobs.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              index={index}
              isSaved
              searchTerm={query}
              onToggleSave={toggleSavedJob}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Bookmark}
          title="No saved jobs yet."
          description="Use the bookmark button on a job card to save it for later."
          action={{ label: "Browse Jobs", href: "/jobs" }}
        />
      )}
    </div>
  );
}
