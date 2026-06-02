"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { Search, SlidersHorizontal, Briefcase, Loader2, Wifi, ArrowUp } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import axios from "axios";
import JobCard from "@/components/JobCard";
import JobCardSkeleton from "@/components/skeletons/JobCardSkeleton";
import { useDelay } from "@/hooks/useDelay";
import FilterSidebar from "@/components/FilterSidebar";
import EmptyState from "@/components/EmptyState";
import { useJobFilters } from "@/hooks/useJobFilters";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useLiveJobFeed } from "@/hooks/useLiveJobFeed";
import { useAuth } from "@/context/AuthContext";
import { Job, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const JOBS_PER_PAGE = 10;

function JobsContent() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const {
    filters,
    debouncedSearch,
    updateFilter,
    updateSearch,
    toggleArrayFilter,
    clearAll,
    activeCount,
    postedAfterDate,
  } = useJobFilters();
  const { savedJobIds, toggleSavedJob } = useSavedJobs();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => {
    const pageParam = searchParams.get("page");
    return pageParam ? parseInt(pageParam, 10) : 1;
  });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveFeedEnabled, setLiveFeedEnabled] = useState(false);
  const [newJobIds, setNewJobIds] = useState<Set<string>>(new Set());
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const { pendingJobs, clearPending } = useLiveJobFeed(liveFeedEnabled);

  // Store the filter "signature" so we can detect when filters change (reset to page 1)
  const filterKey = JSON.stringify({
    debouncedSearch,
    category: filters.category,
    skills: filters.skills,
    status: filters.status,
    minBudget: filters.minBudget,
    maxBudget: filters.maxBudget,
    sort: filters.sort,
    postedAfterDate,
  });
  const prevFilterKey = useRef(filterKey);

  const buildParams = useCallback(
    (p: number) => {
      const params: Record<string, string | number> = {
        page: p,
        limit: JOBS_PER_PAGE,
      };
      if (filters.sort !== "newest") params.sort = filters.sort;
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.category !== "All") params.category = filters.category;
      if (filters.skills.length) params.skills = filters.skills.join(",");
      if (filters.status.length) params.status = filters.status.join(",");
      if (filters.minBudget) params.minBudget = Number(filters.minBudget);
      if (filters.maxBudget) params.maxBudget = Number(filters.maxBudget);
      if (postedAfterDate) params.postedAfter = postedAfterDate;
      return params;
    },
    [filters, debouncedSearch, postedAfterDate],
  );

  // Initial / filter-change fetch — reset list
  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(1),
      });
      setJobs(res.data.data);
      setTotal(res.data.total);
      setHasMore(res.data.data.length === JOBS_PER_PAGE && res.data.totalPages > 1);
    } catch {
      setJobs([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Load next page — append results
  const fetchNextPage = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(nextPage),
      });
      const newJobs = res.data.data;
      setJobs((prev) => [...prev, ...newJobs]);
      setPage(nextPage);
      setHasMore(
        newJobs.length === JOBS_PER_PAGE && nextPage < res.data.totalPages,
      );

      // Sync page to URL for browser back/forward
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });

      // Screen reader announcement
      setAnnouncement(`Loaded ${newJobs.length} more jobs. Page ${nextPage}.`);
    } catch {
      // keep existing results on error
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, buildParams, searchParams, router, pathname]);

  // Re-fetch from page 1 whenever filters change
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
    }
    fetchFirstPage();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps



  const loadNewJobs = useCallback(() => {
    if (pendingJobs.length === 0) return;
    setJobs((prev) => {
      const existingIds = new Set(prev.map((j) => j.id));
      const fresh = pendingJobs.filter((j) => !existingIds.has(j.id));

      setTotal((t) => t + fresh.length);
      setNewJobIds(new Set(fresh.map((j) => j.id)));

      return [...fresh, ...prev];
    });
    clearPending();
    setTimeout(() => setNewJobIds(new Set()), 3000);
  }, [pendingJobs, clearPending]);

  const handleTagClick = useCallback(
    (tag: string, type: "category" | "skill") => {
      if (type === "category") {
        updateFilter("category", tag);
      } else {
        toggleArrayFilter("skills", tag);
      }
      setDrawerOpen(false);
    },
    [toggleArrayFilter, updateFilter],
  );

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore,
    isLoading: loadingMore,
    rootMargin: 200,
  });

  // Scroll detection for Back-to-top button (after ~3 pages = ~30 jobs)
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > window.innerHeight * 2);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-theme-heading">Browse Jobs</h1>
          <button
            onClick={() => setLiveFeedEnabled((v) => !v)}
            className={`hidden sm:flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
              liveFeedEnabled
                ? "bg-stellar-blue/20 border-stellar-blue text-stellar-blue"
                : "border-dark-border text-dark-text hover:border-stellar-blue hover:text-stellar-blue"
            }`}
            title={liveFeedEnabled ? "Disable live feed" : "Enable live feed"}
          >
            <Wifi size={14} />
            Live Feed
          </button>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="lg:hidden flex items-center gap-2 btn-secondary py-2 px-4 relative"
        >
          <SlidersHorizontal size={18} />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-stellar-blue text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
          size={18}
          aria-hidden="true"
        />
        <label htmlFor="search-jobs" className="sr-only">Search jobs by keyword</label>
        <input
          id="search-jobs"
          type="text"
          placeholder="Search jobs..."
          className="input-field pl-10"
          value={filters.search}
          onChange={(e) => updateSearch(e.target.value)}
          aria-label="Search jobs by keyword"
        />
      </div>

      {/* Main layout: sidebar + results */}
      <div className="flex gap-8">
        <FilterSidebar
          filters={filters}
          updateFilter={updateFilter}
          toggleArrayFilter={toggleArrayFilter}
          clearAll={clearAll}
          activeCount={activeCount}
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />

        {/* Results */}
        <div className="flex-1 min-w-0">
          {/* Live feed banner */}
          {liveFeedEnabled && pendingJobs.length > 0 && (
            <button
              onClick={loadNewJobs}
              className="w-full flex items-center justify-center gap-2 bg-stellar-blue/90 hover:bg-stellar-blue text-white text-sm font-medium py-2.5 px-4 rounded-lg mb-4 transition-colors animate-slide-in-left"
              aria-live="polite"
              aria-atomic="true"
            >
              <ArrowUp size={14} />
              {pendingJobs.length} new job{pendingJobs.length !== 1 ? "s" : ""} — click to load
            </button>
          )}

          {/* Results count */}
          {!loading && (
            <p className="text-sm text-theme-text mb-4" aria-live="polite" aria-atomic="true">
              {total} job{total !== 1 ? "s" : ""} found
            </p>
          )}

          {loading && ready ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : loading ? null : jobs.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {jobs.map((job, i) => (
                  <div
                    key={job.id}
                    className={newJobIds.has(job.id) ? "animate-fade-down ring-2 ring-stellar-blue/40 rounded-xl" : ""}
                  >
                    <JobCard
                      job={job}
                      index={i}
                      searchTerm={debouncedSearch}
                      isSaved={savedJobIds.has(job.id)}
                      onToggleSave={toggleSavedJob}
                      onTagClick={handleTagClick}
                    />
                  </div>
                ))}
              </div>

              {/* Sentinel element — IntersectionObserver watches this */}
              <div ref={sentinelRef} aria-hidden="true" />

              {/* Loading spinner while fetching next page */}
              {loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2
                    className="animate-spin text-stellar-blue"
                    size={28}
                    aria-label="Loading more jobs"
                  />
                </div>
              )}

              {/* End-of-results message */}
              {!hasMore && !loadingMore && (
                <p className="text-center text-sm text-theme-text py-6">
                  You&apos;ve reached the end — {total} job{total !== 1 ? "s" : ""} shown.
                </p>
              )}

              {/* Accessible "Load more" fallback button */}
              {hasMore && !loadingMore && (
                <div className="flex justify-center pt-4 pb-2">
                  <button
                    onClick={fetchNextPage}
                    className="btn-secondary px-6 py-2 text-sm"
                    aria-label="Load more jobs"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          ) : (
            <div role="status" aria-live="polite">
              <EmptyState
                icon={Briefcase}
                title="No jobs found matching your filters."
                description="Try adjusting or clearing your filters to broaden the search."
                action={
                  user?.role === "CLIENT"
                    ? { label: "Post a Job", href: "/post-job" }
                    : activeCount > 0
                    ? { label: "Clear Filters", onClick: clearAll }
                    : undefined
                }
                secondaryAction={
                  user?.role === "CLIENT" && activeCount > 0
                    ? { label: "Clear Filters", onClick: clearAll }
                    : undefined
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Screen reader announcement for new results */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Back to top button */}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-8 right-8 p-3 rounded-full bg-stellar-blue text-white shadow-lg hover:bg-stellar-blue/90 transition-all z-50"
          aria-label="Back to top"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="animate-pulse bg-theme-card rounded-xl h-96" />
        </div>
      }
    >
      <JobsContent />
    </Suspense>
  );
}
