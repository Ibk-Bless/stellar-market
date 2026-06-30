export default function HeaderSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-28 h-28 rounded-full bg-theme-border" />
        <div className="flex-1 space-y-3">
          <div className="h-6 bg-theme-border rounded w-1/3" />
          <div className="h-4 bg-theme-border rounded w-1/2 mt-2" />
        </div>
      </div>
    </div>
  );
}
