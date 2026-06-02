"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  Calendar,
  Clock,
  ShieldCheck,
  Download,
  Loader2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import axios from "axios";
import StatusBadge from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

interface EarningsSummary {
  totalEarned: number;
  earnedThisMonth: number;
  pendingRelease: number;
  activeEscrow: number;
}

interface MonthlyEarning {
  month: string;
  earnings: number;
}

interface TransactionEarnings {
  id: string;
  jobId: string;
  amount: number;
  type: "RELEASE" | "DISPUTE_PAYOUT";
  createdAt: string;
  txHash: string;
  job: {
    id: string;
    title: string;
    client: {
      id: string;
      username: string;
      avatarUrl: string | null;
    };
  } | null;
}

interface EarningsResponse {
  summary: EarningsSummary;
  monthlyEarnings: MonthlyEarning[];
  transactions: TransactionEarnings[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const EarningsPage = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<EarningsSummary>({
    totalEarned: 0,
    earnedThisMonth: 0,
    pendingRelease: 0,
    activeEscrow: 0,
  });
  const [monthlyEarnings, setMonthlyEarnings] = useState<MonthlyEarning[]>([]);
  const [transactions, setTransactions] = useState<TransactionEarnings[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "10",
      });

      const response = await axios.get<EarningsResponse>(
        `${API}/freelancers/earnings?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      setSummary(response.data.summary);
      setMonthlyEarnings(response.data.monthlyEarnings);
      setTransactions(response.data.transactions);
      setTotalPages(response.data.pagination.totalPages);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError("Only freelancers can access this page.");
      } else {
        setError("Failed to load earnings data. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [user, currentPage]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatMonth = (monthStr: string): string => {
    const [year, month] = monthStr.split("-");
    const date = new Date(Number(year), Number(month) - 1);
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const chartData = monthlyEarnings.map((m) => ({
    month: formatMonth(m.month),
    earnings: m.earnings,
  }));

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const allTx: TransactionEarnings[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({ page: page.toString(), limit: "100" });
        const response = await axios.get<EarningsResponse>(
          `${API}/freelancers/earnings?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        allTx.push(...response.data.transactions);
        hasMore = page < response.data.pagination.totalPages;
        page++;
      }

      const headers = ["Job Title", "Client", "Amount", "Date", "Status", "Transaction Hash"];
      const rows = allTx.map((tx) => [
        `"${tx.job?.title ?? "N/A"}"`,
        `"${tx.job?.client?.username ?? "N/A"}"`,
        tx.amount.toString(),
        formatDate(tx.createdAt),
        tx.type.replace("_", " "),
        tx.txHash,
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `earnings-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export CSV.");
    } finally {
      setExporting(false);
    }
  };

  const isNewAccount = !loading && summary.totalEarned === 0 && transactions.length === 0;

  return (
    <div className="space-y-6 p-4 sm:p-6 bg-theme-bg min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-heading">
            Earnings
          </h1>
          <p className="text-theme-text mt-1 text-sm sm:text-base">
            Track your freelance earnings and payment history
          </p>
        </div>
        {!loading && !isNewAccount && (
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm self-start"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-theme-error/10 border border-theme-error/30 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-theme-error flex-shrink-0 mt-0.5" />
          <p className="text-sm text-theme-error">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-theme-card rounded-lg border border-theme-border p-6 animate-pulse">
              <div className="h-4 w-24 bg-theme-border rounded mb-3" />
              <div className="h-8 w-20 bg-theme-border rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Earned"
            value={formatCurrency(summary.totalEarned)}
            icon={<TrendingUp className="w-5 h-5" />}
            color="success"
          />
          <StatCard
            label="Earned This Month"
            value={formatCurrency(summary.earnedThisMonth)}
            icon={<Calendar className="w-5 h-5" />}
            color="primary"
          />
          <StatCard
            label="Pending Release"
            value={formatCurrency(summary.pendingRelease)}
            icon={<Clock className="w-5 h-5" />}
            color="warning"
          />
          <StatCard
            label="Active Escrow"
            value={formatCurrency(summary.activeEscrow)}
            icon={<ShieldCheck className="w-5 h-5" />}
            color="info"
          />
        </div>
      )}

      {/* Empty State */}
      {isNewAccount && (
        <div className="bg-theme-card rounded-lg border border-theme-border p-12 text-center">
          <DollarSign className="w-12 h-12 text-theme-text/40 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-theme-heading mb-2">
            No earnings yet
          </h2>
          <p className="text-theme-text max-w-md mx-auto">
            Your earnings will appear here once you complete jobs and receive
            payments. Start applying to jobs to begin earning.
          </p>
        </div>
      )}

      {/* Line Chart */}
      {!loading && !isNewAccount && chartData.length > 0 && (
        <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm">
          <h2 className="text-theme-heading text-lg font-semibold mb-4">
            Earnings Over Time
          </h2>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[500px] px-4 sm:px-0">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                      color: "#f1f5f9",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="earnings"
                    stroke="#10b981"
                    name="Earnings"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Table */}
      {!loading && !isNewAccount && (
        <div className="bg-theme-card rounded-lg border border-theme-border overflow-hidden shadow-sm">
          <div className="p-4 sm:p-6 border-b border-theme-border">
            <h2 className="text-theme-heading text-lg font-semibold">
              Payment History
            </h2>
          </div>

          {transactions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-theme-text">No transactions found.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-theme-bg-secondary border-b border-theme-border">
                    <tr>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-theme-text uppercase tracking-wider">
                        Job Title
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-theme-text uppercase tracking-wider">
                        Client
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-theme-text uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-theme-text uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-theme-text uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border">
                    {transactions.map((tx) => (
                      <tr
                        key={tx.id}
                        className="hover:bg-theme-bg-secondary transition-colors"
                      >
                        <td className="px-4 sm:px-6 py-4">
                          <span className="text-sm font-medium text-theme-heading">
                            {tx.job?.title ?? "N/A"}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-4">
                          <span className="text-sm text-theme-text">
                            {tx.job?.client?.username ?? "N/A"}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-4">
                          <span className="text-sm font-semibold text-theme-heading">
                            {formatCurrency(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-4">
                          <span className="text-sm text-theme-text">
                            {formatDate(tx.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-4">
                          <StatusBadge status={tx.type} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-theme-border bg-theme-bg-secondary">
                <div className="text-sm text-theme-text">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "success" | "primary" | "warning" | "info";
}

const StatCard = ({ label, value, icon, color }: StatCardProps) => {
  const colorMap = {
    success: "bg-theme-success/10 text-theme-success",
    primary: "bg-stellar-blue/10 text-stellar-blue",
    warning: "bg-theme-warning/10 text-theme-warning",
    info: "bg-stellar-purple/10 text-stellar-purple",
  };

  return (
    <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-theme-text text-xs sm:text-sm font-medium truncate">
            {label}
          </p>
          <p className="text-theme-heading text-lg sm:text-2xl font-bold mt-1 sm:mt-2 truncate">
            {value}
          </p>
        </div>
        <div className={`p-2 sm:p-3 rounded-lg shrink-0 ${colorMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

export default EarningsPage;
export { EarningsPage };
