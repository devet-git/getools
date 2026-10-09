'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { AppProvider, useApp } from '@/components/AppContext';
import { Sidebar } from '@/components/Sidebar';
import { SettingsModal } from '@/components/SettingsModal';
import { HistoryBookmarksModal } from '@/components/HistoryBookmarksModal';
import { CommandPalette } from '@/components/CommandPalette';
import { ToolTracker } from '@/components/ToolTracker';
import { AiToolGate } from '@/components/AiToolGate';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SmartPasteModal } from '@/components/SmartPasteModal';
import { SnippetsDrawer } from '@/components/SnippetsDrawer';
import { HandoffReceiver } from '@/components/HandoffReceiver';
import { ShareBoot } from '@/components/ShareBoot';
import { RouteProgress } from '@/components/RouteProgress';
import { NavigationOverlay } from '@/components/AppLoader';
import { startDriveAutoSync } from '@/lib/drive-sync-client';
import { Check } from 'lucide-react';

function GlobalToast() {
  const { copiedNotice } = useApp();
  if (!copiedNotice) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-4 py-2 rounded-full shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 border border-slate-800">
      <Check className="h-4 w-4 text-emerald-400" />
      <span className="font-medium">{copiedNotice}</span>
    </div>
  );
}

/** Không có giao diện: tự đồng bộ Google Drive trong nền khi người dùng đã kết nối */
function DriveAutoSync() {
  useEffect(() => startDriveAutoSync(), []);
  return null;
}

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isSidebarCollapsed } = useApp();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);

  // Vùng cuộn chính là <main> (không phải cửa sổ): về đầu mỗi khi chuyển trang
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return (
    <div className="h-dvh overflow-hidden bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar />
      <RouteProgress />
      <NavigationOverlay sidebarCollapsed={isSidebarCollapsed} />
      <GlobalToast />
      <CommandPalette />
      <ToolTracker />
      <DriveAutoSync />
      <ServiceWorkerRegister />
      <SmartPasteModal />
      <SnippetsDrawer />
      <HandoffReceiver />
      <SettingsModal />
      <HistoryBookmarksModal />

      {/* Main Content Area */}
      <main
        ref={mainRef}
        className={`flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden transition-[padding] duration-200 ease-in-out ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        <div className="p-2 sm:p-3.5 lg:p-4 max-w-[1700px] w-full min-w-0 mx-auto">
          <ShareBoot>
            <AiToolGate>{children}</AiToolGate>
          </ShareBoot>
        </div>
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <LayoutContent>{children}</LayoutContent>
    </AppProvider>
  );
}
