"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { logError } from "@/utils/errorLogger";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  logError(error, "global");

  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "16px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 80,
              height: 80,
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              marginBottom: 24,
            }}
          >
            <AlertTriangle size={36} color="#ef4444" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#666", maxWidth: 400, marginBottom: 32 }}>
            A critical error occurred. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "#5b8cff",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={16} />
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
