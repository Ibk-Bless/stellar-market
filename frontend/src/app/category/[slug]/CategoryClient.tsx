"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Briefcase,
  Users,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ChevronRight,
  ArrowUp,
  Monitor,
  Server,
  FileCode,
  Palette,
  Smartphone,
  FileText,
  Container,
} from "lucide-react";
import Link from "next/link";
import axios from "axios";
import JobCard from "@/components/JobCard";
import FreelancerCard from "@/components/FreelancerCard";
import JobCardSkeleton from "@/components/skeletons/JobCardSkeleton";
import EmptyState from "@/components/EmptyState";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { Job, PaginatedResponse, User } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const JOBS_PER_PAGE = 10;

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Frontend: Monitor,
  Backend: Server,
  "Smart Contract": FileCode,
  Design: Palette,
  Mobile: Smartphone,
  Documentation: FileText,
  DevOps: Container,
};

interface CategoryInfo {
  name: string;
  slug: string;
  icon: string;
  description: string;
  jobCount: number;
  freelancerCount: number;
}

export default function CategoryClient({
  category,
  slug,
}: {
  category: string;
  slug: string;
}) {
  const [info, setInfo] = useState<CategoryInfo | null>(null);
  const [featuredJobs, setFeaturedJobs] = useState<Job[]>([]);
  const [topFreelancers, setTopFreelancers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingFreelancers, setLoadingFreelancers] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const freelancerScrollRef = useRef<HTMLDivElement>(null);

  const CategoryIcon = CATEGORY_ICONS[category] ?? Briefcase;

  useEffect(() => {
    let mounted = true;
    const fetchInfo = async () => {
      try {
        const res = await axios.get<{ data: CategoryInfo }>(
          `${API_URL}/categories/${slug}`,
        );
        if (mounted) setInfo(res.data.data);
      } catch {
        // Info fetch failure is non-critical
      }
    };
    fetchInfo();
    return () => { mounted = false; };
  }, [slug]);

  useEffect(() => {
    let mounted = true;
    const fetchFeatured = async () => {
      setLoadingFeatured(true);
      try {
        const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
          params: {
            category,
            status: "OPEN",
            limit: 6,
            sort: "newest",
          },
        });
        if (mounted) setFeaturedJobs(res.data.data);
      } catch {
        // Non-critical
      } finally {
        if (mounted) setLoadingFeatured(false);
      }
    };
    fetchFeatured();
    return () => { mounted = false; };
  }, [category]);

  useEffect(() => {
    let mounted = true;
    const fetchFreelancers = async () => {
      setLoadingFreelancers(true);
      try {
        const res = await axios.get<{ data: User[] }>(
          `${API_URL}/freelancers/top`,
          {
            params: { limit: 5, category },
          },
        );
        if (mounted) setTopFreelancers(res.data.data);
      } catch {
        // Non-critical
      } finally {
        if (mounted) setLoadingFreelancers(false);
      }
    };
    fetchFreelancers();
    return () => { mounted = false; };
  }, [category]);

  const buildParams = useCallback(
    (p: number) => ({
      page: p,
      limit: JOBS_PER_PAGE,
      category,
      status: "OPEN",
      sort: "newest" as const,
    }),
    [category],
  );

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(1),
      });
      setJobs(res.data.data);
      setTotal(res.data.total);
      setHasMore(
        res.data.data.length === JOBS_PER_PAGE && res.data.totalPages > 1,
      );
    } catch {
      setJobs([]);
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
      const res = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
        params: buildParams(nextPage),
      });
      setJobs((prev) => [...prev, ...res.data.data]);
      setPage(nextPage);
      setHasMore(
        res.data.data.length === JOBS_PER_PAGE && nextPage < res.data.totalPages,
      );
    } catch {
      // keep existing results on error
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, buildParams]);

  useEffect(() => {
    fetchFirstPage();
  }, [fetchFirstPage]);

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore,
    isLoading: loadingMore,
    rootMargin: 200,
  });

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > window.innerHeight * 2);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollFreelancers = (direction: "left" | "right") => {
    if (freelancerScrollRef.current) {
      const amount = 320;
      freelancerScrollRef.current.scrollBy({
        left: direction === "left" ? -amount : amount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-stellar-blue/5 to-theme-bg border-b border-theme-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <nav className="flex items-center gap-2 text-sm text-theme-text mb-8">
            <Link href="/" className="hover:text-theme-heading">Home</Link>
            <ChevronRight size={16} />
            <Link href="/jobs" className="hover:text-theme-heading">Jobs</Link>
            <ChevronRight size={16} />
            <span className="text-theme-heading font-medium">{category}</span>
          </nav>

          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-stellar-blue to-stellar-purple flex items-center justify-center text-white shrink-0">
              <CategoryIcon size={32} />
            </div>
            <div className="flex-1">
              <h1 className="text-4xl md:text-5xl font-bold text-theme-heading mb-3">
                {category} Jobs
              </h1>
              <p className="text-lg text-theme-text max-w-2xl mb-6">
                {info?.description ?? `Browse ${category} jobs on StellarMarket.`}
              </p>
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2 text-sm text-theme-text">
                  <Briefcase size={16} className="text-stellar-blue" />
                  <span className="font-medium text-theme-heading">
                    {info?.jobCount ?? "-"}
                  </span>
                  <span>open jobs</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-theme-text">
                  <Users size={16} className="text-stellar-purple" />
                  <span className="font-medium text-theme-heading">
                    {info?.freelancerCount ?? "-"}
                  </span>
                  <span>freelancers</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
        {/* Featured Jobs Grid */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-theme-heading">Featured Jobs</h2>
              <p className="text-theme-text text-sm mt-1">
                Top opportunities in {category.toLowerCase()}
              </p>
            </div>
            <Link
              href={`/jobs?category=${encodeURIComponent(category)}`}
              className="text-sm font-medium text-stellar-blue hover:underline"
            >
              View all
            </Link>
          </div>
          {loadingFeatured ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : featuredJobs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredJobs.map((job, i) => (
                <JobCard key={job.id} job={job} index={i} />
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center">
              <Briefcase size={40} className="mx-auto text-theme-text mb-3" />
              <h3 className="text-lg font-semibold text-theme-heading mb-1">
                No featured jobs yet
              </h3>
              <p className="text-sm text-theme-text mb-4">
                Be the first to post a {category.toLowerCase()} job.
              </p>
              <Link href="/post-job" className="btn-primary text-sm inline-block">
                Post a Job
              </Link>
            </div>
          )}
        </section>

        {/* Top Freelancers Carousel */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-theme-heading">Top Freelancers</h2>
              <p className="text-theme-text text-sm mt-1">
                Highest-rated talent in {category.toLowerCase()}
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => scrollFreelancers("left")}
                className="p-2 rounded-full border border-theme-border text-theme-text hover:bg-theme-border/30 transition-colors"
                aria-label="Scroll freelancers left"
              >
                <ArrowLeft size={18} />
              </button>
              <button
                onClick={() => scrollFreelancers("right")}
                className="p-2 rounded-full border border-theme-border text-theme-text hover:bg-theme-border/30 transition-colors"
                aria-label="Scroll freelancers right"
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
          {loadingFreelancers ? (
            <div className="flex gap-6 overflow-x-auto pb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="min-w-[280px] animate-pulse bg-theme-card border border-theme-border rounded-xl h-64"
                />
              ))}
            </div>
          ) : topFreelancers.length > 0 ? (
            <div
              ref={freelancerScrollRef}
              className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <style dangerouslySetInnerHTML={{
                __html: ".scrollbar-hide::-webkit-scrollbar { display: none; }",
              }} />
              {topFreelancers.map((freelancer, i) => (
                <div
                  key={freelancer.id}
                  className="min-w-[280px] max-w-[280px] flex-shrink-0 snap-start"
                >
                  <FreelancerCard freelancer={freelancer} index={i} />
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center">
              <Users size={40} className="mx-auto text-theme-text mb-3" />
              <h3 className="text-lg font-semibold text-theme-heading mb-1">
                No top freelancers yet
              </h3>
              <p className="text-sm text-theme-text">
                Freelancers with {category.toLowerCase()} skills will appear here as they earn reviews.
              </p>
            </div>
          )}
        </section>

        {/* Full Job List with Infinite Scroll */}
        <section>
          <h2 className="text-2xl font-bold text-theme-heading mb-6">
            All {category} Jobs
          </h2>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : jobs.length > 0 ? (
            <>
              <p className="text-sm text-theme-text mb-4">
                {total} job{total !== 1 ? "s" : ""} found
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {jobs.map((job, i) => (
                  <JobCard key={job.id} job={job} index={i} />
                ))}
              </div>

              <div ref={sentinelRef} aria-hidden="true" />

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
            <EmptyState
              icon={Briefcase}
              title={`No ${category.toLowerCase()} jobs found`}
              description="Check back later for new listings in this category."
              action={{ label: "Post a Job", href: "/post-job" }}
            />
          )}
        </section>
      </div>

      {/* Back to top */}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-8 right-8 p-3 rounded-full bg-stellar-blue text-white shadow-lg hover:bg-stellar-blue/90 transition-all z-50"
          aria-label="Back to top"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
