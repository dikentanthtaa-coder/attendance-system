import type { Metadata, Viewport } from "next";
import { Mukta_Vaani } from "next/font/google";
import { OfflineNotice, ServiceWorker, ToastProvider } from "@/components/ui";
import "./globals.css";

// Carries Latin and Gujarati script, so a name in either reads properly, and has true tabular
// figures so mobile numbers and counts line up. Hind Vadodara was tried first and has none.
const face = Mukta_Vaani({
  variable: "--font-face",
  subsets: ["latin", "gujarati"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Gyansatr Attendance",
  description: "Attendance management for the three-day Gyansatr event",
  robots: { index: false, follow: false },
  applicationName: "Gyansatr Attendance",
  appleWebApp: { capable: true, title: "Gyansatr", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2f4f",
  // Lets the app reach behind a phone's notch. The header and bottom bar pad themselves to suit.
  viewportFit: "cover",
};

const CATCH_INSTALL_OFFER =
  'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__installEvent=e});' +
  'addEventListener("appinstalled",function(){window.__installEvent=null})';

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${face.variable} h-full antialiased`}>
      <head>
        {/* Chrome offers installing once per page load, sometimes before the app's code has arrived.
            This plain script runs as soon as it's read, so the Install app button never misses the offer.
            next/script's beforeInteractive was tried: it only queues the code until Next's own runtime starts. */}
        <script dangerouslySetInnerHTML={{ __html: CATCH_INSTALL_OFFER }} />
      </head>
      {/* Browser extensions add their own attributes to <body> before the app starts. This ignores
          differences on this one element only, so real mismatches further down are still reported. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
        <OfflineNotice />
        <ServiceWorker />
      </body>
    </html>
  );
}
