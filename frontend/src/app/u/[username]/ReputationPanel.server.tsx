const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type Props = { userPromise: Promise<any> };

export default async function ReputationPanel({ userPromise }: Props) {
  const user = await userPromise;
  if (!user.walletAddress) {
    return (
      <aside className="card">
        <h3 className="text-lg font-semibold mb-2">Reputation</h3>
        <p className="text-sm text-theme-text/60">No wallet connected.</p>
      </aside>
    );
  }

  const res = await fetch(`${API_URL}/reputation/${encodeURIComponent(user.walletAddress)}`, {
    next: { revalidate: 30 },
  });
  const reputation = res.ok ? await res.json() : null;

  return (
    <aside className="card">
      <h3 className="text-lg font-semibold mb-2">Reputation</h3>
      {reputation ? (
        <div>
          <div className="text-2xl font-bold">{reputation.score ?? "—"}</div>
          <div className="text-sm text-theme-text/60">Staked: {reputation.stake ?? 0}</div>
        </div>
      ) : (
        <p className="text-sm text-theme-text/60">Unable to load reputation.</p>
      )}
    </aside>
  );
}
