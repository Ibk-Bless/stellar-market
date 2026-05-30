import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";
import Footer from "@/components/Footer";
import Providers from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "StellarMarket — Decentralized Freelance Marketplace",
    template: "%s | StellarMarket",
  },
  description:
    "A decentralized freelance marketplace built on Stellar/Soroban with escrow payments, on-chain reputation, and dispute resolution.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://stellarmarket.io"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "StellarMarket",
    title: "StellarMarket — Decentralized Freelance Marketplace",
    description:
      "A decentralized freelance marketplace built on Stellar/Soroban with escrow payments, on-chain reputation, and dispute resolution.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "StellarMarket — Decentralized Freelance Marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StellarMarket — Decentralized Freelance Marketplace",
    description:
      "A decentralized freelance marketplace built on Stellar/Soroban with escrow payments, on-chain reputation, and dispute resolution.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16", type: "image/x-icon" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var savedTheme = localStorage.getItem('stellar-market-theme');
                  var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (!savedTheme && supportDarkMode) savedTheme = 'dark';
                  if (!savedTheme) savedTheme = 'light';
                  document.documentElement.setAttribute('data-theme', savedTheme);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={inter.className}>
        <Providers>
          <Navbar />
          <EmailVerificationBanner />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
