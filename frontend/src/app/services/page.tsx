"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { Search, SlidersHorizontal, X, LayoutGrid, Loader2 } from "lucide-react";
import Link from "next/link";
import axios from "axios";
import ServiceCard from "@/components/ServiceCard";
import EmptyState from "@/components/EmptyState";
import { useServiceFilters } from "@/hooks/useServiceFilters";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { ServiceListing, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const SERVICES_PER_PAGE = 10;

const categories = [
  "All",
  "Frontend",
  "Backend",
  "Smart Contract",
  "Design",
  "Mobile",
  "Documentation",
];

const POPULAR_SKILLS = [
  "React",
  "Next.js",
  "TypeScript",
  "Node.js",
  "Soroban",
  "Rust",
  "Stellar",
  "Solidity",
  "Python",
  "Figma",
  "Tailwind",
  "PostgreSQL",
  "GraphQL",
  "Docker",
  "AWS",
];

const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Price: Low to High", value: "price_asc" },
  { label: "Price: High to Low", value: "price_desc" },
];

function ServicesContent() {
  const {
    filters,
    debouncedSearch,
    updateFilter,
    updateSearch,
    toggleSkill,
    clearAll,
    activeCount,
  } = useServiceFilters();

  const [services, setServices] = useState<ServiceListing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filterKey = JSON.stringify({
    debouncedSearch,
    category: filters.category,
    skills: filters.skills,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    sort: filters.sort,
  });
  const prevFilterKey = useRef(filterKey);

  const buildParams = useCallback(
    (p: number) => {
      const params: Record<string, string | number> = {
        page: p,
        limit: SERVICES_PER_PAGE,
      };
      if (filters.category !== "All") params.category = filters.category;
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.skills.length) params.skills = filters.skills.join(",");
      if (filters.minPrice) params.minPrice = Number(filters.minPrice);
      if (filters.maxPrice) params.maxPrice = Number(filters.maxPrice);
      if (filters.sort !== "newest") params.sort = filters.sort;
      return params;
    },
    [filters, debouncedSearch],
  );

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const res = await axios.get<PaginatedResponse<ServiceListing>>(
        `${API_URL}/services`,
        { params: buildParams(1) },
      );
      setServices(res.data.data);
      setTotal(res.data.total);
      setHasMore(
        res.data.data.length === SERVICES_PER_PAGE && res.data.totalPages > 1,
      );
    } catch {
      setServices([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const fetchNextPage = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await axios.get<PaginatedResponse<ServiceListing>>(
        `${API_URL}/services`,
        { params: buildParams(nextPage) },
      );
      setServices((prev) => [...prev, ...res.data.data]);
      setPage(nextPage);
      setHasMore(
        res.data.data.length === SERVICES_PER_PAGE &&
          nextPage < res.data.totalPages,
      );
    } catch {
      // keep existing results on error
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, buildParams]);

  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
    }
    fetchFirstPage();
  }, [filterKey, fetchFirstPage]);

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore,
    isLoading: loadingMore,
    rootMargin: 200,
  });

  const hasActiveSearch =
    debouncedSearch ||
    filters.category !== "All" ||
    filters.skills.length > 0 ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.sort !== "newest";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-theme-heading mb-2">
            Discover Services
          </h1>
          <p className="text-theme-text">
            Find the right freelancer for your next project.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
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
          <Link href="/services/new" className="btn-primary">
            Post a Service
          </Link>
        </div>
      </div>

      <div className="relative mb-6">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text"
          size={18}
        />
        <input
          type="text"
          placeholder="Search services (e.g. 'React', 'Soroban', 'logo design')..."
          className="input-field pl-10"
          value={filters.search}
          onChange={(e) => updateSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div
          className={`lg:w-64 shrink-0 space-y-6 ${filtersOpen ? "block" : "hidden lg:block"}`}
        >
          <div>
            <h3 className="text-sm font-semibold text-theme-heading mb-3">
              Category
            </h3>
            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => updateFilter("category", cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filters.category === cat
                      ? "bg-stellar-blue text-white"
                      : "bg-theme-card border border-theme-border text-theme-text hover:border-stellar-blue"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-theme-heading mb-3">
              Skills
            </h3>
            <div className="flex gap-2 flex-wrap">
              {POPULAR_SKILLS.map((skill) => (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filters.skills.includes(skill)
                      ? "bg-stellar-blue text-white"
                      : "bg-theme-card border border-theme-border text-theme-text hover:border-stellar-blue"
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-theme-heading mb-3">
              Budget Range (XLM)
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Min"
                min="0"
                className="input-field text-sm"
                value={filters.minPrice}
                onChange={(e) => updateFilter("minPrice", e.target.value)}
              />
              <span className="text-theme-text">–</span>
              <input
                type="number"
                placeholder="Max"
                min="0"
                className="input-field text-sm"
                value={filters.maxPrice}
                onChange={(e) => updateFilter("maxPrice", e.target.value)}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-theme-heading mb-3">
              Sort By
            </h3>
            <select
              className="input-field text-sm"
              value={filters.sort}
              onChange={(e) => updateFilter("sort", e.target.value)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {activeCount > 0 && (
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                {filters.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-stellar-blue/10 text-stellar-blue text-xs"
                  >
                    {skill}
                    <button
                      onClick={() => toggleSkill(skill)}
                      className="hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <button
                onClick={clearAll}
                className="text-sm text-stellar-blue hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        <div className="flex-1">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse bg-theme-card border border-theme-border rounded-xl h-72"
                />
              ))}
            </div>
          ) : services.length > 0 ? (
            <>
              <p className="text-sm text-theme-text mb-4">
                {total} service{total !== 1 ? "s" : ""} found
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {services.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>

              <div ref={sentinelRef} aria-hidden="true" />

              {loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2
                    className="animate-spin text-stellar-blue"
                    size={28}
                    aria-label="Loading more services"
                  />
                </div>
              )}

              {!hasMore && !loadingMore && (
                <p className="text-center text-sm text-theme-text py-6">
                  You&apos;ve seen all {total} service{total !== 1 ? "s" : ""}.
                </p>
              )}

              {hasMore && !loadingMore && (
                <div className="flex justify-center pt-4 pb-2">
                  <button
                    onClick={fetchNextPage}
                    className="btn-secondary px-6 py-2 text-sm"
                    aria-label="Load more services"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={LayoutGrid}
              title={
                hasActiveSearch
                  ? "No services match your search."
                  : "No services listed yet. Be the first!"
              }
              description={
                hasActiveSearch
                  ? "Try a different keyword or adjust your filters."
                  : "Offer your skills to the Stellar community by posting a service."
              }
              action={{ label: "Post a Service", href: "/services/new" }}
              secondaryAction={
                activeCount > 0 ? { label: "Clear Filters", onClick: clearAll } : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-12 text-center">
          <div className="w-12 h-12 border-4 border-stellar-blue border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      }
    >
      <ServicesContent />
    </Suspense>
  );
}
