import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LoginTransitionProvider } from "@/components/auth/LoginTransitionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CSUCC MPC Admin Portal",
  description: "Admin Dashboard for CSUCC MPC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      {/* Browser extensions such as Monica add body attributes before hydration. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans">
        <LoginTransitionProvider>{children}</LoginTransitionProvider>
      </body>
    </html>
  );
}
