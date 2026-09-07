import type { Metadata } from "next";
import { Michroma, Oxanium, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Michroma({ subsets: ["latin"], weight: "400", variable: "--f-display" });
const ui = Oxanium({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--f-ui" });
const body = Sora({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--f-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "MODEL TALK",
  description: "Put two frontier models on a wire and sit in the middle of it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* replays the saved theme's CSS vars before first paint; see public/theme-boot.js */}
        <script src="/theme-boot.js" />
      </head>
      <body className="field">
        <div className="grain" />
        <div className="relative z-10 h-screen">{children}</div>
      </body>
    </html>
  );
}
