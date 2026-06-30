"use client";

import { Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/context/WalletContext";
import { SocketProvider } from "@/context/SocketContext";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider as NextThemeProvider } from "next-themes";
import { ThemeProvider } from "@/context/ThemeContext";
import { registerServiceWorker } from "@/utils/registerServiceWorker";
import NavigationProgress from "@/components/NavigationProgress";
import PushNotificationPrompt from "@/components/PushNotificationPrompt";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => {
    // Register service worker
    registerServiceWorker();

    // Track user interaction for push notification prompt
    const trackInteraction = () => {
      localStorage.setItem("stellarmarket-has-interacted", "true");
      window.removeEventListener("click", trackInteraction);
      window.removeEventListener("keydown", trackInteraction);
      window.removeEventListener("touchstart", trackInteraction);
    };

    window.addEventListener("click", trackInteraction);
    window.addEventListener("keydown", trackInteraction);
    window.addEventListener("touchstart", trackInteraction);

    return () => {
      window.removeEventListener("click", trackInteraction);
      window.removeEventListener("keydown", trackInteraction);
      window.removeEventListener("touchstart", trackInteraction);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <NextThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ThemeProvider>
          <ToastProvider>
            <WalletProvider>
              <AuthProvider>
                <SocketProvider>
                  <Suspense fallback={null}>
                    <NavigationProgress />
                  </Suspense>
                  {children}
                  <PushNotificationPrompt />
                </SocketProvider>
              </AuthProvider>
            </WalletProvider>
          </ToastProvider>
        </ThemeProvider>
      </NextThemeProvider>
    </QueryClientProvider>
  );
}
