import React from "react";
import Link from "next/link";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Primary action button */
  action?: {
    label: string;
    /** href renders a <Link>; onClick renders a <button> */
    href?: string;
    onClick?: () => void;
  };
  /** Optional secondary action (e.g. "Clear filters") */
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Small marker layered over the illustration, e.g. a question mark. */
  iconOverlay?: string;
  children?: React.ReactNode;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  iconOverlay,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-theme-card border border-theme-border mb-6">
        <Icon className="text-stellar-blue" size={36} />
        {iconOverlay && (
          <span className="absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-theme-bg bg-stellar-purple text-sm font-bold text-white" aria-hidden="true">
            {iconOverlay}
          </span>
        )}
      </div>

      <h3 className="text-xl font-semibold text-theme-heading mb-2">{title}</h3>
      <p className="text-theme-text max-w-sm mx-auto mb-6">{description}</p>

      {children}

      <div className="flex flex-col sm:flex-row items-center gap-3">
        {action && (
          action.href ? (
            <Link href={action.href} className="btn-primary">
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className="btn-primary">
              {action.label}
            </button>
          )
        )}

        {secondaryAction && (
          secondaryAction.href ? (
            <Link href={secondaryAction.href} className="btn-secondary">
              {secondaryAction.label}
            </Link>
          ) : (
            <button onClick={secondaryAction.onClick} className="btn-secondary">
              {secondaryAction.label}
            </button>
          )
        )}
      </div>
    </div>
  );
}
