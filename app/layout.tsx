import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { BackgroundArcs } from "./components/BackgroundArcs";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["300", "400", "500", "700", "900"],
  style: ["normal", "italic"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Inevitable Frontier",
  description:
    "A research and policy organization working to shape the future of AI. We believe the frontier is not inevitable — it will become what we choose to build, permit, and protect.",
  openGraph: {
    title: "Inevitable Frontier",
    description:
      "The frontier is not inevitable. It will become what the American people choose to build, permit, and protect.",
    url: "https://inevitablefrontier.org",
    siteName: "Inevitable Frontier",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${fraunces.variable} ${spaceGrotesk.variable}`}>
        {/* Mounted here, not per page. Rendered inside a page it is unmounted
            and rebuilt on every client-side navigation -- the canvas is
            destroyed, a new one mounts blank, and the whole scene has to be
            measured and rebuilt before the first frame lands, which reads as
            the background flashing out. The layout persists across route
            changes, so it mounts once and keeps running. */}
        <BackgroundArcs />
        {children}
      </body>
    </html>
  );
}
