import type { Metadata } from "next";
import localFont from "next/font/local";
import FactStateSync from "@/components/FactStateSync";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pin Point",
  description:
    "A GeoGuessr study tool — learn country-identifying meta on an interactive world map.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <FactStateSync />
        {children}
      </body>
    </html>
  );
}
