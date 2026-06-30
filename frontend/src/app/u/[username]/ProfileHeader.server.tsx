const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type Props = { userPromise: Promise<any> };

export default async function ProfileHeader({ userPromise }: Props) {
  const user = await userPromise;
  return (
    <header className="flex flex-col sm:flex-row gap-6 items-start mb-10">
      <div className="w-28 h-28 rounded-full bg-gradient-to-br from-stellar-blue to-stellar-purple flex-shrink-0 flex items-center justify-center overflow-hidden border-4 border-theme-card">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={user.username} width={112} height={112} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/50">U</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h1 className="text-3xl font-bold text-theme-heading truncate">{user.username}</h1>
          <span className="text-xs font-medium text-stellar-purple bg-stellar-purple/10 px-2.5 py-1 rounded-full border border-stellar-purple/20">
            {user.role}
          </span>
        </div>

        <p className="text-base text-theme-text mb-4 max-w-2xl">{user.bio || "No bio provided."}</p>

        {user.skills?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {user.skills.map((s: string, i: number) => (
              <span key={i} className="px-2.5 py-1 bg-theme-card border border-theme-border rounded-full text-xs text-theme-text">
                {s}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-5 text-sm text-theme-text">
          <div className="flex items-center gap-1.5">
            <div className="text-theme-warning font-semibold text-xl">{Math.round(user.averageRating || 0)}</div>
            <div className="ml-2 text-theme-text/60">({user.reviewCount || 0} reviews)</div>
          </div>
          <div className="flex items-center gap-1.5">Member since {new Date(user.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
    </header>
  );
}
