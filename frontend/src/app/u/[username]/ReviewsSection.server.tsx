const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type Props = { userPromise: Promise<any> };

export default async function ReviewsSection({ userPromise }: Props) {
  const user = await userPromise;
  const res = await fetch(`${API_URL}/reviews?targetId=${encodeURIComponent(user.id)}`, {
    next: { revalidate: 60 },
  });
  const reviews = res.ok ? await res.json() : [];

  return (
    <section aria-labelledby="reviews-heading" className="card">
      <h2 id="reviews-heading" className="text-xl font-semibold mb-4">Reviews ({reviews.length})</h2>
      {reviews.length === 0 ? (
        <p className="text-sm text-theme-text/60 py-8 text-center border border-dashed border-theme-border rounded-xl">No reviews yet.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r: any) => (
            <div key={r.id} className="p-4 border border-theme-border rounded-md">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium text-theme-heading">{r.reviewer?.username ?? 'Anonymous'}</div>
                  {r.job && <div className="text-xs text-theme-text/60">on {r.job.title}</div>}
                </div>
                <div className="text-sm text-theme-text/60">{new Date(r.createdAt).toLocaleDateString()}</div>
              </div>
              {r.comment && <p className="text-sm text-theme-text italic">"{r.comment}"</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
