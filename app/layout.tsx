import type {Metadata} from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Git Downloader & Batch Clone Suite',
  description: 'Download files/folders from GitHub, GitLab, or Bitbucket with custom ZIP options, batch-clone group repositories, manage bookmarks & history, and download GitHub Releases.',
  openGraph: {
    title: 'Git Downloader & Batch Clone Suite',
    description: 'Download files/folders from GitHub, GitLab, or Bitbucket with custom ZIP options, batch-clone group repositories, manage bookmarks & history, and download GitHub Releases.',
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
