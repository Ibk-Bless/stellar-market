"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useLayoutEffect,
  memo,
  Suspense,
} from "react";
import {
  List,
  useDynamicRowHeight,
  type ListImperativeAPI,
  type RowComponentProps,
} from "react-window";
import { Search, SlidersHorizontal, Briefcase, Loader2, Wifi, ArrowUp, X } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import axios from "axios";
import JobCard from "@/components/JobCard";
import JobCardSkeleton from "@/components/skeletons/JobCardSkeleton";
import { useDelay } from "@/hooks/useDelay";
import FilterSidebar from "@/components/FilterSidebar";
import EmptyState from "@/components/EmptyState";
import { useJobFilters } from "@/hooks/useJobFilters";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { useLiveJobFeed } from "@/hooks/useLiveJobFeed";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Job, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const JOBS_PER_PAGE = 10;
const DEFAULT_ROW_HEIGHT = 260;

interface JobFeedState {
  ids: string[];
  entities: Map<string, Job>;
}

type ObserveRowElements = (elements: Element[] | NodeListOf<Element>) => () => void;

interface JobRowProps {
  ids: string[];
  entities: Map<string, Job>;
  newJobIds: Set<string>;
  savedJobIds: Set<string>;
  searchTerm: string;
  onToggleSave: (job: Job) => void;
  onTagClick: (tag: string, type: "category" | "skill") => void;
  observeRowElements: ObserveRowElements;
}

// Defined outside JobsContent so it is never recreated on parent re-render.
const _JobRowInner = memo(function JobRow({
  index,
  style,
  ids,
  entities,
  newJobIds,
  savedJobIds,
  searchTerm,
  onToggleSave,
  onTagClick,
  observeRowElements,
}: RowComponentProps<JobRowProps>): React.ReactElement | null {
  const id = ids[index];
  const job = entities.get(id);
  const rowRef = useRef<HTMLDivElement>(null);

  // Register this row's DOM element so useDynamicRowHeight can measure it.
  useEffect(() => {
    if (!rowRef.current) return;
    return observeRowElements([rowRef.current]);
  }, [observeRowElements]);

  if (!job) return null;

  return (
    <div style={style} className="px-1">
      <div
        ref={rowRef}
        className={
          newJobIds.has(id)
            ? "animate-fade-down ring-2 ring-stellar-blue/40 rounded-xl pb-6"
            : "pb-6"
        }
      >
        <JobCard
          job={job}
          index={index}
          searchTerm={searchTerm}
          isSaved={savedJobIds.has(id)}
          onToggleSave={onToggleSave}
          onTagClick={onTagClick}
        />
      </div>
    </div>
  );
});

// Cast to satisfy rowComponent's strict ReactElement | null return constraint.
const JobRow = _JobRowInner as (
  props: RowComponentProps<JobRowProps>
) => React.ReactElement | null;

function JobsContent() {
  const { user } = useAuth();
  const { socket } = useSocket();
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
    clearFilters,
    activeCount,
    postedAfterDate,
  } = useJobFilters();
  const { savedJobIds, toggleSavedJob } = useSavedJobs();

  const [feedState, setFeedState] = useState<JobFeedState>({
    ids: [],
    entities: new Map(),
  });
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
  const [listHeight, setListHeight] = useState(600);
  const ready = useDelay(300);

  const listRef = useRef<ListImperativeAPI | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
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

  // Pass filterKey as key so the height cache resets on filter changes.
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    key: filterKey,
  });

  const { pendingJobs, clearPending } = useLiveJobFeed(liveFeedEnabled);

  // Measure available height for the virtual list, updated on resize.
  useLayoutEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        const rect = listContainerRef.current.getBoundingClientRect();
        setListHeight(Math.max(window.innerHeight - rect.top - 24, 400));
      }
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // O(1) patch — only the changed entity is replaced; ids array is unchanged.
  const applyWsPatch = useCallback((patch: Partial<Job> & { id: string }) => {
    setFeedState((prev) => {
      if (!prev.entities.has(patch.id)) return prev;
      const updated = new Map(prev.entities);
      updated.set(patch.id, { ...updated.get(patch.id)!, ...patch });
      return { ...prev, entities: updated };
    });
  }, []);

  // Subscribe to job:updated for real-time status / count patches.
  useEffect(() => {
    if (!socket) return;
    socket.on("job:updated", applyWsPatch);
    return () => { socket.off("job:updated", applyWsPatch); };
  }, [socket, applyWsPatch]);

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

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(1),
      });
      const jobs = res.data.data;
      setFeedState({
        ids: jobs.map((j) => j.id),
        entities: new Map(jobs.map((j) => [j.id, j])),
      });
      setTotal(res.data.total);
      setHasMore(jobs.length === JOBS_PER_PAGE && res.data.totalPages > 1);
    } catch {
      setFeedState({ ids: [], entities: new Map() });
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const fetchNextPage = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(nextPage),
      });
      const newJobs = res.data.data;
      setFeedState((prev) => {
        const newEntities = new Map(prev.entities);
        const appendIds: string[] = [];
        for (const job of newJobs) {
          if (!newEntities.has(job.id)) {
            appendIds.push(job.id);
            newEntities.set(job.id, job);
          }
        }
        return { ids: [...prev.ids, ...appendIds], entities: newEntities };
      });
      setPage(nextPage);
      setHasMore(newJobs.length === JOBS_PER_PAGE && nextPage < res.data.totalPages);

      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });

      setAnnouncement(`Loaded ${newJobs.length} more jobs. Page ${nextPage}.`);
    } catch {
      // keep existing results on error
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, buildParams, searchParams, router, pathname]);

  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
    }
    fetchFirstPage();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNewJobs = useCallback(() => {
    if (pendingJobs.length === 0) return;
    setFeedState((prev) => {
      const newEntities = new Map(prev.entities);
      const freshIds: string[] = [];
      const highlighted = new Set<string>();

      for (const job of pendingJobs) {
        if (!newEntities.has(job.id)) {
          freshIds.push(job.id);
          newEntities.set(job.id, job);
          highlighted.add(job.id);
        }
      }

      if (freshIds.length === 0) return prev;

      setTotal((t) => t + freshIds.length);
      setNewJobIds(highlighted);

      return { ids: [...freshIds, ...prev.ids], entities: newEntities };
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

  // Trigger pagination when the user scrolls within 4 rows of the end.
  const handleRowsRendered = useCallback(
    (
      visibleRows: { startIndex: number; stopIndex: number },
    ) => {
      if (
        visibleRows.stopIndex >= feedState.ids.length - 4 &&
        hasMore &&
        !loadingMore
      ) {
        fetchNextPage();
      }
    },
    [feedState.ids.length, hasMore, loadingMore, fetchNextPage],
  );

  const rowProps = useMemo<JobRowProps>(
    () => ({
      ids: feedState.ids,
      entities: feedState.entities,
      newJobIds,
      savedJobIds,
      searchTerm: debouncedSearch,
      onToggleSave: toggleSavedJob,
      onTagClick: handleTagClick,
      observeRowElements: dynamicRowHeight.observeRowElements,
    }),
    [feedState, newJobIds, savedJobIds, debouncedSearch, toggleSavedJob, handleTagClick, dynamicRowHeight.observeRowElements],
  );

  const activeFilters = useMemo(() => {
    const items: Array<{ label: string; clear: () => void }> = [];
    if (filters.category !== "All") {
      items.push({ label: `Category: ${filters.category}`, clear: () => updateFilter("category", "All") });
    }
    filters.skills.forEach((skill) => items.push({
      label: `Skill: ${skill}`,
      clear: () => toggleArrayFilter("skills", skill),
    }));
    filters.status.forEach((status) => items.push({
      label: `Status: ${status.replace("_", " ")}`,
      clear: () => toggleArrayFilter("status", status),
    }));
    if (filters.minBudget) {
      items.push({ label: `Min budget: ${filters.minBudget} XLM`, clear: () => updateFilter("minBudget", "") });
    }
    if (filters.maxBudget) {
      items.push({ label: `Max budget: ${filters.maxBudget} XLM`, clear: () => updateFilter("maxBudget", "") });
    }
    if (filters.postedDate !== "all") {
      items.push({ label: `Posted: ${filters.postedDate}`, clear: () => updateFilter("postedDate", "all") });
    }
    return items;
  }, [filters, toggleArrayFilter, updateFilter]);

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
          <label htmlFor="search-jobs" className="sr-only">
            Search jobs by keyword
          </label>
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
          <div ref={listContainerRef} className="flex-1 min-w-0">
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
              <div className="space-y-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <JobCardSkeleton key={i} />
                ))}
              </div>
            ) : loading ? null : feedState.ids.length > 0 ? (
              <>
                <List
                  listRef={listRef}
                  rowComponent={JobRow}
                  rowProps={rowProps}
                  rowCount={feedState.ids.length}
                  rowHeight={dynamicRowHeight}
                  overscanCount={3}
                  onRowsRendered={handleRowsRendered}
                  onScroll={(e: React.UIEvent<HTMLDivElement>) =>
                    setShowBackToTop(e.currentTarget.scrollTop > window.innerHeight * 2)
                  }
                  style={{ height: listHeight }}
                />

                {loadingMore && (
                  <div className="flex justify-center py-6">
                    <Loader2
                      className="animate-spin text-stellar-blue"
                      size={28}
                      aria-label="Loading more jobs"
                    />
                  </div>
                )}

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
                  icon={Search}
                  iconOverlay="?"
                  title={debouncedSearch ? `No jobs found for ${debouncedSearch}` : "No jobs found"}
                  description="Try clearing filters or browse all available jobs."
                  action={{ label: "Browse all jobs", onClick: clearAll }}
                  secondaryAction={{
                    label: "Clear filters",
                    onClick: activeCount > 0 ? clearFilters : clearAll,
                  }}
                >
                  {activeFilters.length > 0 && (
                    <div className="mb-6 max-w-lg" aria-label="Active filters">
                      <p className="mb-2 text-sm font-medium text-theme-heading">Active filters</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {activeFilters.map((filter) => (
                          <button
                            key={filter.label}
                            type="button"
                            onClick={filter.clear}
                            className="inline-flex items-center gap-1 rounded-full border border-theme-border bg-theme-card px-2.5 py-1 text-xs text-theme-text hover:border-stellar-blue hover:text-stellar-blue"
                            aria-label={`Clear ${filter.label} filter`}
                          >
                            {filter.label} <X size={12} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </EmptyState>
              </div>
            )}
          </div>
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

      {/* Back to top — scrolls the virtual list, not window */}
      {showBackToTop && (
        <button
          onClick={() => listRef.current?.scrollToRow({ index: 0, align: "start" })}
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
