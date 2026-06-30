"use client";

import Link from "next/link";
import {
  MessageSquare,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  FileText,
  User as UserIcon,
  Trash2,
} from "lucide-react";
import { Notification, NotificationType } from "@/types";
import { formatRelativeTime } from "@/utils/date";
import { formatLocalTimestamp, formatUtcTimestamp } from "@/components/LocalTimestamp";

interface NotificationItemProps {
  notification: Notification;
  onClick?: (notification: Notification) => void;
  onDelete?: (notification: Notification) => void;
  className?: string;
}

const getNotificationIcon = (type: NotificationType) => {
  switch (type) {
    case "NEW_MESSAGE":
      return <MessageSquare size={16} className="text-stellar-blue" />;
    case "JOB_APPLIED":
      return <UserIcon size={16} className="text-stellar-purple" />;
    case "APPLICATION_ACCEPTED":
      return <CheckCircle2 size={16} className="text-stellar-green" />;
    case "MILESTONE_SUBMITTED":
      return <FileText size={16} className="text-stellar-blue" />;
    case "MILESTONE_APPROVED":
      return <CheckCircle2 size={16} className="text-stellar-green" />;
    case "DISPUTE_RAISED":
      return <AlertTriangle size={16} className="text-theme-error" />;
    case "DISPUTE_RESOLVED":
      return <CheckCircle2 size={16} className="text-stellar-green" />;
    default:
      return <Briefcase size={16} className="text-theme-text" />;
  }
};

const getNotificationLink = (notification: Notification) => {
  const { type, metadata } = notification;
  switch (type) {
    case "NEW_MESSAGE":
      return `/messages?jobId=${metadata?.jobId}`;
    case "JOB_APPLIED":
    case "APPLICATION_ACCEPTED":
      return `/jobs/${metadata?.jobId}`;
    case "MILESTONE_SUBMITTED":
    case "MILESTONE_APPROVED":
      return `/jobs/${metadata?.jobId}`;
    case "DISPUTE_RAISED":
    case "DISPUTE_RESOLVED":
      return `/disputes/${metadata?.disputeId}`;
    default:
      return "/notifications";
  }
};

export default function NotificationItem({
  notification,
  onClick,
  onDelete,
  className = "",
}: NotificationItemProps) {
  return (
    <Link
      href={getNotificationLink(notification)}
      onClick={() => onClick?.(notification)}
      className={`flex items-start gap-3 p-4 hover:bg-theme-border/30 transition-colors border-b border-theme-border last:border-0 ${!notification.read ? "bg-stellar-blue/5" : ""} ${className}`}
    >
      <div className="mt-1 w-8 h-8 rounded-full bg-theme-border/50 flex items-center justify-center flex-shrink-0">
        {getNotificationIcon(notification.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start gap-2">
          <p className="text-sm font-semibold text-theme-heading truncate">
            {notification.title}
          </p>
          <div className="flex items-center gap-2">
            {!notification.read && (
              <span className="w-2 h-2 rounded-full bg-stellar-blue mt-1.5 flex-shrink-0" />
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(notification);
                }}
                aria-label="Delete notification"
                className="p-1 rounded hover:bg-theme-border/20"
              >
                <Trash2 size={14} className="text-theme-text/80" />
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-theme-text line-clamp-2 mt-0.5">
          {notification.message}
        </p>
        <time
          dateTime={notification.createdAt}
          title={`${formatLocalTimestamp(notification.createdAt)} · ${formatUtcTimestamp(notification.createdAt)}`}
          className="text-[10px] text-theme-text/60 mt-1 block"
        >
          {formatRelativeTime(notification.createdAt)}
        </time>
      </div>
    </Link>
  );
}
