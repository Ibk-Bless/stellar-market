"use client";

import { useState, useRef, useEffect } from "react";
import { X, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { JobFilters } from "@/hooks/useJobFilters";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { JOB_SKILLS } from "@/constants/jobs";
import axios from "axios";

const STATUSES = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
];

const DATE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "last24h", label: "Last 24 Hours" },
  { value: "last7d", label: "Last 7 Days" },
  { value: "last30d", label: "Last 30 Days" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "budget_high", label: "Budget: High to Low" },
  { value: "budget_low", label: "Budget: Low to High" },
];

interface FilterSidebarProps {
  filters: JobFilters;
  updateFilter: <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => void;
  toggleArrayFilter: (key: "skills" | "status", value: string) => void;
  clearAll: () => void;
  activeCount: number;
  isOpen: boolean;
  onClose: () => void;
}

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-theme-border pb-4 mb-4 last:border-b-0 last:mb-0 last:pb-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center justify-between w-full text-sm font-medium text-theme-heading mb-2"
      >
        {title}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function FilterSidebar({
  filters,
  updateFilter,
  toggleArrayFilter,
  clearAll,
  activeCount,
  isOpen,
  onClose,
}: FilterSidebarProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

  useFocusTrap(drawerRef, { open: isOpen, onClose });

  // Fetch categories from API
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
        const response = await axios.get<string[]>(`${API_URL}/categories`);
        setCategories(response.data);
      } catch (error) {
        console.error("Failed to fetch categories:", error);
        // Fallback to hardcoded categories if API fails
        setCategories(["Frontend", "Backend", "Smart Contract", "Design", "Mobile", "Documentation", "DevOps"]);
      } finally {
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, []);

  const content = (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-stellar-blue" />
          <h3 className="text-lg font-semibold text-theme-heading">Filters</h3>
          {activeCount > 0 && (
            <span className="bg-stellar-blue text-white text-xs font-medium px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="lg:hidden p-1 text-theme-text hover:text-theme-heading transition-colors"
          aria-label="Close filters"
        >
          <X size={20} />
        </button>
      </div>

      {/* Sort */}
      <FilterSection title="Sort By">
        <label htmlFor="filter-sort" className="sr-only">Sort By</label>
        <select
          id="filter-sort"
          value={filters.sort}
          onChange={(e) => updateFilter("sort", e.target.value)}
          className="input-field text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FilterSection>

      {/* Category */}
      <FilterSection title="Category">
        <label htmlFor="filter-category" className="sr-only">Category</label>
        <select
          id="filter-category"
          value={filters.category}
          onChange={(e) => updateFilter("category", e.target.value)}
          className="input-field text-sm"
          disabled={loadingCategories}
        >
          <option value="All">All Categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        {loadingCategories && (
          <p className="text-xs text-theme-text mt-1">Loading categories...</p>
        )}
      </FilterSection>

      {/* Skills */}
      <FilterSection title="Skills">
        <div className="flex flex-wrap gap-2">
          {JOB_SKILLS.map((skill) => (
            <button
              key={skill}
              onClick={() => toggleArrayFilter("skills", skill)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filters.skills.includes(skill)
                  ? "bg-stellar-blue text-white"
                  : "bg-theme-bg border border-theme-border text-theme-text hover:border-stellar-blue"
              }`}
            >
              {skill}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Status */}
      <FilterSection title="Status">
        <div className="space-y-2">
          {STATUSES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.status.includes(s.value)}
                onChange={() => toggleArrayFilter("status", s.value)}
                className="w-4 h-4 rounded border-theme-border bg-theme-bg text-stellar-blue focus:ring-stellar-blue accent-[#3E54CF]"
              />
              <span className="text-sm text-theme-text">{s.label}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Budget Range */}
      <FilterSection title="Budget (XLM)">
        <div className="flex gap-2">
          <label htmlFor="filter-budget-min" className="sr-only">Minimum budget</label>
          <input
            id="filter-budget-min"
            type="number"
            placeholder="Min"
            value={filters.minBudget}
            onChange={(e) => updateFilter("minBudget", e.target.value)}
            className="input-field text-sm"
            min={0}
          />
          <label htmlFor="filter-budget-max" className="sr-only">Maximum budget</label>
          <input
            id="filter-budget-max"
            type="number"
            placeholder="Max"
            value={filters.maxBudget}
            onChange={(e) => updateFilter("maxBudget", e.target.value)}
            className="input-field text-sm"
            min={0}
          />
        </div>
      </FilterSection>

      {/* Posted Date */}
      <FilterSection title="Posted Date">
        <div className="space-y-2">
          {DATE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="postedDate"
                value={opt.value}
                checked={filters.postedDate === opt.value}
                onChange={(e) => updateFilter("postedDate", e.target.value)}
                className="w-4 h-4 border-theme-border bg-theme-bg text-stellar-blue focus:ring-stellar-blue accent-[#3E54CF]"
              />
              <span className="text-sm text-theme-text">{opt.label}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Clear All */}
      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="w-full mt-4 py-2 text-sm font-medium text-stellar-blue hover:text-stellar-purple transition-colors"
        >
          Clear All Filters
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-24 self-start">
        <div className="card">{content}</div>
      </aside>

      {/* Mobile: drawer overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
          <div ref={drawerRef} className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-theme-card border-r border-theme-border p-6 overflow-y-auto shadow-2xl animate-slide-in-left">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
