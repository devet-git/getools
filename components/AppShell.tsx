'use client';

import { AppProvider, useApp } from '@/components/AppContext';
import { Sidebar } from '@/components/Sidebar';
import { SettingsModal } from '@/components/SettingsModal';
import { HistoryBookmarksModal } from '@/components/HistoryBookmarksModal';
import { CommandPalette } from '@/components/CommandPalette';
import { ToolTracker } from '@/components/ToolTracker';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
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

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isSidebarCollapsed } = useApp();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      <Sidebar />
      <GlobalToast />
      <CommandPalette />
      <ToolTracker />
      <ServiceWorkerRegister />
      <SettingsModal />
      <HistoryBookmarksModal />

      {/* Main Content Area */}
      <main 
        className={`flex-1 flex flex-col min-h-screen transition-[padding] duration-200 ease-in-out ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        <div className="flex-1 p-2 sm:p-3.5 lg:p-4 max-w-[1700px] w-full mx-auto">
          {children}
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
