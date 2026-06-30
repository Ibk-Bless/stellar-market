const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1").replace(/\/api\/?$/, "");

type Props = { userPromise: Promise<any> };

export default async function PortfolioSection({ userPromise }: Props) {
  const user = await userPromise;
  const res = await fetch(`${API_URL}/portfolio/${encodeURIComponent(user.id)}`, { next: { revalidate: 60 } });
  const items = res.ok ? await res.json() : [];

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="portfolio-heading" className="card">
      <h2 id="portfolio-heading" className="text-xl font-semibold mb-6">Portfolio</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item: any) => (
          <div key={item.id} className="rounded-xl overflow-hidden border border-theme-border bg-theme-card">
            {item.mimeType?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${BASE_URL}${item.fileUrl}`} alt={item.title} className="w-full h-48 object-cover" />
            ) : (
              <div className="py-8 px-4 flex flex-col items-center">
                <div className="text-theme-text/40 mb-2">File</div>
                <div className="text-xs text-theme-text">{item.fileName}</div>
              </div>
            )}
            <div className="p-3">
              <div className="font-medium text-theme-heading text-sm">{item.title}</div>
              {item.description && <div className="text-xs text-theme-text/70 mt-1 line-clamp-2">{item.description}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
