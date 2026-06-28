"use client";

import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { ArrowLeft, ArrowRight, Briefcase } from "lucide-react";
import JobCard from "@/components/JobCard";
import JobCardSkeleton from "@/components/skeletons/JobCardSkeleton";
import { Job, PaginatedResponse } from "@/types";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export default function FeaturedJobsCarousel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const fetchFeaturedJobs = async () => {
      try {
        const response = await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs`, {
          params: { status: "OPEN", limit: 6, sort: "newest" },
        });
        if (mounted) {
          setJobs(response.data.data);
        }
      } catch (error) {
        console.error("Failed to fetch featured jobs:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchFeaturedJobs();
    return () => {
      mounted = false;
    };
  }, []);

  const scrollLeft = () => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth > 768 ? 400 : 300;
      scrollRef.current.scrollBy({ left: -scrollAmount, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth > 768 ? 400 : 300;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
      <div className="flex flex-col md:flex-row items-center justify-between mb-10">
        <div>
          <h2 className="text-3xl font-bold text-theme-heading mb-2">
            Featured Opportunities
          </h2>
          <p className="text-theme-text">
            Discover top gigs matching your skills on our decentralized marketplace.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={scrollLeft}
            className="p-2 rounded-full border border-theme-border text-theme-text hover:bg-theme-border/30 hover:text-theme-heading transition-colors"
            aria-label="Scroll left"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onClick={scrollRight}
            className="p-2 rounded-full border border-theme-border text-theme-text hover:bg-theme-border/30 hover:text-theme-heading transition-colors"
            aria-label="Scroll right"
          >
            <ArrowRight size={20} />
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto gap-6 pb-6 snap-x snap-mandatory scrollbar-hide"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <style dangerouslySetInnerHTML={{ __html: `
            .scrollbar-hide::-webkit-scrollbar {
                display: none;
            }
          `}} />
          
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="min-w-[300px] md:min-w-[400px] flex-shrink-0 snap-start">
                <JobCardSkeleton />
              </div>
            ))
          ) : jobs.length > 0 ? (
            jobs.map((job, i) => (
              <div key={job.id} className="min-w-[300px] md:min-w-[400px] flex-shrink-0 snap-start">
                <JobCard job={job} index={i} />
              </div>
            ))
          ) : (
            <div className="w-full flex flex-col items-center justify-center p-12 card text-center snap-center">
              <Briefcase className="text-theme-text mb-4" size={40} />
              <h3 className="text-lg font-semibold text-theme-heading mb-2">No featured jobs</h3>
              <p className="text-theme-text mb-6">Check back later for new opportunities.</p>
              <Link href="/jobs" className="btn-secondary">
                View All Jobs
              </Link>
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-8 text-center md:hidden">
        <Link href="/jobs" className="btn-secondary w-full inline-block">
          View All Opportunities
        </Link>
      </div>
    </section>
  );
}
