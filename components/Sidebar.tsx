'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  FolderDown, 
  Package, 
  Clock, 
  Star, 
  Settings, 
  Key, 
  Menu, 
  X,
  ChevronRight,
  Code2,
  Volume2,
  PanelLeftClose,
  PanelLeftOpen,
  FileSpreadsheet,
  Mic,
  GitCompare
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import { Logo } from '@/components/Logo';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  badge?: string;
}

interface NavCategory {
  title: string;
  items: NavItem[];
}

const navCategories: NavCategory[] = [
  {
    title: 'Công cụ Git & Mã nguồn',
    items: [
      {
        name: 'Tải File / Thư mục',
        href: '/',
        icon: FolderDown,
        description: 'Tải thư mục con, file lẻ hoặc file nén tùy chỉnh',
      },
      {
        name: 'GitHub Org & GitLab Group',
        href: '/group-repos',
        icon: Code2,
        description: 'Quét và clone hàng loạt kho mã nguồn',
      },
      {
        name: 'GitHub Releases',
        href: '/releases',
        icon: Package,
        description: 'Tìm kiếm & tải asset phiên bản đóng gói',
      },
    ],
  },
  {
    title: 'AI & Đa phương tiện',
    items: [
      {
        name: 'Chuyển văn bản thành giọng nói (TTS)',
        href: '/tts',
        icon: Volume2,
        description: 'Đọc văn bản 5 ngôn ngữ: Anh, Trung, Hàn, Nhật, Việt',
        badge: 'TTS',
      },
      {
        name: 'Chuyển giọng nói thành văn bản (STT)',
        href: '/stt',
        icon: Mic,
        description: 'Ghi âm Micro & nhận diện giọng nói sang văn bản',
        badge: 'Mới',
      },
      {
        name: 'HTML / Text sang Markdown',
        href: '/html-to-markdown',
        icon: FileSpreadsheet,
        description: 'Chuyển đổi HTML & bảng Excel/Sheets sang Markdown GFM',
        badge: 'Mới',
      },
    ],
  },
  {
    title: 'Tiện ích văn bản',
    items: [
      {
        name: 'So sánh File',
        href: '/compare',
        icon: GitCompare,
        description: 'So sánh hai file hoặc văn bản, làm nổi bật điểm khác nhau',
        badge: 'Mới',
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { 
    bookmarksCount, 
    historyCount, 
    setIsHistoryModalOpen, 
    setHistoryModalTab, 
    setIsSettingsOpen, 
    keys,
    isSidebarCollapsed,
    toggleSidebarCollapse
  } = useApp();

  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const hasConfiguredKeys = !!(keys.github || keys.gitlab || keys.bitbucket);

  return (
    <>
      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-border shadow-xs">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <div>
            <span className="font-semibold text-sm tracking-tight block">GeTools</span>
            <span className="text-[10px] text-muted-foreground block -mt-1">Bộ công cụ đa năng</span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setHistoryModalTab('bookmarks');
              setIsHistoryModalOpen(true);
            }}
            className="h-8 px-2 text-xs"
            title="Lịch sử & Bookmark"
          >
            <Clock className="h-4 w-4" />
            {bookmarksCount > 0 && (
              <span className="ml-1 text-[11px] font-semibold text-amber-600">★{bookmarksCount}</span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 w-8 p-0"
            title="Cài đặt API Token"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="h-8 w-8 p-0"
          >
            {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 bg-white border-r border-border flex flex-col transition-all duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 shadow-2xl w-72' : '-translate-x-full'
        } ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        {/* Brand / Logo Header */}
        <div className={`p-4 border-b border-border flex items-center ${isSidebarCollapsed ? 'justify-center flex-col gap-2' : 'justify-between'}`}>
          <Link 
            href="/" 
            onClick={() => setIsMobileOpen(false)} 
            className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}
            title="GeTools"
          >
            <Logo className="h-10 w-10" />
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <span className="font-bold text-base tracking-tight text-slate-900 block truncate">GeTools</span>
                <span className="text-xs text-muted-foreground block truncate">Bộ công cụ Git & văn bản</span>
              </div>
            )}
          </Link>

          {/* Desktop Toggle Button */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={toggleSidebarCollapse}
              className="hidden lg:flex p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title={isSidebarCollapsed ? "Mở rộng thanh bên (Expand)" : "Thu gọn thanh bên (Collapse)"}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation Routes */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
          {navCategories.map((cat, idx) => (
            <div key={idx}>
              {!isSidebarCollapsed ? (
                <div className="flex items-center justify-between px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <span>{cat.title}</span>
                  {cat.title === 'Công cụ Git & Mã nguồn' && (
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(true)}
                      title={`Cài đặt API Tokens Git (GitHub / GitLab / Bitbucket)${hasConfiguredKeys ? ' • Đã thiết lập' : ''}`}
                      className="flex items-center justify-center p-1 -mr-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors relative group cursor-pointer"
                      aria-label="Cài đặt Công cụ Git"
                    >
                      <Settings className="h-3.5 w-3.5 group-hover:rotate-45 transition-transform duration-200" />
                      {hasConfiguredKeys && (
                        <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-white" />
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="w-full h-px bg-slate-100 my-2" />
                  {cat.title === 'Công cụ Git & Mã nguồn' && (
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(true)}
                      title={`Cài đặt API Tokens Git${hasConfiguredKeys ? ' • Đã thiết lập' : ''}`}
                      className="w-full flex items-center justify-center p-2 mb-1 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors relative group cursor-pointer"
                      aria-label="Cài đặt Công cụ Git"
                    >
                      <Settings className="h-4 w-4 group-hover:rotate-45 transition-transform duration-200" />
                      {hasConfiguredKeys && (
                        <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-white" />
                      )}
                    </button>
                  )}
                </div>
              )}
              <nav className="space-y-1">
                {cat.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;

                  if (isSidebarCollapsed) {
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMobileOpen(false)}
                        title={`${item.name} - ${item.description}`}
                        className={`flex items-center justify-center p-2.5 rounded-xl transition-all relative group ${
                          isActive
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-slate-600 group-hover:text-slate-900'}`} />
                        {item.badge && (
                          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white" />
                        )}
                      </Link>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileOpen(false)}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all group ${
                        isActive
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-900'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[13px] flex items-center gap-1.5">
                            {item.name}
                            {item.badge && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider ${
                                isActive ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-700'
                              }`}>
                                {item.badge}
                              </span>
                            )}
                          </span>
                          {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
                        </div>
                        <p className={`text-[11px] truncate mt-0.5 ${isActive ? 'text-slate-300' : 'text-muted-foreground'}`}>
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}

          {/* Quick Shortcuts */}
          <div>
            {!isSidebarCollapsed ? (
              <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Dữ liệu & Quản lý
              </div>
            ) : (
              <div className="w-full h-px bg-slate-100 my-2" />
            )}
            
            <div className="space-y-1">
              {isSidebarCollapsed ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalTab('bookmarks');
                      setIsHistoryModalOpen(true);
                    }}
                    title={`Bookmarks đã ghim (${bookmarksCount})`}
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
                  >
                    <Star className="h-5 w-5 text-amber-500 fill-amber-500/20" />
                    {bookmarksCount > 0 && (
                      <span className="absolute top-1 right-1 text-[9px] font-bold px-1 rounded-full bg-amber-500 text-white">
                        {bookmarksCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalTab('history');
                      setIsHistoryModalOpen(true);
                    }}
                    title={`Lịch sử tải (${historyCount})`}
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
                  >
                    <Clock className="h-5 w-5 text-slate-500" />
                    {historyCount > 0 && (
                      <span className="absolute top-1 right-1 text-[9px] font-bold px-1 rounded-full bg-slate-700 text-white">
                        {historyCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    title={`API Tokens (${hasConfiguredKeys ? 'Đã cài' : 'Chưa cài'})`}
                    className="w-full flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
                  >
                    <Key className="h-5 w-5 text-slate-500" />
                    {hasConfiguredKeys && (
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalTab('bookmarks');
                      setIsHistoryModalOpen(true);
                      setIsMobileOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Star className="h-4 w-4 text-amber-500 fill-amber-500/20" />
                      <span>Bookmarks đã ghim</span>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50">
                      {bookmarksCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalTab('history');
                      setIsHistoryModalOpen(true);
                      setIsMobileOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Clock className="h-4 w-4 text-slate-500" />
                      <span>Lịch sử tải</span>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {historyCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(true);
                      setIsMobileOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Key className="h-4 w-4 text-slate-500" />
                      <span>API Tokens</span>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${hasConfiguredKeys ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-slate-100 text-slate-500'}`}>
                      {hasConfiguredKeys ? 'Đã cài' : 'Chưa có'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

      </aside>
    </>
  );
}
