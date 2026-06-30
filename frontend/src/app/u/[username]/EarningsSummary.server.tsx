const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type Props = { userPromise: Promise<any> };

export default async function EarningsSummary({ userPromise }: Props) {
  const user = await userPromise;
  const res = await fetch(`${API_URL}/freelancer/earnings/summary?freelancerId=${encodeURIComponent(user.id)}`, {
    next: { revalidate: 60 },
  });
  const summary = res.ok ? await res.json() : null;

  return (
    <section className="card mt-6">
      <h3 className="text-lg font-semibold mb-3">Earnings</h3>
      {summary ? (
        <div>
          <div className="text-2xl font-bold">{summary.total ?? 0}</div>
          <div className="text-sm text-theme-text/60">Total earnings</div>
        </div>
      ) : (
        <p className="text-sm text-theme-text/60">No earnings data available.</p>
      )}
    </section>
  );
}
