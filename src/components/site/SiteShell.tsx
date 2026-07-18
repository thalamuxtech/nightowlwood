"use client";

import { useEffect, type ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { WhatsAppFloat } from "./WhatsAppFloat";
import { SplashScreen } from "./SplashScreen";
import { initAnalytics } from "@/lib/firebase";

/** Wraps every public page with chrome + analytics. */
export function SiteShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <SplashScreen />
      <Header />
      <main>{children}</main>
      <Footer />
      <WhatsAppFloat />
    </>
  );
}
