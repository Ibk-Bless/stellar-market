export default function MessageSkeleton() {
  return (
    <div className="card animate-pulse flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-theme-border shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-theme-border rounded w-1/4" />
        <div className="h-3 bg-theme-border rounded w-1/2" />
      </div>
    </div>
  );
}
