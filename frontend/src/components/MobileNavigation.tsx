"use client";

import Link from "next/link";
import { Briefcase, LayoutDashboard, ShieldCheck, User } from "lucide-react";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/jobs", icon: Briefcase, label: "Jobs" },
  { href: "/disputes", icon: ShieldCheck, label: "Disputes" },
  { href: "/profile", icon: User, label: "Profile" },
];

export default function MobileNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-theme-border bg-theme-card/95 px-2 backdrop-blur md:hidden"
    >
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            data-active={isActive ? "true" : "false"}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md transition-colors ${
              isActive
                ? "active text-stellar-blue font-bold"
                : "text-theme-text hover:text-theme-heading"
            }`}
          >
            <Icon size={isActive ? 22 : 20} strokeWidth={isActive ? 2.75 : 2} />
            <span className={isActive ? "text-[10px] leading-none" : "hidden min-[420px]:block text-[10px] leading-none"}>
              {item.label}
            </span>
            {isActive && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t bg-stellar-blue" aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}
