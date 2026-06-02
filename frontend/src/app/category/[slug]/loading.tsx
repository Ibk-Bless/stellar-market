export default function CategoryLoading() {
  return (
    <div className="min-h-screen">
      <div className="bg-gradient-to-b from-stellar-blue/5 to-theme-bg border-b border-theme-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-theme-border/50 animate-pulse" />
            <div className="flex-1">
              <div className="h-10 w-64 bg-theme-border/50 rounded-lg animate-pulse mb-3" />
              <div className="h-5 w-96 bg-theme-border/50 rounded animate-pulse mb-6" />
              <div className="flex gap-6">
                <div className="h-5 w-32 bg-theme-border/50 rounded animate-pulse" />
                <div className="h-5 w-36 bg-theme-border/50 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-theme-card border border-theme-border rounded-xl h-64" />
          ))}
        </div>
      </div>
    </div>
  );
}
