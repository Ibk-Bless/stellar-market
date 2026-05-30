"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export interface ServiceFilters {
  search: string;
  skills: string[];
  category: string;
  minPrice: string;
  maxPrice: string;
  minRating: string;
  sort: string;
  page: number;
}

const DEFAULTS: ServiceFilters = {
  search: "",
  skills: [],
  category: "All",
  minPrice: "",
  maxPrice: "",
  minRating: "",
  sort: "newest",
  page: 1,
};

function parseFiltersFromParams(searchParams: URLSearchParams): ServiceFilters {
  const skills = searchParams.get("skills");
  const page = parseInt(searchParams.get("page") || "1", 10);

  return {
    search: searchParams.get("search") || searchParams.get("q") || "",
    skills: skills ? skills.split(",") : [],
    category: searchParams.get("category") || "All",
    minPrice: searchParams.get("minPrice") || "",
    maxPrice: searchParams.get("maxPrice") || "",
    minRating: searchParams.get("minRating") || "",
    sort: searchParams.get("sort") || "newest",
    page: isNaN(page) ? 1 : page,
  };
}

function filtersToParams(filters: ServiceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.skills.length) params.set("skills", filters.skills.join(","));
  if (filters.category !== "All") params.set("category", filters.category);
  if (filters.minPrice) params.set("minPrice", filters.minPrice);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  if (filters.minRating) params.set("minRating", filters.minRating);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function useServiceFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<NodeJS.Timeout>();

  const filtersFromUrl = useMemo(
    () => parseFiltersFromParams(searchParams),
    [searchParams],
  );

  const [filters, setFilters] = useState<ServiceFilters>(filtersFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(filtersFromUrl.search);

  useEffect(() => {
    setFilters(filtersFromUrl);
    setDebouncedSearch(filtersFromUrl.search);
  }, [filtersFromUrl]);

  const syncToUrl = useCallback(
    (next: ServiceFilters) => {
      const qs = filtersToParams(next).toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const updateFilter = useCallback(
    <K extends keyof ServiceFilters>(key: K, value: ServiceFilters[K]) => {
      setFilters((prev) => {
        const next = {
          ...prev,
          [key]: value,
          page: key === "page" ? (value as number) : 1,
        };
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl],
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
    [syncToUrl],
  );

  const toggleSkill = useCallback(
    (skill: string) => {
      setFilters((prev) => {
        const updated = prev.skills.includes(skill)
          ? prev.skills.filter((s) => s !== skill)
          : [...prev.skills, skill];
        const next = { ...prev, skills: updated, page: 1 };
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl],
  );

  const clearAll = useCallback(() => {
    setFilters(DEFAULTS);
    setDebouncedSearch("");
    syncToUrl(DEFAULTS);
  }, [syncToUrl]);

  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.skills.length) count++;
    if (filters.category !== "All") count++;
    if (filters.minPrice || filters.maxPrice) count++;
    if (filters.minRating) count++;
    if (filters.sort !== "newest") count++;
    return count;
  }, [filters]);

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
    toggleSkill,
    clearAll,
    activeCount,
  };
}
