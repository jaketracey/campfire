export default function CompanionProfileLoading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Hero skeleton */}
        <div className="flex flex-col items-center text-center mb-12">
          <div className="w-32 h-32 rounded-full bg-white/10 animate-pulse mb-6" />
          <div className="h-10 w-64 bg-white/10 animate-pulse rounded mb-4" />
          <div className="h-6 w-96 bg-white/10 animate-pulse rounded" />
        </div>

        {/* Content skeleton */}
        <div className="space-y-8">
          <div className="bg-white/5 rounded-2xl p-8">
            <div className="h-6 w-32 bg-white/10 animate-pulse rounded mb-4" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-white/10 animate-pulse rounded" />
              <div className="h-4 w-3/4 bg-white/10 animate-pulse rounded" />
            </div>
          </div>

          <div className="bg-white/5 rounded-2xl p-8">
            <div className="h-6 w-32 bg-white/10 animate-pulse rounded mb-4" />
            <div className="flex gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-24 bg-white/10 animate-pulse rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
