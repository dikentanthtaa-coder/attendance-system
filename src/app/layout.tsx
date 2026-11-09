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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${face.variable} h-full antialiased`}>
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
