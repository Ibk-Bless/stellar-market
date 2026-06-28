"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Briefcase,
  FileText,
  MessageSquare,
  Star,
  DollarSign,
  Loader2,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Trash2,
  Send,
  XCircle,
  Eye,
  ChevronRight,
} from "lucide-react";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatusBadge from "@/components/StatusBadge";
import OnboardingWizard from "@/components/OnboardingWizard";
import { DashboardStatsSkeleton, DashboardTabContentSkeleton } from "@/components/skeletons/DashboardSkeleton";
import DisputeCardSkeleton from "@/components/skeletons/DisputeCardSkeleton";
import { useDelay } from "@/hooks/useDelay";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Job, Application, PaginatedResponse } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

interface DashboardStats {
  postedJobs: number;
  openJobs: number;
  inProgressJobs: number;
  completedJobs: number;
  applicationsToReview: number;
  activeDisputes: number;
  totalSpent: number;
  activeWork: number;
  totalApplications: number;
  pendingApplications: number;
  acceptedApplications: number;
  rejectedApplications: number;
  totalEarned: number;
  pendingPayout: number;
  rating: number;
}

interface Dispute {
  id: string;
  reason: string;
  status: string;
  job: { id: string; title: string };
  createdAt: string;
}

interface MilestoneItem {
  id: string;
  title: string;
  status: string;
  jobId: string;
  job?: { title: string };
  contractDeadline?: string;
}

interface ExtendedApplication extends Application {
  job?: { id: string; title: string };
}

export default function DashboardPage() {
  const { user, token, isLoading } = useAuth();
  const { socket } = useSocket();
  const isClientByProfile = user?.role === "CLIENT";
  const [inferredRole, setInferredRole] = useState<"CLIENT" | "FREELANCER" | null>(null);
  const isClient = inferredRole ? inferredRole === "CLIENT" : isClientByProfile;

  const clientTabs = ["My Posted Jobs", "Applicants to Review", "Active Disputes", "Messages"];
  const freelancerTabs = ["My Applications", "Active Work", "Upcoming Milestones", "Messages"];
  const tabs = isClient ? clientTabs : freelancerTabs;

  const [activeTab, setActiveTab] = useState(freelancerTabs[0]);
  const [stats, setStats] = useState<DashboardStats>({
    postedJobs: 0, openJobs: 0, inProgressJobs: 0, completedJobs: 0,
    applicationsToReview: 0, activeDisputes: 0, totalSpent: 0,
    activeWork: 0, totalApplications: 0, pendingApplications: 0,
    acceptedApplications: 0, rejectedApplications: 0,
    totalEarned: 0, pendingPayout: 0, rating: 0,
  });

  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [pendingApplicants, setPendingApplicants] = useState<Application[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [submittedMilestones, setSubmittedMilestones] = useState<MilestoneItem[]>([]);
  const [earningsChartData, setEarningsChartData] = useState<Array<{ name: string; amount: number }>>([]);
  const [spendingChartData, setSpendingChartData] = useState<Array<{ name: string; amount: number }>>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const ready = useDelay();

  // Withdraw-application state (freelancer)
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    if (!token || !user) return;
    setDataLoading(true);

    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [jobsRes, appsRes, disputesRes] = await Promise.all([
        axios.get<PaginatedResponse<Job>>(`${API}/jobs?page=1&limit=100`, { headers }).catch(() => null),
        axios.get<PaginatedResponse<Application>>(`${API}/applications?page=1&limit=100`, { headers }).catch(() => null),
        axios.get<PaginatedResponse<Dispute>>(`${API}/disputes?page=1&limit=100`, { headers }).catch(() => null),
      ]);
      const allJobs = jobsRes?.data?.data ?? [];
      const allApps = appsRes?.data?.data ?? [];
      const allDisputes = disputesRes?.data?.data ?? [];
      const clientJobs = allJobs.filter((j: Job) => j.client?.id === user.id);
      const freelancerJobs = allJobs.filter((j: Job) => j.freelancer?.id === user.id);
      const freelancerApps = allApps.filter((a: Application) => a.freelancer?.id === user.id);

      const resolvedRole: "CLIENT" | "FREELANCER" =
        freelancerJobs.length > 0 || freelancerApps.length > 0
          ? "FREELANCER"
          : clientJobs.length > 0
            ? "CLIENT"
            : isClientByProfile
              ? "CLIENT"
              : "FREELANCER";
      setInferredRole(resolvedRole);

      if (resolvedRole === "CLIENT") {
        const jobs = clientJobs;
        const apps = allApps;
        const disps = allDisputes;

        setPostedJobs(jobs);
        setPendingApplicants(apps.filter((a: Application) => a.status === "PENDING"));
        setDisputes(disps.filter((d) => d.status === "OPEN" || d.status === "VOTING"));

        setStats((prev) => ({
          ...prev,
          postedJobs: jobs.length,
          openJobs: jobs.filter((j: Job) => j.status === "OPEN").length,
          inProgressJobs: jobs.filter((j: Job) => j.status === "IN_PROGRESS").length,
          completedJobs: jobs.filter((j: Job) => j.status === "COMPLETED").length,
          applicationsToReview: apps.filter((a: Application) => a.status === "PENDING").length,
          activeDisputes: disps.filter((d) => d.status === "OPEN" || d.status === "VOTING").length,
          totalSpent: jobs.filter((j: Job) => j.status === "COMPLETED").reduce((sum: number, j: Job) => sum + j.budget, 0),
          rating: user.averageRating ?? 0,
        }));
        const spendByMonth = jobs
          .filter((j: Job) => j.status === "COMPLETED")
          .reduce<Record<string, number>>((acc, j) => {
            const key = new Date(j.updatedAt ?? j.createdAt).toLocaleString(undefined, { month: "short" });
            acc[key] = (acc[key] ?? 0) + j.budget;
            return acc;
          }, {});
        setSpendingChartData(Object.entries(spendByMonth).map(([name, amount]) => ({ name, amount })));
      } else {
        const apps = freelancerApps;
        const myActiveJobs = allJobs.filter((j: Job) => j.freelancer?.id === user.id && j.status === "IN_PROGRESS");

        setApplications(apps);
        setActiveJobs(myActiveJobs);

        // Collect milestones from active jobs
        const upcomingMilestones = myActiveJobs.flatMap((j: Job) =>
          (j.milestones ?? [])
            .filter((m) => m.status === "PENDING" || m.status === "IN_PROGRESS")
            .map((m) => ({ ...m, job: { title: j.title } }))
        );
        setMilestones(
          upcomingMilestones.sort((a, b) =>
            new Date(a.contractDeadline ?? 0).getTime() - new Date(b.contractDeadline ?? 0).getTime(),
          ),
        );
        setSubmittedMilestones(
          myActiveJobs.flatMap((j: Job) =>
            (j.milestones ?? [])
              .filter((m) => m.status === "SUBMITTED")
              .map((m) => ({ ...m, job: { title: j.title } })),
          ),
        );

        const completedJobs = allJobs.filter((j: Job) => j.freelancer?.id === user.id && j.status === "COMPLETED");

        setStats((prev) => ({
          ...prev,
          activeWork: myActiveJobs.length,
          totalApplications: apps.length,
          pendingApplications: apps.filter((a: Application) => a.status === "PENDING").length,
          acceptedApplications: apps.filter((a: Application) => a.status === "ACCEPTED").length,
          rejectedApplications: apps.filter((a: Application) => a.status === "REJECTED").length,
          totalEarned: completedJobs.reduce((sum: number, j: Job) => sum + j.budget, 0),
          pendingPayout: myActiveJobs.reduce((sum: number, j: Job) => sum + j.budget, 0),
          rating: user.averageRating ?? 0,
        }));
        const earnByMonth = completedJobs.reduce<Record<string, number>>((acc, j) => {
          const key = new Date(j.updatedAt ?? j.createdAt).toLocaleString(undefined, { month: "short" });
          acc[key] = (acc[key] ?? 0) + j.budget;
          return acc;
        }, {});
        setEarningsChartData(Object.entries(earnByMonth).map(([name, amount]) => ({ name, amount })));
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setDataLoading(false);
    }
  }, [token, user, isClient, isClientByProfile]);

  const fetchPendingApplicants = useCallback(async () => {
    if (!token || !user?.id || !isClient) return;
    setApplicantsLoading(true);
    try {
      const jobsRes = await axios.get(`\${API}/jobs/mine`, {
        params: { limit: 100 },
        headers: { Authorization: `Bearer ${token}` },
      });
      const clientJobs: Job[] = (jobsRes.data.data ?? []).filter(
        (j: Job) => j.client?.id === user.id && j.status === "OPEN"
      );

      const allApps: ExtendedApplication[] = [];
      for (const job of clientJobs) {
        try {
          const appsRes = await axios.get(`\${API}/jobs/${job.id}/applications`, {
            params: { status: "PENDING", limit: 20 },
            headers: { Authorization: `Bearer ${token}` },
          });
          const apps = (appsRes.data.data ?? []).map((a: ExtendedApplication) => ({
            ...a,
            job: { id: job.id, title: job.title },
          }));
          allApps.push(...apps);
        } catch {
          // Skip jobs with fetch errors
        }
      }
      setPendingApplicants(allApps);
    } catch {
      setPendingApplicants([]);
    } finally {
      setApplicantsLoading(false);
    }
  }, [token, user?.id, isClient]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      fetchDashboardData();
    };
    socket.on("notification:new", refresh);
    socket.on("job:updated", refresh);
    return () => {
      socket.off("notification:new", refresh);
      socket.off("job:updated", refresh);
    };
  }, [socket, fetchDashboardData]);

  const handleWithdraw = async (appId: string) => {
    setWithdrawingId(appId);
    try {
      await axios.delete(`${API}/applications/${appId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setApplications((prev) => prev.filter((a) => a.id !== appId));
      fetchDashboardData();
    } catch {
      // Keep list unchanged on error
    } finally {
      setWithdrawingId(null);
      setWithdrawConfirmId(null);
    }
  };

  const clientStatCards = [
    { label: "Posted Jobs", value: `${stats.postedJobs}`, detail: `${stats.openJobs} open · ${stats.inProgressJobs} funded · ${stats.completedJobs} completed`, icon: Briefcase, color: "text-stellar-blue" },
    { label: "Pending Applications", value: `${stats.applicationsToReview}`, detail: "Awaiting your review", icon: FileText, color: "text-theme-warning" },
    { label: "Active Disputes", value: `${stats.activeDisputes}`, detail: "Require attention", icon: AlertTriangle, color: "text-theme-error" },
    { label: "Total Spent", value: `${stats.totalSpent.toLocaleString()} XLM`, detail: `Rating: ${stats.rating > 0 ? `${stats.rating.toFixed(1)}/5` : "N/A"}`, icon: DollarSign, color: "text-stellar-purple", href: "/dashboard/client-earnings" },
  ];

  const freelancerStatCards = [
    { label: "Active Work", value: `${stats.activeWork}`, detail: "Jobs in progress", icon: Briefcase, color: "text-stellar-blue" },
    { label: "Applications", value: `${stats.totalApplications}`, detail: `${stats.pendingApplications} pending · ${stats.acceptedApplications} accepted`, icon: FileText, color: "text-theme-warning" },
    { label: "Total Earned", value: `${stats.totalEarned.toLocaleString()} XLM`, detail: `Pending: ${stats.pendingPayout.toLocaleString()} XLM`, icon: DollarSign, color: "text-stellar-purple" },
    { label: "Rating", value: stats.rating > 0 ? `${stats.rating.toFixed(1)}/5` : "N/A", detail: `${user?.reviewCount ?? 0} reviews`, icon: Star, color: "text-theme-success" },
  ];

  const displayStats = isClient ? clientStatCards : freelancerStatCards;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={48} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <OnboardingWizard />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-theme-heading">Dashboard</h1>
        {isClient ? (
          <Link href="/post-job" className="btn-primary flex items-center gap-2">
            <Plus size={18} />
            Post a Job
          </Link>
        ) : (
          <Link href="/jobs" className="btn-primary flex items-center gap-2">
            <Search size={18} />
            Browse Jobs
          </Link>
        )}
      </div>

      {/* Stats */}
      {dataLoading && ready ? (
        <DashboardStatsSkeleton />
      ) : dataLoading ? null : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {displayStats.map((stat) => {
            const content = (
              <>
                <div className={`${stat.color}`}>
                  <stat.icon size={24} />
                </div>
                <div>
                  <div className="text-2xl font-bold text-theme-heading">{stat.value}</div>
                  <div className="text-sm text-theme-text">{stat.label}</div>
                  <div className="text-xs text-theme-text/60 mt-0.5">{stat.detail}</div>
                </div>
              </>
            );

            return "href" in stat && stat.href ? (
              <Link key={stat.label} href={stat.href} className="card flex items-center gap-4 hover:opacity-80 transition-opacity">
                {content}
              </Link>
            ) : (
              <div key={stat.label} className="card flex items-center gap-4">
                {content}
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-theme-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab
                ? "text-stellar-blue border-stellar-blue"
                : "text-theme-text border-transparent hover:text-theme-heading"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {dataLoading && ready ? (
        activeTab === "Active Disputes" ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <DisputeCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <DashboardTabContentSkeleton />
        )
      ) : dataLoading ? null : (
        <>
          {/* ── Freelancer tab content ── */}
          {!isClient && activeTab === "My Applications" && (
            <div className="space-y-4">
              {applications.length > 0 ? (
                applications.map((app) => (
                  <div key={app.id} className="card flex items-center justify-between gap-4">
                    <Link href={`/jobs/${app.jobId}`} className="min-w-0 flex-1 hover:opacity-80 transition-opacity">
                      <h3 className="font-semibold text-theme-heading truncate">
                        {(app as Application & { job?: { title?: string } }).job?.title ?? app.proposal?.slice(0, 60) ?? "Application"}
                      </h3>
                      <p className="text-sm text-theme-text">
                        Bid: {app.bidAmount?.toLocaleString()} XLM &middot; Applied: {new Date(app.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={app.status} />
                      {app.status === "PENDING" && (
                        <button
                          onClick={() => setWithdrawConfirmId(app.id)}
                          disabled={withdrawingId === app.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-theme-error/50 text-theme-error hover:bg-theme-error/10 transition-colors disabled:opacity-50"
                          title="Withdraw application"
                        >
                          {withdrawingId === app.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="card text-center py-12">
                  <FileText className="mx-auto text-theme-text mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">No applications yet</h3>
                  <p className="text-theme-text mb-4">Start applying to jobs to see them here.</p>
                  <Link href="/jobs" className="btn-primary inline-flex items-center gap-2">
                    <Search size={16} /> Browse Jobs
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Withdraw confirmation dialog */}
          {withdrawConfirmId && (() => {
            const app = applications.find((a) => a.id === withdrawConfirmId);
            const jobTitle = (app as Application & { job?: { title?: string } } | undefined)?.job?.title ?? "this job";
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-theme-card border border-theme-border rounded-xl shadow-2xl w-full max-w-md p-6">
                  <h2 className="text-lg font-semibold text-theme-heading mb-2">
                    Withdraw Application?
                  </h2>
                  <p className="text-sm text-theme-text mb-6">
                    Withdraw your application for{" "}
                    <span className="font-medium text-theme-heading">{jobTitle}</span>?
                    This cannot be undone.
                  </p>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setWithdrawConfirmId(null)}
                      className="btn-secondary"
                      disabled={!!withdrawingId}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleWithdraw(withdrawConfirmId)}
                      disabled={!!withdrawingId}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-error text-white text-sm font-medium hover:bg-theme-error/90 transition-colors disabled:opacity-50"
                    >
                      {withdrawingId ? <Loader2 size={14} className="animate-spin" /> : null}
                      Withdraw
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {!isClient && activeTab === "Active Work" && (
            <div className="space-y-4">
              {activeJobs.length > 0 ? (
                activeJobs.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="card flex items-center justify-between hover:border-stellar-blue/30 transition-colors">
                    <div>
                      <h3 className="font-semibold text-theme-heading">{job.title}</h3>
                      <p className="text-sm text-theme-text">
                        Client: {job.client?.username ?? "Unknown"} &middot; Deadline: {new Date(job.deadline).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-stellar-purple">
                        {job.budget.toLocaleString()} XLM
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="card text-center py-12">
                  <Briefcase className="mx-auto text-theme-text mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">No active work</h3>
                  <p className="text-theme-text">Jobs you&apos;re working on will appear here.</p>
                </div>
              )}
            </div>
          )}

          {!isClient && activeTab === "Upcoming Milestones" && (
            <div className="space-y-4">
              <div className="card">
                <h3 className="font-semibold text-theme-heading mb-3">Milestone payout trend</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earningsChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#5b8cff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {milestones.length > 0 ? (
                milestones.map((milestone) => (
                  <Link key={milestone.id} href={`/jobs/${milestone.jobId}`} className="card flex items-center justify-between hover:border-stellar-blue/30 transition-colors">
                    <div>
                      <h3 className="font-semibold text-theme-heading">{milestone.title}</h3>
                      <p className="text-sm text-theme-text">
                        {milestone.job?.title}
                        {milestone.contractDeadline && (
                          <> &middot; Due: {new Date(milestone.contractDeadline).toLocaleDateString()}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-theme-warning" />
                      <StatusBadge status={milestone.status} />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="card text-center py-12">
                  <Clock className="mx-auto text-theme-text mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">No upcoming milestones</h3>
                  <p className="text-theme-text">Milestone deadlines will appear here once you have active jobs.</p>
                </div>
              )}
              {submittedMilestones.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-theme-heading mb-3">Submitted milestones awaiting client approval</h3>
                  <div className="space-y-2">
                    {submittedMilestones.map((milestone) => (
                      <Link key={milestone.id} href={`/jobs/${milestone.jobId}`} className="flex items-center justify-between rounded-lg border border-theme-border px-3 py-2 hover:border-stellar-blue/30">
                        <div>
                          <p className="text-sm font-medium text-theme-heading">{milestone.title}</p>
                          <p className="text-xs text-theme-text">{milestone.job?.title}</p>
                        </div>
                        <StatusBadge status="SUBMITTED" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Client tab content ── */}
          {isClient && activeTab === "My Posted Jobs" && (
            <div className="space-y-4">
              <div className="card">
                <h3 className="font-semibold text-theme-heading mb-3">Milestone spending overview</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={spendingChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#9b6bff" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {postedJobs.length > 0 ? (
                postedJobs.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="card flex items-center justify-between hover:border-stellar-blue/30 transition-colors">
                    <div>
                      <h3 className="font-semibold text-theme-heading">{job.title}</h3>
                      <p className="text-sm text-theme-text">
                        {job._count?.applications ?? 0} applicant{(job._count?.applications ?? 0) !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-stellar-purple">
                        {job.budget.toLocaleString()} XLM
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="card text-center py-12">
                  <Briefcase className="mx-auto text-theme-text mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">No jobs posted yet</h3>
                  <p className="text-theme-text mb-4">Post your first job to find talented freelancers.</p>
                  <Link href="/post-job" className="btn-primary inline-flex items-center gap-2">
                    <Plus size={16} /> Post a Job
                  </Link>
                </div>
              )}
            </div>
          )}

          {isClient && activeTab === "Applicants to Review" && (
            <div className="space-y-4">
              {pendingApplicants.length > 0 ? (
                pendingApplicants.map((app) => (
                  <Link key={app.id} href={`/jobs/${app.jobId}`} className="card flex items-center justify-between hover:border-stellar-blue/30 transition-colors">
                    <div>
                      <h3 className="font-semibold text-theme-heading">
                        {app.freelancer?.username ?? "Unknown Freelancer"}
                      </h3>
                      <p className="text-sm text-theme-text">
                        Applied: {new Date(app.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-stellar-purple">
                        {app.bidAmount?.toLocaleString()} XLM
                      </span>
                      <StatusBadge status="PENDING" />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="card text-center py-12">
                  <CheckCircle2 className="mx-auto text-theme-text mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">All caught up!</h3>
                  <p className="text-theme-text">No pending applications to review.</p>
                </div>
              )}
            </div>
          )}

          {isClient && activeTab === "Active Disputes" && (
            <div className="space-y-4">
              {disputes.length > 0 ? (
                disputes.map((dispute) => (
                  <Link key={dispute.id} href="/disputes" className="card flex items-center justify-between hover:border-stellar-blue/30 transition-colors">
                    <div>
                      <h3 className="font-semibold text-theme-heading">{dispute.job?.title ?? "Dispute"}</h3>
                      <p className="text-sm text-theme-text">
                        {dispute.reason?.slice(0, 80)}...
                      </p>
                      <p className="text-xs text-theme-text/60 mt-1">
                        Opened: {new Date(dispute.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-theme-error" />
                      <StatusBadge status={dispute.status} />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="card text-center py-12">
                  <CheckCircle2 className="mx-auto text-theme-success mb-4" size={40} />
                  <h3 className="text-lg font-semibold text-theme-heading mb-2">No active disputes</h3>
                  <p className="text-theme-text">All clear! No disputes require your attention.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Shared Messages tab ── */}
          {activeTab === "Messages" && (
            <div className="card text-center py-12">
              <MessageSquare className="mx-auto text-theme-text mb-4" size={40} />
              <h3 className="text-lg font-semibold text-theme-heading mb-2">
                No messages yet
              </h3>
              <p className="text-theme-text">
                Messages from{" "}
                {isClient ? "freelancers" : "clients"} will appear here.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
