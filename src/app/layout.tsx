import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloud Functions on EdgeOne Pages - Koa",
  description: "Cloud Functions allow you to run code in a Node Runtime without managing servers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/eo-logo-blue.svg" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
