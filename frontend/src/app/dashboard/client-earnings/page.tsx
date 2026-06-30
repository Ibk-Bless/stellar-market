import dynamic from "next/dynamic";

const ClientEarningsPage = dynamic(() => import("../client-earnings-page"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
});

export default function ClientEarningsRoute() {
  return <ClientEarningsPage />;
}
