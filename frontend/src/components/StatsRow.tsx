import React from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Briefcase, CheckCircle2, DollarSign, Star } from "lucide-react";
import { DashboardStatsSkeleton } from "./skeletons/DashboardSkeleton";
import { useAuth } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

interface FreelancerStats {
  totalEarnedXlm: number;
  completedJobs: number;
  activeJobs: number;
  averageRating: number;
  reviewCount: number;
}

export default function StatsRow() {
  const { token } = useAuth();

  const { data: stats, isLoading, error } = useQuery<FreelancerStats>({
    queryKey: ["freelancerStats"],
    queryFn: async () => {
      const res = await axios.get(`${API}/freelancers/me/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    enabled: !!token,
    staleTime: 300_000, // 5 minutes
  });

  if (isLoading) {
    return <DashboardStatsSkeleton />;
  }

  if (error || !stats) {
    // Graceful fallback or error state could be handled here.
    return null; 
  }

  const statCards = [
    { 
      label: "Active Work", 
      value: `${stats.activeJobs}`, 
      detail: "Jobs in progress", 
      icon: Briefcase, 
      color: "text-stellar-blue" 
    },
    { 
      label: "Completed Jobs", 
      value: `${stats.completedJobs}`, 
      detail: "Total completed", 
      icon: CheckCircle2, 
      color: "text-theme-success" 
    },
    { 
      label: "Total Earned", 
      value: `${stats.totalEarnedXlm.toLocaleString()} XLM`, 
      detail: "Lifetime earnings", 
      icon: DollarSign, 
      color: "text-stellar-purple" 
    },
    { 
      label: "Rating", 
      value: stats.averageRating > 0 ? `${stats.averageRating.toFixed(1)}/5` : "N/A", 
      detail: `${stats.reviewCount} reviews`, 
      icon: Star, 
      color: "text-theme-warning" 
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {statCards.map((stat) => (
        <div key={stat.label} className="card flex items-center gap-4">
          <div className={`${stat.color}`}>
            <stat.icon size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-theme-heading">{stat.value}</div>
            <div className="text-sm text-theme-text">{stat.label}</div>
            <div className="text-xs text-theme-text/60 mt-0.5">{stat.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
