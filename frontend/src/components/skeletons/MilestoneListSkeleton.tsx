export default function MilestoneListSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-4 w-48 bg-theme-border rounded" />
            <div className="h-3.5 w-64 bg-theme-border rounded" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="h-4 w-16 bg-theme-border rounded" />
            <div className="h-6 w-20 bg-theme-border rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
