import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "local-agent-chat by ALFREDO CARDONA (SilverBomb-Gaming)",
  description: "Local-first chat with Ollama and a small set of safe workspace tools.",
};

export const viewport: Viewport = {
  themeColor: "#12140f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <noscript>This demo needs JavaScript to stream chat from the local server.</noscript>
      </body>
    </html>
  );
}
