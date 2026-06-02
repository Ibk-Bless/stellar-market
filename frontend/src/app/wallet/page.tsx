"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import axios from "axios";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  Download,
  ExternalLink,
  Filter,
  RefreshCw,
  Wallet,
} from "lucide-react";
import TransactionRowSkeleton from "@/components/skeletons/TransactionRowSkeleton";
import { useDelay } from "@/hooks/useDelay";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/tx";

type Direction = "incoming" | "outgoing" | "all";
type TransactionType = "DEPOSIT" | "RELEASE" | "REFUND" | "DISPUTE_PAYOUT";

type HistoryTransaction = {
  id: string;
  jobId: string;
  milestoneId?: string | null;
  fromAddress: string;
  toAddress: string;
  amount: number;
  tokenAddress: string;
  txHash: string;
  type: TransactionType;
  createdAt: string;
  job?: {
    id: string;
    title: string;
    client?: { id: string; username: string; avatarUrl?: string | null };
    freelancer?: { id: string; username: string; avatarUrl?: string | null };
  };
  milestone?: {
    id: string;
    title: string;
    order: number;
    status: string;
  };
  direction?: "incoming" | "outgoing";
  userRole?: "client" | "freelancer" | "unknown";
  counterparty?: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  } | null;
  amountFormatted?: {
    value: number;
    direction: "+" | "-";
    displayAmount: string;
  };
};

type HistoryResponse = {
  transactions: HistoryTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  analytics?: {
    summary: {
      totalIncoming: number;
      totalOutgoing: number;
      netBalance: number;
      totalTransactions: number;
      incomingTransactions: number;
      outgoingTransactions: number;
      uniqueCounterparties: number;
    };
    byType: Array<{ type: TransactionType; count: number; totalAmount: number }>;
    byMonth: Array<{
      month: string;
      count: number;
      total_amount: number;
      incoming_amount: number;
      outgoing_amount: number;
    }>;
  };
};

const TYPE_OPTIONS: Array<{ label: string; value: TransactionType | "" }> = [
  { label: "All", value: "" },
  { label: "Deposits", value: "DEPOSIT" },
  { label: "Releases", value: "RELEASE" },
  { label: "Refunds", value: "REFUND" },
  { label: "Disputes", value: "DISPUTE_PAYOUT" },
];

const DIRECTION_OPTIONS: Array<{ label: string; value: Direction }> = [
  { label: "All", value: "all" },
  { label: "Incoming", value: "incoming" },
  { label: "Outgoing", value: "outgoing" },
];

function formatXlm(amount: number) {
  return `${amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  })} XLM`;
}

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function txTypeLabel(type: TransactionType) {
  switch (type) {
    case "DEPOSIT":
      return "Deposit";
    case "RELEASE":
      return "Release";
    case "REFUND":
      return "Refund";
    case "DISPUTE_PAYOUT":
      return "Dispute payout";
    default:
      return type;
  }
}

function txTypeClasses(type: TransactionType) {
  switch (type) {
    case "DEPOSIT":
      return "bg-theme-warning/10 text-theme-warning border-theme-warning/30";
    case "RELEASE":
      return "bg-theme-success/10 text-theme-success border-theme-success/30";
    case "REFUND":
      return "bg-stellar-blue/10 text-stellar-blue border-stellar-blue/30";
    case "DISPUTE_PAYOUT":
      return "bg-theme-error/10 text-theme-error border-theme-error/30";
    default:
      return "bg-theme-border text-theme-text border-theme-border";
  }
}

export default function WalletPage() {
  const { address } = useWallet();
  const { token, user } = useAuth();

  const [transactions, setTransactions] = useState<HistoryTransaction[]>([]);
  const [analytics, setAnalytics] = useState<HistoryResponse["analytics"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [type, setType] = useState<TransactionType | "">("");
  const [direction, setDirection] = useState<Direction>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [totalPages, setTotalPages] = useState(1);

  const ready = useDelay();

  const fetchHistory = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        direction,
        includeAnalytics: "true",
      });

      if (type) params.set("type", type);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (minAmount) params.set("minAmount", minAmount);
      if (maxAmount) params.set("maxAmount", maxAmount);

      const response = await axios.get<HistoryResponse>(
        `${API_URL}/transactions/history?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      setTransactions(response.data.transactions ?? []);
      setAnalytics(response.data.analytics ?? null);
      setTotalPages(response.data.pagination.totalPages || 1);
    } catch (err: unknown) {
      setError(
        axios.isAxiosError(err)
          ? (err.response?.data?.error as string) || "Failed to fetch transaction history."
          : err instanceof Error
            ? err.message
            : "Failed to fetch transaction history.",
      );
      setTransactions([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFrom, dateTo, direction, limit, minAmount, page, maxAmount, token, type]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const clearFilters = () => {
    setPage(1);
    setType("");
    setDirection("all");
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchHistory();
  };

  const exportHistory = async (format: "csv" | "json") => {
    if (!token) return;

    try {
      const params = new URLSearchParams({
        direction,
        format,
      });
      if (type) params.set("type", type);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const response = await axios.get(
        `${API_URL}/transactions/export?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        },
      );

      const blob = new Blob([response.data], {
        type: format === "csv" ? "text/csv" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-${Date.now()}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(
        axios.isAxiosError(err)
          ? (err.response?.data?.error as string) || "Failed to export transaction history."
          : err instanceof Error
            ? err.message
            : "Failed to export transaction history.",
      );
    }
  };

  const summary = analytics?.summary;
  const visibleTransactions = useMemo(() => transactions, [transactions]);

  if (!token) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4 py-24 text-center">
        <div className="space-y-4">
          <Wallet size={48} className="mx-auto text-theme-text" />
          <h1 className="text-2xl font-bold text-theme-heading">
            Sign in to view payment history
          </h1>
          <p className="text-theme-text">
            You need to be logged in to access the wallet dashboard.
          </p>
          <Link href="/auth/login" className="btn-primary inline-flex">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4 py-24 text-center">
        <div className="space-y-4">
          <Wallet size={48} className="mx-auto text-theme-text" />
          <h1 className="text-2xl font-bold text-theme-heading">
            Connect your wallet
          </h1>
          <p className="text-theme-text">
            Connect Freighter to view the transactions tied to your account.
          </p>
          <Link href="/auth/login" className="btn-primary inline-flex">
            Connect wallet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-theme-text-muted">
            Wallet dashboard
          </p>
          <h1 className="text-3xl font-bold text-theme-heading">
            Payment history
          </h1>
          <p className="max-w-2xl text-sm text-theme-text">
            Review deposits, releases, refunds, and dispute payouts for the
            connected wallet. Signed in as{" "}
            <span className="font-medium text-theme-heading">
              {user?.username || shorten(address)}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void exportHistory("csv")}
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={16} />
            CSV
          </button>
          <button
            type="button"
            onClick={() => void exportHistory("json")}
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={16} />
            JSON
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-theme-error/20 bg-theme-error/10 p-4 text-theme-error">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Incoming"
          value={summary ? formatXlm(summary.totalIncoming) : "0 XLM"}
          icon={<ArrowDownLeft size={18} />}
          tone="success"
        />
        <MetricCard
          label="Outgoing"
          value={summary ? formatXlm(summary.totalOutgoing) : "0 XLM"}
          icon={<ArrowUpRight size={18} />}
          tone="warning"
        />
        <MetricCard
          label="Net balance"
          value={summary ? formatXlm(summary.netBalance) : "0 XLM"}
          icon={<CalendarRange size={18} />}
          tone="info"
        />
        <MetricCard
          label="Counterparties"
          value={summary ? String(summary.uniqueCounterparties) : "0"}
          icon={<Wallet size={18} />}
          tone="neutral"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_0.9fr]">
        <section className="space-y-6">
          <div className="rounded-2xl border border-theme-border bg-theme-card/70 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Filter size={16} className="text-theme-text" />
              <h2 className="text-lg font-semibold text-theme-heading">
                Filters
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Transaction type">
                <select
                  value={type}
                  onChange={(e) => {
                    setPage(1);
                    setType(e.target.value as TransactionType | "");
                  }}
                  className="input-field"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Direction">
                <select
                  value={direction}
                  onChange={(e) => {
                    setPage(1);
                    setDirection(e.target.value as Direction);
                  }}
                  className="input-field"
                >
                  {DIRECTION_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Rows per page">
                <select
                  value={limit}
                  onChange={(e) => {
                    setPage(1);
                    setLimit(Number(e.target.value));
                  }}
                  className="input-field"
                >
                  {[10, 20, 50, 100].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date from">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPage(1);
                    setDateFrom(e.target.value);
                  }}
                  className="input-field"
                />
              </Field>

              <Field label="Date to">
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPage(1);
                    setDateTo(e.target.value);
                  }}
                  className="input-field"
                />
              </Field>

              <Field label="Amount range">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.0000001"
                    placeholder="Min"
                    value={minAmount}
                    onChange={(e) => {
                      setPage(1);
                      setMinAmount(e.target.value);
                    }}
                    className="input-field"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.0000001"
                    placeholder="Max"
                    value={maxAmount}
                    onChange={(e) => {
                      setPage(1);
                      setMaxAmount(e.target.value);
                    }}
                    className="input-field"
                  />
                </div>
              </Field>
            </div>

            {(type || direction !== "all" || dateFrom || dateTo || minAmount || maxAmount) && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm font-medium text-stellar-blue hover:underline"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-theme-border bg-theme-card/70">
            <div className="border-b border-theme-border px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-theme-heading">
                    Transaction history
                  </h2>
                  <p className="text-sm text-theme-text">
                    {visibleTransactions.length} transaction
                    {visibleTransactions.length === 1 ? "" : "s"} on this page
                  </p>
                </div>
                {loading && (
                  <Loader2 size={18} className="animate-spin text-stellar-blue" />
                )}
              </div>
            </div>

            {loading && ready ? (
              <div className="divide-y divide-theme-border">
                {Array.from({ length: 6 }).map((_, index) => (
                  <TransactionRowSkeleton key={index} />
                ))}
              </div>
            ) : loading ? null : visibleTransactions.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <Wallet size={40} className="mx-auto mb-4 text-theme-text" />
                <h3 className="text-lg font-semibold text-theme-heading">
                  No transactions found
                </h3>
                <p className="mt-2 text-sm text-theme-text">
                  Try adjusting your filters or wait for the next on-chain
                  action.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-theme-border">
                {visibleTransactions.map((tx) => {
                  const counterparty = tx.counterparty?.username || shorten(
                    tx.direction === "incoming" ? tx.fromAddress : tx.toAddress,
                  );
                  const isIncoming = tx.direction !== "outgoing";

                  return (
                    <article
                      key={tx.id}
                      className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div className="flex min-w-0 items-start gap-4">
                        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-theme-border bg-theme-bg">
                          {isIncoming ? (
                            <ArrowDownLeft size={18} className="text-theme-success" />
                          ) : (
                            <ArrowUpRight size={18} className="text-theme-error" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${txTypeClasses(tx.type)}`}
                            >
                              {txTypeLabel(tx.type)}
                            </span>
                            <span className="text-sm font-medium text-theme-heading">
                              {tx.job?.title || "Untitled job"}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text">
                            <span className="inline-flex items-center gap-1">
                              <UserChip
                                username={counterparty}
                                address={
                                  tx.direction === "incoming"
                                    ? tx.fromAddress
                                    : tx.toAddress
                                }
                              />
                            </span>
                            {tx.milestone?.title && (
                              <span className="truncate">
                                Milestone: {tx.milestone.title}
                              </span>
                            )}
                            <span>{new Date(tx.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <div
                          className={`text-sm font-semibold ${
                            isIncoming ? "text-theme-success" : "text-theme-heading"
                          }`}
                        >
                          {`${isIncoming ? "+" : "-"}${formatXlm(tx.amount)}`}
                        </div>
                        <a
                          href={`${STELLAR_EXPERT_BASE}/${tx.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-stellar-blue hover:underline"
                        >
                          View on explorer <ExternalLink size={11} />
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-theme-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-theme-text">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-theme-border bg-theme-card/70 p-5">
            <h2 className="text-lg font-semibold text-theme-heading">
              Analytics
            </h2>
            <div className="mt-4 space-y-3 text-sm text-theme-text">
              <div className="flex items-center justify-between rounded-xl border border-theme-border bg-theme-bg px-4 py-3">
                <span>Transactions</span>
                <span className="font-semibold text-theme-heading">
                  {summary?.totalTransactions ?? transactions.length}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-theme-border bg-theme-bg px-4 py-3">
                <span>Incoming count</span>
                <span className="font-semibold text-theme-heading">
                  {summary?.incomingTransactions ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-theme-border bg-theme-bg px-4 py-3">
                <span>Outgoing count</span>
                <span className="font-semibold text-theme-heading">
                  {summary?.outgoingTransactions ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-theme-border bg-theme-bg px-4 py-3">
                <span>Connected wallet</span>
                <span className="font-mono text-xs text-theme-heading">
                  {shorten(address)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-theme-border bg-theme-card/70 p-5">
            <h2 className="text-lg font-semibold text-theme-heading">
              Quick links
            </h2>
            <div className="mt-4 space-y-2">
              <Link href="/dashboard" className="btn-secondary flex w-full justify-center">
                Dashboard
              </Link>
              <Link href="/jobs" className="btn-secondary flex w-full justify-center">
                Browse jobs
              </Link>
              <Link href="/messages" className="btn-secondary flex w-full justify-center">
                Messages
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: "success" | "warning" | "info" | "neutral";
}) {
  const toneClasses: Record<"success" | "warning" | "info" | "neutral", string> = {
    success: "bg-theme-success/10 text-theme-success",
    warning: "bg-theme-warning/10 text-theme-warning",
    info: "bg-stellar-blue/10 text-stellar-blue",
    neutral: "bg-theme-border/60 text-theme-heading",
  };

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-card/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-theme-text">{label}</p>
          <p className="mt-2 text-2xl font-bold text-theme-heading">{value}</p>
        </div>
        <div className={`rounded-xl p-3 ${toneClasses[tone]}`}>{icon}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2 text-sm">
      <span className="block font-medium text-theme-heading">{label}</span>
      {children}
    </label>
  );
}

function UserChip({
  username,
  address,
}: {
  username: string;
  address: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-theme-border bg-theme-bg px-2 py-1">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-stellar-blue text-[9px] font-bold text-white">
        {username.slice(0, 1).toUpperCase()}
      </span>
      <span className="font-medium text-theme-heading">{username}</span>
      <span className="font-mono text-[10px] text-theme-text-muted">
        {shorten(address)}
      </span>
    </span>
  );
}
