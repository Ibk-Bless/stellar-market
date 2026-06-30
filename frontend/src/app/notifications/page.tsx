"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Bell, CheckSquare, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { Notification, PaginatedResponse } from "@/types";
import NotificationItem from "@/components/NotificationItem";
import Pagination from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export default function NotificationsPage() {
  const { token, user } = useAuth();
  const { liveNotifications, dismissLiveNotification } = useSocket();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const mergedNotifications = [
    ...liveNotifications,
    ...notifications.filter(
      (n) => !liveNotifications.some((ln) => ln.id === n.id),
    ),
  ];

  const limit = 10;

  // Track which notification IDs have already been queued for marking as read
  const markedRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fetchNotifications = useCallback(
    async (p: number) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await axios.get<PaginatedResponse<Notification>>(
          `${API}/notifications?page=${p}&limit=${limit}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        setNotifications(res.data.data);
        setTotal(res.data.total);
      } catch (error) {
        console.error("Failed to fetch notifications:", error);
      } finally {
        setLoading(false);
      }
    },
    [token, limit],
  );

  useEffect(() => {
    fetchNotifications(page);
  }, [page, token, fetchNotifications]);

  // Reset marked set when page changes
  useEffect(() => {
    markedRef.current.clear();
  }, [page]);

  const markAsRead = useCallback(
    async (notification: Notification) => {
      if (notification.read || !token) return;
      if (markedRef.current.has(notification.id)) return;
      markedRef.current.add(notification.id);

      try {
        await axios.put(
          `${API}/notifications/${notification.id}/read`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, read: true } : n,
          ),
        );
      } catch (error) {
        // Allow retry on failure
        markedRef.current.delete(notification.id);
        console.error("Failed to mark as read:", error);
      }
    },
    [token],
  );

  // IntersectionObserver: mark notifications as read when they scroll into view
  useEffect(() => {
    if (loading || !notifications.length) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const notificationId = (entry.target as HTMLElement).dataset
              .notificationId;
            if (notificationId) {
              const notification = notifications.find(
                (n) => n.id === notificationId,
              );
              if (notification && !notification.read) {
                markAsRead(notification);
              }
            }
          }
        });
      },
      { threshold: 0.5 },
    );

    rowRefs.current.forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [loading, notifications, markAsRead]);

  const setRowRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) {
        rowRefs.current.set(id, el);
      } else {
        rowRefs.current.delete(id);
      }
    },
    [],
  );

  const markAllAsRead = async () => {
    if (!token) return;
    setMarkingAll(true);
    try {
      await axios.put(
        `${API}/notifications/read-all`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    } finally {
      setMarkingAll(false);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!token) return;
    try {
      await axios.delete(`${API}/notifications/${notificationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      dismissLiveNotification(notificationId);
      setTotal((t) => Math.max(0, t - 1));
    } catch (error) {
      console.error("Failed to delete notification:", error);
    }
  };

  const clearReadNotifications = async () => {
    if (!token) return;
    try {
      await axios.delete(`${API}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.filter((n) => !n.read));
      setTotal((t) =>
        Math.max(0, t - notifications.filter((n) => n.read).length),
      );
    } catch (error) {
      console.error("Failed to clear read notifications:", error);
    }
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-theme-heading">
          Please log in to view notifications
        </h1>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-theme-heading flex items-center gap-3">
            <Bell size={28} className="text-stellar-blue" />
            Notifications
          </h1>
          <p className="text-theme-text mt-2">
            Manage your platform activity and updates
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={clearReadNotifications}
            disabled={notifications.every((n) => !n.read)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-border/50 text-theme-heading hover:bg-theme-border transition-colors disabled:opacity-50 text-sm font-medium border border-theme-border"
          >
            <Trash2 size={14} />
            Clear read
          </button>

          <button
            onClick={markAllAsRead}
            disabled={markingAll || notifications.every((n) => n.read)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-border/50 text-theme-heading hover:bg-theme-border transition-colors disabled:opacity-50 text-sm font-medium border border-theme-border"
          >
            <CheckSquare size={16} />
            {markingAll ? "Marking..." : "Mark all as read"}
          </button>
        </div>
      </div>

      <div className="bg-theme-card border border-theme-border rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-20 text-center">
            <div className="w-12 h-12 border-4 border-stellar-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-theme-text">Loading notifications...</p>
          </div>
        ) : mergedNotifications.length > 0 ? (
          <>
            <div className="divide-y divide-theme-border">
              {mergedNotifications.map((notification) => (
                <div
                  key={notification.id}
                  ref={setRowRef(notification.id)}
                  data-notification-id={notification.id}
                >
                  <NotificationItem
                    notification={notification}
                    onClick={markAsRead}
                    onDelete={(n) => deleteNotification(n.id)}
                    className="py-6 px-6"
                  />
                </div>
              ))}
            </div>

            {total > limit && (
              <div className="p-6 border-t border-theme-border">
                <Pagination
                  page={page}
                  totalPages={Math.ceil(total / limit)}
                  total={total}
                  limit={limit}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="We'll notify you when something important happens on the platform."
          />
        )}
      </div>
    </div>
  );
}
