const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

type Props = { userPromise: Promise<any> };

export default async function JobHistory({ userPromise }: Props) {
  const user = await userPromise;
  const res = await fetch(`${API_URL}/jobs?freelancerId=${encodeURIComponent(user.id)}`, {
    next: { revalidate: 60 },
  });
  const jobs = res.ok ? await res.json() : [];

  return (
    <section aria-labelledby="jobs-heading" className="card mb-6">
      <h3 id="jobs-heading" className="text-lg font-semibold mb-3">Jobs</h3>
      {jobs.length === 0 ? (
        <p className="text-sm text-theme-text/60">No jobs yet.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j: any) => (
            <li key={j.id} className="p-3 border border-theme-border rounded-md">{j.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
