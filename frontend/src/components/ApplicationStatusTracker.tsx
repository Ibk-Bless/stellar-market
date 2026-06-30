'use client';

import React from 'react';
import { CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';
import LocalTimestamp from '@/components/LocalTimestamp';

interface ApplicationStatusTrackerProps {
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  submittedAt: string;
  lastUpdated?: string;
  showTimeline?: boolean;
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: 'text-theme-warning',
    bgColor: 'bg-theme-warning/10',
    borderColor: 'border-theme-warning/20',
    label: 'Pending Review'
  },
  accepted: {
    icon: CheckCircle,
    color: 'text-theme-success',
    bgColor: 'bg-theme-success/10',
    borderColor: 'border-theme-success/20',
    label: 'Accepted'
  },
  rejected: {
    icon: XCircle,
    color: 'text-theme-error',
    bgColor: 'bg-theme-error/10',
    borderColor: 'border-theme-error/20',
    label: 'Rejected'
  },
  withdrawn: {
    icon: AlertCircle,
    color: 'text-theme-text',
    bgColor: 'bg-theme-bg-secondary',
    borderColor: 'border-theme-border',
    label: 'Withdrawn'
  }
};

export default function ApplicationStatusTracker({
  status,
  submittedAt,
  lastUpdated,
  showTimeline = true
}: ApplicationStatusTrackerProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`p-4 rounded-lg border ${config.borderColor} ${config.bgColor}`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-5 h-5 ${config.color}`} />
        <div>
          <h3 className="font-semibold text-theme-heading">{config.label}</h3>
          <p className="text-sm text-theme-text">
            Submitted <LocalTimestamp isoString={submittedAt} />
          </p>
        </div>
      </div>

      {showTimeline && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 bg-stellar-blue rounded-full"></div>
            <span className="text-theme-text">Application submitted</span>
            <LocalTimestamp isoString={submittedAt} className="text-theme-text ml-auto" />
          </div>
          
          {status !== 'pending' && (
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${
                status === 'accepted' ? 'bg-theme-success' : 
                status === 'rejected' ? 'bg-theme-error' : 'bg-theme-text'
              }`}></div>
              <span className="text-theme-text">Status updated to {config.label.toLowerCase()}</span>
              {lastUpdated
                ? <LocalTimestamp isoString={lastUpdated} className="text-theme-text ml-auto" />
                : <span className="text-theme-text ml-auto">Recently</span>
              }
            </div>
          )}
        </div>
      )}

      {status === 'pending' && (
        <div className="mt-3 p-2 bg-stellar-blue/10 rounded text-sm text-stellar-blue">
          💡 Your application is being reviewed. You'll be notified of any updates.
        </div>
      )}
    </div>
  );
}