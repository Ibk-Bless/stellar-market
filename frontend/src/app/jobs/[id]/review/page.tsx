"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

import ReviewModal from "@/components/ReviewModal";
import { Job, PaginatedResponse, Review } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export default function JobReviewPage() {
  const { id } = useParams();
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const token =
        localStorage.getItem("stellarmarket_jwt") ?? localStorage.getItem("token");

      const jobRes = await axios.get(`${API_URL}/jobs/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setJob(jobRes.data);

      const reviewsRes = await axios.get<PaginatedResponse<Review>>(
        `${API_URL}/reviews`,
        {
          params: { jobId: id, page: 1, limit: 50 },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      setReviews(reviewsRes.data.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load review page");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const myReview = useMemo(() => {
    const storedUserRaw = localStorage.getItem("stellarmarket_user");
    if (!storedUserRaw) return null;
    try {
      const storedUser = JSON.parse(storedUserRaw) as { id?: string };
      if (!storedUser.id) return null;
      return reviews.find((r) => r.reviewerId === storedUser.id) ?? null;
    } catch {
      return null;
    }
  }, [reviews]);

  const reviewee = useMemo(() => {
    if (!job) return null;

    const storedUserRaw = localStorage.getItem("stellarmarket_user");
    const storedUser = storedUserRaw ? (JSON.parse(storedUserRaw) as any) : null;

    const isClient = Boolean(storedUser && storedUser.id === job.client.id);
    if (!job.freelancer) return null;

    return {
      id: isClient ? job.freelancer.id : job.client.id,
      name: isClient ? job.freelancer.username : job.client.username,
      walletAddress: isClient
        ? job.freelancer.walletAddress
        : job.client.walletAddress,
    };
  }, [job]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-stellar-blue" size={48} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-theme-text">Job not found.</p>
        <Link href="/jobs" className="text-stellar-blue hover:underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-2 text-theme-text hover:text-theme-heading mb-8 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      {error && (
        <div className="mb-6 p-4 bg-theme-error/10 border border-theme-error/20 rounded-lg text-theme-error text-sm">
          {error}
        </div>
      )}

      <div className="card">
        <h1 className="text-2xl font-bold text-theme-heading mb-2">
          Review job
        </h1>
        <p className="text-sm text-theme-text mb-4">
          {job.title}
        </p>

        {myReview ? (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-400">You already reviewed this job.</p>
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm text-stellar-blue hover:underline block mt-2"
            >
              Return to job details
            </Link>
          </div>
        ) : !job.freelancer ? (
          <p className="text-sm text-theme-text">
            This job has no freelancer assigned.
          </p>
        ) : job.status !== "COMPLETED" ? (
          <p className="text-sm text-theme-text">
            You can only review completed jobs.
          </p>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setModalOpen(true)}
          >
            Open review form
          </button>
        )}
      </div>

      {reviewee && job.freelancer && !myReview && job.status === "COMPLETED" && (
        <ReviewModal
          job={job}
          revieweeId={reviewee.id}
          revieweeName={reviewee.name}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            fetchData();
          }}
        />
      )}
    </div>
  );
}
