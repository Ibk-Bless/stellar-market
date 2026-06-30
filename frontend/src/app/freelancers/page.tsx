"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Search, SlidersHorizontal, X, UserSearch } from "lucide-react";
import axios from "axios";
import FreelancerCard from "@/components/FreelancerCard";
import Pagination from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";
import { useFreelancerFilters } from "@/hooks/useFreelancerFilters";
import { User, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const FREELANCERS_PER_PAGE = 12;

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

function FreelancersContent() {
  const {
    filters,
    debouncedSearch,
    updateFilter,
    updateSearch,
    toggleSkill,
    clearAll,
    activeCount,
  } = useFreelancerFilters();

  const [freelancers, setFreelancers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchFreelancers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        role: "FREELANCER",
        page: filters.page,
        limit: FREELANCERS_PER_PAGE,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filters.skills.length) params.skill = filters.skills.join(",");

      const res = await axios.get<any>(
        `${API_URL}/users`,
        { params },
      );
      
      // backend returns users or data field based on route structure
      const users = res.data.users || res.data.data || [];
      const pagination = res.data.pagination || {};
      
      setFreelancers(users);
      setTotal(pagination.total || users.length);
      setTotalPages(pagination.pages || 1);
    } catch (error) {
      console.error("Fetch freelancers error:", error);
      setFreelancers([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [
    filters.page,
    filters.skills,
    debouncedSearch,
  ]);

  useEffect(() => {
    fetchFreelancers();
  }, [fetchFreelancers]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-theme-heading mb-2">
            Find Top Freelancers
          </h1>
          <p className="text-theme-text">
            Discover and hire expert talent for your next project.
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
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-8">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text"
          size={20}
        />
        <input
          type="text"
          placeholder="Search by name or bio (e.g. 'Frontend Developer', 'Soroban Expert')..."
          className="input-field pl-12 py-3 text-lg"
          value={filters.search}
          onChange={(e) => updateSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters Sidebar */}
        <aside
          className={`lg:w-64 space-y-8 ${
            filtersOpen
              ? "fixed inset-0 z-50 bg-theme-bg p-6 overflow-y-auto"
              : "hidden lg:block"
          }`}
        >
          <div className="flex items-center justify-between lg:hidden mb-6">
            <h2 className="text-xl font-bold text-theme-heading">Filters</h2>
            <button
              onClick={() => setFiltersOpen(false)}
              className="p-2 text-theme-text hover:bg-theme-border/20 rounded-full"
            >
              <X size={24} />
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-theme-heading">Skills</h3>
              {filters.skills.length > 0 && (
                <button
                  onClick={() => updateFilter("skills", [])}
                  className="text-xs text-stellar-blue hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {POPULAR_SKILLS.map((skill) => (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filters.skills.includes(skill)
                      ? "bg-stellar-blue text-white"
                      : "bg-theme-border/30 text-theme-text hover:bg-theme-border/50"
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={clearAll}
            className="w-full btn-secondary py-2 text-sm flex items-center justify-center gap-2"
          >
            Clear All Filters
          </button>

          {filtersOpen && (
            <button
              onClick={() => setFiltersOpen(false)}
              className="w-full btn-primary py-3 mt-4"
            >
              Show Results ({total})
            </button>
          )}
        </aside>

        {/* Results Grid */}
        <main className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-theme-text">
              Showing <span className="font-semibold text-theme-heading">{total}</span> freelancers
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card h-64 animate-pulse flex flex-col p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 rounded-full bg-theme-border/50" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 bg-theme-border/50 rounded" />
                      <div className="h-3 w-16 bg-theme-border/50 rounded" />
                    </div>
                  </div>
                  <div className="h-4 w-full bg-theme-border/50 rounded mb-2" />
                  <div className="h-4 w-2/3 bg-theme-border/50 rounded mb-auto" />
                  <div className="flex gap-2 pt-4">
                    <div className="h-6 w-12 bg-theme-border/50 rounded" />
                    <div className="h-6 w-12 bg-theme-border/50 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : freelancers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {freelancers.map((freelancer, i) => (
                <FreelancerCard key={freelancer.id} freelancer={freelancer} index={i} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={UserSearch}
              title="No freelancers found"
              description="Try adjusting your filters or search terms to find what you're looking for."
              action={{ label: "Clear all filters", onClick: clearAll }}
            />
          )}

          {totalPages > 1 && (
            <div className="mt-12">
              <Pagination
                page={filters.page}
                totalPages={totalPages}
                total={total}
                limit={FREELANCERS_PER_PAGE}
                onPageChange={(page) => updateFilter("page", page)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function FreelancersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-stellar-blue"></div>
        </div>
      }
    >
      <FreelancersContent />
    </Suspense>
  );
}
