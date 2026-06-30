export default function PortfolioSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      <div className="h-40 bg-theme-border rounded animate-pulse" />
      <div className="h-40 bg-theme-border rounded animate-pulse" />
      <div className="h-40 bg-theme-border rounded animate-pulse" />
    </div>
  );
}
