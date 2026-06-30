"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DollarSign, Calendar, Loader2, AlertTriangle } from "lucide-react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

interface MonthlySpend {
  month: string;
  spend: number;
}

interface FreelancerBreakdownEntry {
  freelancerId: string;
  displayName: string;
  totalPaid: number;
  jobCount: number;
}

interface ClientEarningsResponse {
  summary: { totalSpent: number; spentThisMonth: number };
  monthlySpend: MonthlySpend[];
  freelancerBreakdown: FreelancerBreakdownEntry[];
  range: { from: string; to: string };
}

const authHeader = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("token") : ""}`,
});

const ClientEarningsPage = () => {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ClientEarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<ClientEarningsResponse>(`${API}/clients/earnings`, {
        headers: authHeader(),
      });
      setData(response.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError("Only clients can access this page.");
      } else {
        setError("Failed to load earnings data. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={48} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <AlertTriangle className="mx-auto text-theme-error mb-4" size={40} />
        <p className="text-theme-text">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold text-theme-heading mb-8">Spend Overview</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="card flex items-center gap-4">
          <DollarSign className="text-stellar-purple" size={24} />
          <div>
            <div className="text-2xl font-bold text-theme-heading">
              {data.summary.totalSpent.toLocaleString()} XLM
            </div>
            <div className="text-sm text-theme-text">Total Spent</div>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <Calendar className="text-stellar-blue" size={24} />
          <div>
            <div className="text-2xl font-bold text-theme-heading">
              {data.summary.spentThisMonth.toLocaleString()} XLM
            </div>
            <div className="text-sm text-theme-text">Spent This Month</div>
          </div>
        </div>
      </div>

      <div className="card mb-8">
        <h2 className="text-lg font-semibold text-theme-heading mb-4">Spend Over Time</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthlySpend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip
                formatter={(value: any, _name?: any) => {
                  const val = Array.isArray(value) ? value[0] : value;
                  return [`${Number(val ?? 0).toLocaleString()} XLM`, "Spend"];
                }}
              />
              <Line type="monotone" dataKey="spend" stroke="#7C3AED" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-theme-heading mb-1">Spend by Freelancer</h2>
        <p className="text-sm text-theme-text/60 mb-4">Top 10 freelancers by total paid. Click a bar to view their profile.</p>
        {data.freelancerBreakdown.length === 0 ? (
          <p className="text-theme-text text-sm">No payments yet.</p>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.freelancerBreakdown}
                layout="vertical"
                margin={{ left: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="displayName" width={120} />
                <Tooltip
                  formatter={(value: any, _name?: any) => {
                    const val = Array.isArray(value) ? value[0] : value;
                    return [`${Number(val ?? 0).toLocaleString()} XLM`, "Total paid"];
                  }}
                />
                <Bar
                  dataKey="totalPaid"
                  fill="#2563EB"
                  cursor="pointer"
                  onClick={(entry: any) => router.push(`/u/${(entry as FreelancerBreakdownEntry).displayName}`)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientEarningsPage;
