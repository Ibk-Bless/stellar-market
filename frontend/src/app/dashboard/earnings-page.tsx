"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import axios from "axios";
import StatusBadge from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { buildSeries, type WeeklyEarning } from "./earnings/earnings-utils";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

interface EarningsSummary {
  totalEarned: number;
  earnedThisMonth: number;
  pendingRelease: number;
  activeEscrow: number;
}

interface CategoryBreakdown {
  category: string;
  earnings: number;
  percentage: number;
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
  weeklyEarnings: WeeklyEarning[];
  categoryBreakdown: CategoryBreakdown[];
  range: { from: string; to: string };
  transactions: TransactionEarnings[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface ReconcileResponse {
  range: { from: string; to: string };
  summary: {
    onChainCount: number;
    dbCount: number;
    matchedCount: number;
    onChainOnlyCount: number;
    dbOnlyCount: number;
    allMatched: boolean;
  };
  onChainOnly: Array<{
    txHash: string;
    memoJobId: string | null;
    amount: number;
    assetCode: string;
    createdAt: string;
    horizonUrl: string;
  }>;
}

type RangePreset = "last_7_days" | "last_30_days" | "last_3_months" | "this_year" | "all_time";

const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "all_time", label: "All time" },
];

const PRESET_STORAGE_KEY = "stellar_earnings_preset";

/** Resolve a preset to a concrete [from, to] ISO window (null = unbounded). */
function resolveRange(preset: RangePreset): { from: string | null; to: string | null } {
  if (preset === "all_time") return { from: null, to: null };
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  switch (preset) {
    case "last_7_days":
      from = new Date(now);
      from.setDate(from.getDate() - 7);
      break;
    case "last_30_days":
      from = new Date(now);
      from.setDate(from.getDate() - 30);
      break;
    case "last_3_months":
      from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      break;
    case "this_year":
      from = new Date(now.getFullYear(), 0, 1);
      break;
  }
  return { from: from!.toISOString(), to };
}

const authHeader = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("token") : ""}`,
});

const EarningsPage = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<EarningsSummary>({
    totalEarned: 0,
    earnedThisMonth: 0,
    pendingRelease: 0,
    activeEscrow: 0,
  });
  const [weeklyEarnings, setWeeklyEarnings] = useState<WeeklyEarning[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [transactions, setTransactions] = useState<TransactionEarnings[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [preset, setPreset] = useState<RangePreset>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(PRESET_STORAGE_KEY) as RangePreset | null;
      if (stored && RANGE_PRESETS.some((p) => p.value === stored)) return stored;
    }
    return "last_30_days";
  });
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => resolveRange(preset), [preset]);

  // Below 375px (budget Android devices) we shrink bars and drop the legend to
  // avoid clutter while keeping the moving-average line readable.
  const isNarrow = useMediaQuery("(max-width: 374px)");

  const fetchEarnings = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const rawParams: Record<string, string> = { page: currentPage.toString(), limit: "10" };
      if (range.from) rawParams.from = range.from;
      if (range.to) rawParams.to = range.to;
      const params = new URLSearchParams(rawParams);

      const response = await axios.get<EarningsResponse>(
        `${API}/freelancers/earnings?${params.toString()}`,
        { headers: authHeader(), signal },
      );

      setSummary(response.data.summary);
      setWeeklyEarnings(response.data.weeklyEarnings);
      setCategories(response.data.categoryBreakdown);
      setTransactions(response.data.transactions);
      setTotalPages(response.data.pagination.totalPages);
    } catch (err) {
      if (axios.isCancel(err)) return;
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError("Only freelancers can access this page.");
      } else {
        setError("Failed to load earnings data. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [user, currentPage, range.from, range.to]);

  const fetchReconciliation = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    setReconciling(true);
    try {
      const rawReconcileParams: Record<string, string> = {};
      if (range.from) rawReconcileParams.from = range.from;
      if (range.to) rawReconcileParams.to = range.to;
      const params = new URLSearchParams(rawReconcileParams);
      const response = await axios.get<ReconcileResponse>(
        `${API}/freelancers/earnings/reconcile?${params.toString()}`,
        { headers: authHeader(), signal },
      );
      setReconcile(response.data);
    } catch (err) {
      if (axios.isCancel(err)) return;
      setReconcile(null);
    } finally {
      setReconciling(false);
    }
  }, [user, range.from, range.to]);

  useEffect(() => {
    const controller = new AbortController();
    fetchEarnings(controller.signal);
    return () => controller.abort();
  }, [fetchEarnings]);

  useEffect(() => {
    const controller = new AbortController();
    fetchReconciliation(controller.signal);
    return () => controller.abort();
  }, [fetchReconciliation]);

  // Reset to page 1 whenever the range changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [preset]);

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  const formatDate = (dateStr: string): string =>
    new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatWeek = (weekStr: string): string =>
    new Date(`${weekStr}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  const series = useMemo(
    () =>
      buildSeries(weeklyEarnings).map((s) => ({
        ...s,
        label: formatWeek(s.week),
      })),
    [weeklyEarnings],
  );

  const handleExportCSV = async () => {
    setExporting(true);
    setError(null);
    try {
      const rawExportParams: Record<string, string> = { format: "csv" };
      if (range.from) rawExportParams.from = range.from;
      if (range.to) rawExportParams.to = range.to;
      const params = new URLSearchParams(rawExportParams);
      const response = await axios.get(
        `${API}/freelancers/earnings/export?${params.toString()}`,
        { headers: authHeader(), responseType: "blob" },
      );

      const blob = new Blob([response.data], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `earnings-${range.from ? range.from.slice(0, 10) : "all"}-to-${range.to ? range.to.slice(0, 10) : "now"}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      // Show success message
      setError(null);
      const successDiv = document.createElement("div");
      successDiv.className =
        "fixed bottom-4 right-4 bg-theme-success text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2";
      successDiv.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>Export ready — download started</span>
      `;
      document.body.appendChild(successDiv);
      setTimeout(() => successDiv.remove(), 3000);
    } catch (err) {
      setError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const isNewAccount =
    !loading && summary.totalEarned === 0 && transactions.length === 0;

  return (
    <div className="space-y-6 p-4 sm:p-6 bg-theme-bg min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-heading">
            Earnings
          </h1>
          <p className="text-theme-text mt-1 text-sm sm:text-base">
            Track your freelance earnings, reconcile on-chain payments, and
            export for taxes
          </p>
        </div>
        <div className="flex flex-col gap-2 self-start">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                data-testid={`preset-${p.value}`}
                onClick={() => {
                  setPreset(p.value);
                  localStorage.setItem(PRESET_STORAGE_KEY, p.value);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  preset === p.value
                    ? "bg-stellar-blue border-stellar-blue text-white"
                    : "btn-secondary border-theme-border"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!loading && !isNewAccount && (
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
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
            <div
              key={i}
              className="bg-theme-card rounded-lg border border-theme-border p-6 animate-pulse"
            >
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

      {/* Time-series chart: weekly bars + 30-day moving average line */}
      {!loading && !isNewAccount && series.length > 0 && (
        <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm">
          <h2 className="text-theme-heading text-lg font-semibold mb-4">
            Earnings Over Time
          </h2>
          <div data-testid="earnings-chart-wrapper" className="w-full">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis width={isNarrow ? 32 : 60} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "8px",
                    color: "#f1f5f9",
                  }}
                />
                {!isNarrow && <Legend />}
                <Bar
                  dataKey="earnings"
                  name="Weekly earnings"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  barSize={isNarrow ? 10 : undefined}
                  maxBarSize={isNarrow ? 12 : 40}
                />
                <Line
                  type="monotone"
                  dataKey="movingAvg"
                  name="30-day moving avg"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Category breakdown (derived from job category tags) */}
      {!loading && !isNewAccount && categories.length > 0 && (
        <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm">
          <h2 className="text-theme-heading text-lg font-semibold mb-4">
            By Category
          </h2>
          <div className="space-y-3">
            {categories.map((c) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-theme-heading font-medium">
                    {c.category}
                  </span>
                  <span className="text-theme-text">
                    {formatCurrency(c.earnings)} ({c.percentage.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-theme-bg-secondary rounded">
                  <div
                    className="h-2 rounded bg-stellar-blue"
                    style={{ width: `${Math.min(100, c.percentage)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reconciliation panel */}
      {!loading && !isNewAccount && (
        <ReconciliationPanel reconcile={reconcile} loading={reconciling} />
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
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
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

interface ReconciliationPanelProps {
  reconcile: ReconcileResponse | null;
  loading: boolean;
}

const ReconciliationPanel = ({
  reconcile,
  loading,
}: ReconciliationPanelProps) => {
  const [showUnmatched, setShowUnmatched] = useState(false);

  if (loading) {
    return (
      <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm flex items-center gap-2 text-theme-text text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Reconciling with the
        Stellar ledger…
      </div>
    );
  }

  if (!reconcile) {
    return (
      <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm text-sm text-theme-text">
        Reconciliation is currently unavailable. Earnings shown reflect the
        platform database only.
      </div>
    );
  }

  const { summary, onChainOnly } = reconcile;

  return (
    <div className="bg-theme-card rounded-lg border border-theme-border p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-theme-heading text-lg font-semibold">
          Reconciliation
        </h2>
        {summary.allMatched ? (
          <span className="flex items-center gap-1.5 text-sm text-theme-success">
            <CheckCircle2 className="w-4 h-4" /> All matched
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-theme-warning">
            <AlertTriangle className="w-4 h-4" />{" "}
            {summary.onChainOnlyCount + summary.dbOnlyCount} unmatched
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-theme-heading">
            {summary.onChainCount}
          </p>
          <p className="text-xs text-theme-text uppercase tracking-wider">
            On-chain txs
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-theme-heading">
            {summary.dbCount}
          </p>
          <p className="text-xs text-theme-text uppercase tracking-wider">
            DB records
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-theme-heading">
            {summary.onChainOnlyCount + summary.dbOnlyCount}
          </p>
          <p className="text-xs text-theme-text uppercase tracking-wider">
            Gaps
          </p>
        </div>
      </div>

      {/* Warning banner for on-chain payments missing from the DB */}
      {summary.onChainOnlyCount > 0 && (
        <div className="bg-theme-warning/10 border border-theme-warning/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-theme-warning flex-shrink-0 mt-0.5" />
              <p className="text-sm text-theme-warning">
                {summary.onChainOnlyCount} on-chain payment
                {summary.onChainOnlyCount > 1 ? "s were" : " was"} found on the
                Stellar ledger but {summary.onChainOnlyCount > 1 ? "are" : "is"}{" "}
                missing from your earnings records.
              </p>
            </div>
            <button
              onClick={() => setShowUnmatched((s) => !s)}
              className="btn-secondary px-3 py-1.5 text-xs whitespace-nowrap"
            >
              {showUnmatched ? "Hide" : "View unmatched"}
            </button>
          </div>

          {showUnmatched && (
            <ul className="space-y-2">
              {onChainOnly.map((p) => (
                <li
                  key={p.txHash}
                  className="flex items-center justify-between gap-3 text-sm bg-theme-bg-secondary rounded p-2"
                >
                  <span className="text-theme-text">
                    {new Date(p.createdAt).toLocaleDateString()} ·{" "}
                    {p.amount.toLocaleString()} {p.assetCode}
                    {p.memoJobId ? ` · job ${p.memoJobId}` : ""}
                  </span>
                  <a
                    href={p.horizonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-stellar-blue hover:underline"
                  >
                    View tx <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
              ))}
            </ul>
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
