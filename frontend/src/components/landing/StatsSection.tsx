"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Skeleton from "@/components/Skeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

interface PlatformStats {
  totalJobs: number;
  openJobs: number;
  completedJobs: number;
  totalFreelancers: number;
  totalEscrowXlm: number;
  resolvedDisputesPct: number;
}

export default function StatsSection() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const response = await axios.get<PlatformStats>(`${API_URL}/platform/stats`);
        if (mounted) {
          setStats(response.data);
          setError(false);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchStats();
    return () => {
      mounted = false;
    };
  }, []);

  const displayItems = [
    {
      label: "Jobs Posted",
      value: loading ? null : error ? "2,400+" : `${(stats?.totalJobs ?? 2400).toLocaleString()}+`,
    },
    {
      label: "Freelancers",
      value: loading ? null : error ? "8,100+" : `${(stats?.totalFreelancers ?? 8100).toLocaleString()}+`,
    },
    {
      label: "XLM in Escrow",
      value: loading
        ? null
        : error
        ? "1.2M"
        : stats?.totalEscrowXlm && stats.totalEscrowXlm >= 1000000
        ? `${(stats.totalEscrowXlm / 1000000).toFixed(1)}M`
        : stats?.totalEscrowXlm && stats.totalEscrowXlm >= 1000
        ? `${(stats.totalEscrowXlm / 1000).toFixed(1)}K`
        : `${(stats?.totalEscrowXlm ?? 1200000).toLocaleString()}`,
    },
    {
      label: "Disputes Resolved",
      value: loading ? null : error ? "98%" : `${stats?.resolvedDisputesPct ?? 98}%`,
    },
  ];

  return (
    <section className="border-t border-theme-border py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {displayItems.map((item, index) => (
            <div key={index} className="flex flex-col items-center justify-center">
              {loading ? (
                <Skeleton className="h-10 w-24 mb-2 rounded-md" />
              ) : (
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-stellar-blue to-stellar-purple bg-clip-text text-transparent">
                  {item.value}
                </div>
              )}
              <div className="text-theme-text mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
