"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import axios from "axios";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import NotificationItem from "@/components/NotificationItem";
import { Notification, PaginatedResponse } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

// Shared channel name for cross-tab read-state synchronization.
const BC_CHANNEL = "stellarmarket:notifications";

// Only surface notifications from the last 30 days in the dropdown.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DROPDOWN_LIMIT = 20;

export default function NotificationBell() {
    const { socket } = useSocket();
    const { token, user } = useAuth();
    const pathname = usePathname();
    const [unreadCount, setUnreadCount] = useState(0);
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Tracks which socket instance has listeners attached so reconnects
    // don't result in duplicated event handlers.
    const listenerSocketRef = useRef<typeof socket>(null);

    const fetchUnreadCount = useCallback(async () => {
        if (!token) return;
        try {
            const res = await axios.get<{ count: number }>(`${API}/notifications/unread-count`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setUnreadCount(res.data.count);
        } catch (error) {
            console.error("Failed to fetch unread count:", error);
        }
    }, [token]);

    // Fetch the most recent notifications for the dropdown, dropping anything
    // older than 30 days per the acceptance criteria.
    const fetchNotifications = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const res = await axios.get<PaginatedResponse<Notification>>(
                `${API}/notifications?page=1&limit=${DROPDOWN_LIMIT}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const cutoff = Date.now() - MAX_AGE_MS;
            setNotifications(
                res.data.data.filter((n) => new Date(n.createdAt).getTime() >= cutoff),
            );
        } catch (error) {
            console.error("Failed to fetch notifications:", error);
        } finally {
            setLoading(false);
        }
    }, [token]);

    // Initial fetch and polling every 30s as a safety net against missed events.
    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000);
        return () => clearInterval(interval);
    }, [fetchUnreadCount]);

    // Close the dropdown automatically if the user navigates elsewhere.
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    const broadcastRead = useCallback(() => {
        if (typeof window === "undefined") return;
        try {
            const bc = new BroadcastChannel(BC_CHANNEL);
            bc.postMessage({ type: "read" });
            bc.close();
        } catch {
            // BroadcastChannel unavailable in some private-browsing contexts
        }
    }, []);

    const markAllAsRead = useCallback(async () => {
        setUnreadCount(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        broadcastRead();
        if (!token) return;
        try {
            await axios.put(
                `${API}/notifications/read-all`,
                {},
                { headers: { Authorization: `Bearer ${token}` } },
            );
        } catch {
            // keep UI responsive; unread count will reconcile on next poll/socket update
        }
    }, [token, broadcastRead]);

    // Clicking a notification marks just that one read and lets the underlying
    // Link navigate to the relevant page.
    const handleNotificationClick = useCallback(
        (notification: Notification) => {
            setOpen(false);
            if (notification.read) return;
            setUnreadCount((prev) => Math.max(0, prev - 1));
            setNotifications((prev) =>
                prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
            );
            if (!token) return;
            axios
                .put(
                    `${API}/notifications/${notification.id}/read`,
                    {},
                    { headers: { Authorization: `Bearer ${token}` } },
                )
                .catch(() => {
                    // count reconciles on next poll/socket update
                });
        },
        [token],
    );

    const toggleOpen = useCallback(() => {
        setOpen((prev) => {
            const next = !prev;
            if (next) fetchNotifications();
            return next;
        });
    }, [fetchNotifications]);

    const close = useCallback(() => setOpen(false), []);

    // Focus trap + Escape-to-close while the dropdown is open.
    useFocusTrap(containerRef, { open, onClose: close });

    // Close when clicking outside the bell/dropdown.
    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    // Cross-tab synchronization via BroadcastChannel.
    // When another tab marks notifications read this tab resets its badge too.
    useEffect(() => {
        if (typeof window === "undefined") return;

        let bc: BroadcastChannel;
        try {
            bc = new BroadcastChannel(BC_CHANNEL);
        } catch {
            // BroadcastChannel not supported
            return;
        }

        const handleMessage = (event: MessageEvent<{ type: string }>) => {
            if (event.data?.type === "read") {
                setUnreadCount(0);
                setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
            }
        };

        bc.addEventListener("message", handleMessage);
        return () => {
            bc.removeEventListener("message", handleMessage);
            bc.close();
        };
    }, []);

    // Socket event listeners.
    // The ref guard ensures we only attach once per socket instance — this prevents
    // duplicate increments when the SocketProvider re-renders without changing
    // the underlying socket object.
    useEffect(() => {
        if (!socket) return;
        if (listenerSocketRef.current === socket) return;
        listenerSocketRef.current = socket;

        const handleNewNotification = () => {
            setUnreadCount((prev: number) => prev + 1);
        };

        const handleNotificationsRead = () => {
            setUnreadCount(0);
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        };

        // Re-sync the authoritative count from the server after every (re)connect
        // so a network interruption never leaves the badge showing stale data.
        const handleConnect = () => {
            fetchUnreadCount();
        };

        socket.on("notification:new", handleNewNotification);
        socket.on("notifications:read", handleNotificationsRead);
        socket.on("connect", handleConnect);

        return () => {
            socket.off("notification:new", handleNewNotification);
            socket.off("notifications:read", handleNotificationsRead);
            socket.off("connect", handleConnect);
            listenerSocketRef.current = null;
        };
    }, [socket, fetchUnreadCount]);

    if (!user) return null;

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={toggleOpen}
                className="relative p-2 rounded-lg text-theme-text hover:text-theme-heading hover:bg-theme-border/50 transition-colors"
                aria-label="Notifications"
                aria-haspopup="true"
                aria-expanded={open}
                id="notification-bell"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-theme-error opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-theme-error text-[10px] text-white font-bold items-center justify-center">
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                    </span>
                )}
                <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {unreadCount > 0 ? `${unreadCount} unread notifications` : "No unread notifications"}
                </span>
            </button>

            {open && (
                <div
                    ref={containerRef}
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-1rem)] bg-theme-card border border-theme-border rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2"
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
                        <h2 className="text-sm font-semibold text-theme-heading">Notifications</h2>
                        <button
                            type="button"
                            onClick={markAllAsRead}
                            disabled={unreadCount === 0}
                            className="flex items-center gap-1 text-xs font-medium text-stellar-blue hover:text-stellar-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <CheckCheck size={14} />
                            Mark all as read
                        </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-10 text-theme-text">
                                <Loader2 size={20} className="animate-spin" />
                            </div>
                        ) : notifications.length === 0 ? (
                            <p className="px-4 py-10 text-center text-sm text-theme-text">
                                You&apos;re all caught up.
                            </p>
                        ) : (
                            notifications.map((n) => (
                                <NotificationItem
                                    key={n.id}
                                    notification={n}
                                    onClick={handleNotificationClick}
                                />
                            ))
                        )}
                    </div>

                    <div className="border-t border-theme-border px-4 py-2.5">
                        <Link
                            href="/notifications"
                            onClick={close}
                            className="block text-center text-xs font-medium text-stellar-blue hover:text-stellar-blue/80 transition-colors"
                        >
                            View all notifications
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
