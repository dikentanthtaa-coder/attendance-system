import type { Metadata, Viewport } from "next";
import { Mukta_Vaani } from "next/font/google";
import { ToastProvider } from "@/components/ui";
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2f4f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${face.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
