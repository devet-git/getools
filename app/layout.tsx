import type {Metadata} from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'GeTools',
  description: 'Bộ công cụ GeTools: tải file/thư mục từ GitHub, GitLab, Bitbucket, clone hàng loạt, GitHub Releases, TTS, STT, chuyển HTML sang Markdown và so sánh file.',
  openGraph: {
    title: 'GeTools',
    description: 'Bộ công cụ GeTools: tải file/thư mục từ GitHub, GitLab, Bitbucket, clone hàng loạt, GitHub Releases, TTS, STT, chuyển HTML sang Markdown và so sánh file.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
