"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { Job, PaginatedResponse } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const LOCAL_STORAGE_KEY = "stellarmarket_saved_jobs";

function readLocalSavedJobs(): Job[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Job[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSavedJobs(jobs: Job[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(jobs));
}

export function useSavedJobs() {
  const { user, token } = useAuth();
  const [savedJobs, setSavedJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const migratedRef = useRef(false);

  const isServerBacked = Boolean(token && user?.role === "FREELANCER");

  const refreshSavedJobs = useCallback(async () => {
    setIsLoading(true);

    try {
      if (isServerBacked) {
        const response = await axios.get<PaginatedResponse<Job>>(
          `${API_URL}/jobs/saved`,
          {
            params: { page: 1, limit: 100 },
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        setSavedJobs(response.data.data ?? []);
        return;
      }

      setSavedJobs(readLocalSavedJobs());
    } catch {
      setSavedJobs(isServerBacked ? readLocalSavedJobs() : []);
    } finally {
      setIsLoading(false);
    }
  }, [isServerBacked, token]);

  const migrateLocalSavedJobs = useCallback(async () => {
    if (!isServerBacked || migratedRef.current) return;

    const localJobs = readLocalSavedJobs();
    if (localJobs.length === 0) {
      migratedRef.current = true;
      await refreshSavedJobs();
      return;
    }

    try {
      const savedIds = new Set(
        (
          await axios.get<PaginatedResponse<Job>>(`${API_URL}/jobs/saved`, {
            params: { page: 1, limit: 100 },
            headers: { Authorization: `Bearer ${token}` },
          })
        ).data.data.map((job) => job.id),
      );

      await Promise.all(
        localJobs
          .filter((job) => !savedIds.has(job.id))
          .map((job) =>
            axios.post(
              `${API_URL}/jobs/${job.id}/save`,
              {},
              {
                headers: { Authorization: `Bearer ${token}` },
              },
            ),
          ),
      );
      writeLocalSavedJobs([]);
      migratedRef.current = true;
    } catch {
      // Leave local storage untouched if the migration fails.
    } finally {
      await refreshSavedJobs();
    }
  }, [isServerBacked, refreshSavedJobs, token]);

  useEffect(() => {
    void migrateLocalSavedJobs();
  }, [migrateLocalSavedJobs]);

  useEffect(() => {
    if (isServerBacked) return;
    void refreshSavedJobs();
  }, [isServerBacked, refreshSavedJobs]);

  const savedJobIds = useMemo(() => new Set(savedJobs.map((job) => job.id)), [savedJobs]);

  const toggleSavedJob = useCallback(
    async (job: Job) => {
      try {
        if (isServerBacked) {
          const headers = { Authorization: `Bearer ${token}` };
          if (savedJobIds.has(job.id)) {
            await axios.delete(`${API_URL}/jobs/${job.id}/save`, { headers });
            setSavedJobs((prev) => prev.filter((saved) => saved.id !== job.id));
          } else {
            await axios.post(`${API_URL}/jobs/${job.id}/save`, {}, { headers });
            setSavedJobs((prev) => [
              { ...job, isSaved: true, savedAt: new Date().toISOString() },
              ...prev.filter((saved) => saved.id !== job.id),
            ]);
          }
          return;
        }

        const current = readLocalSavedJobs();
        const exists = current.some((saved) => saved.id === job.id);
        const next = exists
          ? current.filter((saved) => saved.id !== job.id)
          : [{ ...job, isSaved: true, savedAt: new Date().toISOString() }, ...current];
        writeLocalSavedJobs(next);
        setSavedJobs(next);
      } catch {
        // Keep the current state if the server call fails.
      }
    },
    [isServerBacked, savedJobIds, token],
  );

  return {
    savedJobs,
    savedJobIds,
    isLoading,
    refreshSavedJobs,
    toggleSavedJob,
    isServerBacked,
  };
}
