import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Airlift Atlas", description: "Interactive Indo-Pacific air mobility planning globe" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
