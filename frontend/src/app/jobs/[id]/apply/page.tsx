"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import axios from "axios";
import ApplyModal from "@/components/ApplyModal";
import { useAuth } from "@/context/AuthContext";
import { Job } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export default function ApplyPage() {
  const params = useParams();
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const jobId = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await axios.get(`${API}/jobs/${jobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        setJob(res.data);
      } catch {
        setError("Failed to load job details.");
      } finally {
        setLoading(false);
      }
    }

    if (jobId) fetchJob();
  }, [jobId, token]);

  if (authLoading || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-dark-card rounded w-1/3" />
          <div className="h-40 bg-dark-card rounded" />
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-red-400 mb-4">{error || "Job not found."}</p>
        <Link href="/jobs" className="text-stellar-blue hover:underline">
          Back to Jobs
        </Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-dark-text mb-4">
          You need to be logged in to apply.
        </p>
        <Link href="/auth/login" className="btn-primary inline-block">
          Log In
        </Link>
      </div>
    );
  }

  if (user.id === job.client.id) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-dark-text mb-4">
          You cannot apply to your own job.
        </p>
        <Link
          href={`/jobs/${jobId}`}
          className="text-stellar-blue hover:underline"
        >
          Back to Job
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <Link
        href={`/jobs/${jobId}`}
        className="flex items-center gap-2 text-dark-text hover:text-dark-heading mb-8 transition-colors"
      >
        <ArrowLeft size={18} /> Back to Job
      </Link>

      <ApplyModal
        job={job}
        isOpen={true}
        onClose={() => router.push(`/jobs/${jobId}`)}
        onSuccess={() => router.push(`/jobs/${jobId}`)}
      />
    </div>
  );
}
