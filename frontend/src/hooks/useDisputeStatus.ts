"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Dispute } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

// Terminal statuses where polling should stop
const TERMINAL_STATUSES = ["RESOLVED_CLIENT", "RESOLVED_FREELANCER", "ESCALATED"] as const;

interface UseDisputeStatusOptions {
  disputeId: string;
  enabled?: boolean;
  initialInterval?: number;
  maxInterval?: number;
}

interface UseDisputeStatusReturn {
  dispute: Dispute | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for polling dispute status with exponential backoff
 * 
 * Polls GET /disputes/:id on an interval with exponential backoff:
 * - Starts at 2s
 * - Doubles on each poll: 2s → 4s → 8s → 16s → 30s (max)
 * - Stops polling when dispute reaches terminal status (RESOLVED_CLIENT, RESOLVED_FREELANCER, ESCALATED)
 * 
 * @param options - Configuration options
 * @param options.disputeId - The ID of the dispute to poll
 * @param options.enabled - Whether polling is enabled (default: true)
 * @param options.initialInterval - Initial polling interval in ms (default: 2000)
 * @param options.maxInterval - Maximum polling interval in ms (default: 30000)
 * 
 * @returns Object containing dispute data, loading state, error, and refetch function
 */
export function useDisputeStatus({
  disputeId,
  enabled = true,
  initialInterval = 2000,
  maxInterval = 30000,
}: UseDisputeStatusOptions): UseDisputeStatusReturn {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentIntervalRef = useRef<number>(initialInterval);
  const isMountedRef = useRef(true);

  const fetchDispute = useCallback(async () => {
    if (!disputeId) {
      setError("Dispute ID is required");
      setIsLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem("token");
      const res = await axios.get<Dispute>(`${API_URL}/disputes/${disputeId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (isMountedRef.current) {
        setDispute(res.data);
        setError(null);
        setIsLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError("Failed to fetch dispute details");
        setIsLoading(false);
      }
    }
  }, [disputeId]);

  const isTerminalStatus = useCallback((status: string): boolean => {
    return TERMINAL_STATUSES.includes(status as typeof TERMINAL_STATUSES[number]);
  }, []);

  const scheduleNextPoll = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
    }

    intervalRef.current = setTimeout(async () => {
      await fetchDispute();

      // Check if we should continue polling
      const currentDispute = dispute;
      if (currentDispute && isTerminalStatus(currentDispute.status)) {
        // Stop polling for terminal statuses
        return;
      }

      // Exponential backoff: double the interval, capped at maxInterval
      currentIntervalRef.current = Math.min(
        currentIntervalRef.current * 2,
        maxInterval
      );

      // Schedule next poll
      scheduleNextPoll();
    }, currentIntervalRef.current);
  }, [dispute, fetchDispute, maxInterval, isTerminalStatus]);

  const startPolling = useCallback(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
    }

    // Reset interval to initial value
    currentIntervalRef.current = initialInterval;

    // Initial fetch
    fetchDispute().then(() => {
      // Start polling after initial fetch
      scheduleNextPoll();
    });
  }, [fetchDispute, initialInterval, scheduleNextPoll]);

  // Initialize polling
  useEffect(() => {
    if (!enabled || !disputeId) {
      return;
    }

    startPolling();

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, disputeId, startPolling]);

  // Stop polling when terminal status is reached
  useEffect(() => {
    if (dispute && isTerminalStatus(dispute.status)) {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [dispute, isTerminalStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchDispute();
  }, [fetchDispute]);

  return {
    dispute,
    isLoading,
    error,
    refetch,
  };
}
