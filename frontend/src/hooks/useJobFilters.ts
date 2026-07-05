"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const CANONICAL_CATEGORIES = [
  "Frontend",
  "Backend",
  "Smart Contract",
  "Design",
  "Mobile",
  "Documentation",
  "DevOps",
];

function categoryToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function slugToCanonical(slug: string): string {
  const fromSlug = CANONICAL_CATEGORIES.find(
    (c) => c.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase()
  );
  if (fromSlug) return fromSlug;
  const exact = CANONICAL_CATEGORIES.find(
    (c) => c.toLowerCase() === slug.toLowerCase()
  );
  return exact ?? slug;
}

export interface JobFilters {
  search: string;
  category: string;
  skills: string[];
  status: string[];
  minBudget: string;
  maxBudget: string;
  postedDate: string;
  sort: string;
  page: number;
}

const DEFAULTS: JobFilters = {
  search: "",
  category: "All",
  skills: [],
  status: [],
  minBudget: "",
  maxBudget: "",
  postedDate: "all",
  sort: "newest",
  page: 1,
};

export function parseFiltersFromParams(searchParams: URLSearchParams): JobFilters {
  const skills = searchParams.get("skills");
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);

  return {
    search: searchParams.get("q") || "",
    category: (() => {
      const raw = searchParams.get("category");
      return raw ? slugToCanonical(raw) : "All";
    })(),
    skills: skills ? skills.split(",") : [],
    status: status ? status.split(",") : [],
    minBudget: searchParams.get("min") || "",
    maxBudget: searchParams.get("max") || "",
    postedDate: searchParams.get("posted") || "all",
    sort: searchParams.get("sort") || "newest",
    page: isNaN(page) ? 1 : page,
  };
}

export function filtersToParams(filters: JobFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.category !== "All") {
    const slug = CANONICAL_CATEGORIES.includes(filters.category)
      ? categoryToSlug(filters.category)
      : filters.category;
    params.set("category", slug);
  }
  if (filters.skills.length) params.set("skills", filters.skills.join(","));
  if (filters.status.length) params.set("status", filters.status.join(","));
  if (filters.minBudget) params.set("min", filters.minBudget);
  if (filters.maxBudget) params.set("max", filters.maxBudget);
  if (filters.postedDate !== "all") params.set("posted", filters.postedDate);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function useJobFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<NodeJS.Timeout>();

  const filtersFromUrl = useMemo(
    () => parseFiltersFromParams(searchParams),
    [searchParams]
  );

  const [filters, setFilters] = useState<JobFilters>(filtersFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(filtersFromUrl.search);

  // Sync URL changes back to state
  useEffect(() => {
    setFilters(filtersFromUrl);
    setDebouncedSearch(filtersFromUrl.search);
  }, [filtersFromUrl]);

  const syncToUrl = useCallback(
    (next: JobFilters) => {
      const qs = filtersToParams(next).toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  const updateFilter = useCallback(
    <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value, page: key === "page" ? (value as number) : 1 };
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl]
  );

  const updateSearch = useCallback(
    (value: string) => {
      setFilters((prev) => ({ ...prev, search: value }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(value);
        setFilters((prev) => {
          const next = { ...prev, search: value, page: 1 };
          syncToUrl(next);
          return next;
        });
      }, 300);
    },
    [syncToUrl]
  );

  const toggleArrayFilter = useCallback(
    (key: "skills" | "status", value: string) => {
      setFilters((prev) => {
        const arr = prev[key];
        const updated = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value];
        const next = { ...prev, [key]: updated, page: 1 };
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl]
  );

  const clearAll = useCallback(() => {
    setFilters(DEFAULTS);
    setDebouncedSearch("");
    syncToUrl(DEFAULTS);
  }, [syncToUrl]);

  // Keep a search query while removing the narrowing filters. This is useful
  // from the zero-results state: users can broaden a search without retyping it.
  const clearFilters = useCallback(() => {
    setFilters((prev) => {
      const next = { ...DEFAULTS, search: prev.search };
      setDebouncedSearch(prev.search);
      syncToUrl(next);
      return next;
    });
  }, [syncToUrl]);

  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.category !== "All") count++;
    if (filters.skills.length) count++;
    if (filters.status.length) count++;
    if (filters.minBudget || filters.maxBudget) count++;
    if (filters.postedDate !== "all") count++;
    return count;
  }, [filters]);

  const postedAfterDate = useMemo(() => {
    const now = Date.now();
    switch (filters.postedDate) {
      case "last24h":
        return new Date(now - 24 * 60 * 60 * 1000).toISOString();
      case "last7d":
        return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      case "last30d":
        return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      default:
        return undefined;
    }
  }, [filters.postedDate]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    filters,
    debouncedSearch,
    updateFilter,
    updateSearch,
    toggleArrayFilter,
    clearAll,
    clearFilters,
    activeCount,
    postedAfterDate,
  };
}
