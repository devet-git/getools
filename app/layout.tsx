import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'GeTools',
  description: 'Bộ công cụ GeTools: tải file/thư mục từ GitHub, GitLab, Bitbucket, clone hàng loạt, GitHub Releases, TTS, STT, chuyển HTML sang Markdown và so sánh file.',
  appleWebApp: { capable: true, title: 'GeTools', statusBarStyle: 'default' },
  openGraph: {
    title: 'GeTools',
    description: 'Bộ công cụ GeTools: tải file/thư mục từ GitHub, GitLab, Bitbucket, clone hàng loạt, GitHub Releases, TTS, STT, chuyển HTML sang Markdown và so sánh file.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4f46e5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

const THEME_INIT = `(function(){try{var m=localStorage.getItem('getools_theme');var d=m==='dark'||((m===null||m==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="vi" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
