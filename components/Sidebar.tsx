'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clock,
  Star,
  Settings,
  Key,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  House,
  Search,
  KeyRound,
  Sparkles,
  ClipboardPaste,
  Library,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/components/AppContext';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAiSettings } from '@/lib/use-ai-config';
import { TOOL_CATEGORIES, GIT_CATEGORY_TITLE } from '@/lib/tools';

/** Lựa chọn mở/đóng mục do người dùng tự đặt: { [tiêu đề mục]: true = mở, false = đóng }. Mặc định mọi mục đóng, trừ mục chứa trang đang xem. */
const CATEGORY_STATE_KEY = 'getools_sidebar_category_state';

export function Sidebar() {
  const pathname = usePathname();
  const { isToolLocked } = useAiSettings();
  const { 
    bookmarksCount, 
    historyCount, 
    setIsHistoryModalOpen, 
    setHistoryModalTab, 
    openSettings, 
    keys,
    isSidebarCollapsed,
    toggleSidebarCollapse
  } = useApp();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [catOverrides, setCatOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATEGORY_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const clean: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') clean[k] = v;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCatOverrides(clean);
      }
    } catch {
      /* bỏ qua: không đọc được localStorage */
    }
  }, []);

  // Mục chứa trang đang xem luôn mở (trừ khi người dùng tự đóng) để thấy mình đang ở đâu
  const activeCategory = TOOL_CATEGORIES.find((c) => c.items.some((i) => i.href === pathname))?.title;
  const isCategoryExpanded = (title: string) => catOverrides[title] ?? title === activeCategory;

  const openPalette = () => {
    setIsMobileOpen(false);
    window.dispatchEvent(new CustomEvent('getools:open-palette'));
  };

  const toggleCategory = (title: string) => {
    const next = { ...catOverrides, [title]: !isCategoryExpanded(title) };
    setCatOverrides(next);
    try {
      localStorage.setItem(CATEGORY_STATE_KEY, JSON.stringify(next));
    } catch {
      /* bỏ qua */
    }
  };

  const hasConfiguredKeys = !!(keys.github || keys.gitlab || keys.bitbucket);

  return (
    <>
      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-40 shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-border shadow-xs">
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
            onClick={openPalette}
            className="h-8 w-8 p-0"
            title="Tìm công cụ"
          >
            <Search className="h-4 w-4" />
          </Button>

          <ThemeToggle compact />

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
            onClick={() => openSettings('git')}
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
          <div className="flex items-center gap-0.5">
            {!isSidebarCollapsed && <ThemeToggle compact />}
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

        {/* Tìm nhanh công cụ (Ctrl+K) */}
        <div className={isSidebarCollapsed ? 'px-2.5 pt-3' : 'px-3.5 pt-3'}>
          <button
            type="button"
            onClick={openPalette}
            title="Tìm công cụ (Ctrl+K)"
            className={`w-full flex items-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 transition-colors ${
              isSidebarCollapsed ? 'justify-center p-2.5' : 'gap-2 px-3 py-2 text-xs'
            }`}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Tìm công cụ...</span>
                <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-400">Ctrl K</kbd>
              </>
            )}
          </button>
          {isSidebarCollapsed && (
            <div className="flex justify-center mt-2">
              <ThemeToggle compact />
            </div>
          )}
        </div>

        {/* Lối tắt: Dán thông minh + Snippet */}
        <div className={isSidebarCollapsed ? 'px-2.5 pt-2 flex flex-col gap-1' : 'px-3.5 pt-2 grid grid-cols-2 gap-2'}>
          {[
            { label: 'Dán thông minh', title: 'Dán bất kỳ nội dung nào, tự nhận diện và mở đúng công cụ', event: 'getools:open-smart-paste', Icon: ClipboardPaste },
            { label: 'Snippet', title: 'Snippet đã lưu và lịch sử gần đây', event: 'getools:open-snippets', Icon: Library },
          ].map(({ label, title, event, Icon }) => (
            <button
              key={event}
              type="button"
              title={title}
              onClick={() => {
                setIsMobileOpen(false);
                window.dispatchEvent(new CustomEvent(event));
              }}
              className={`flex items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-medium transition-colors ${
                isSidebarCollapsed ? 'justify-center p-2.5' : 'gap-1.5 px-2.5 py-1.5'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {!isSidebarCollapsed && <span className="truncate">{label}</span>}
            </button>
          ))}
        </div>

        {/* Navigation Routes */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
          {/* Trang chủ */}
          <Link
            href="/"
            onClick={() => setIsMobileOpen(false)}
            title="Trang chủ - tổng quan các công cụ"
            className={`flex items-center rounded-lg text-[13px] font-semibold transition-all ${
              isSidebarCollapsed ? 'justify-center p-2.5 rounded-xl' : 'gap-3 px-3 py-2.5'
            } ${pathname === '/' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <House className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>Trang chủ</span>}
          </Link>

          {TOOL_CATEGORIES.map((cat, idx) => {
            const isGitCat = cat.title === GIT_CATEGORY_TITLE;
            const isCatCollapsed = !isSidebarCollapsed && !isCategoryExpanded(cat.title);
            return (
            <div key={idx}>
              {!isSidebarCollapsed ? (
                <div className="flex items-center justify-between pb-1">
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.title)}
                    aria-expanded={!isCatCollapsed}
                    title={isCatCollapsed ? 'Mở rộng mục' : 'Thu gọn mục'}
                    className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-slate-400 hover:text-slate-700 hover:bg-slate-50 uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isCatCollapsed ? '-rotate-90' : ''}`}
                    />
                    <span className="truncate">{cat.title}</span>
                    {isCatCollapsed && (
                      <span className="ml-auto text-[10px] font-medium normal-case tracking-normal px-1.5 rounded-full bg-slate-100 text-slate-500">
                        {cat.items.length}
                      </span>
                    )}
                  </button>
                  {isGitCat && (
                    <button
                      type="button"
                      onClick={() => openSettings('git')}
                      title={`Cài đặt API Tokens Git (GitHub / GitLab / Bitbucket)${hasConfiguredKeys ? ' • Đã thiết lập' : ''}`}
                      className="flex items-center justify-center p-1 mr-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors relative group cursor-pointer"
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
                  {isGitCat && (
                    <button
                      type="button"
                      onClick={() => openSettings('git')}
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
              {!isCatCollapsed && (
                <>
                  <nav className="space-y-1">
                    {cat.items.map((item) => {
                      const isActive = pathname === item.href;
                      const Icon = item.icon;
                      const locked = isToolLocked(item);

                      if (isSidebarCollapsed) {
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsMobileOpen(false)}
                            title={`${item.name} - ${item.description}${locked ? ' (cần khóa AI)' : ''}`}
                            className={`flex items-center justify-center p-2.5 rounded-xl transition-all relative group ${locked ? 'opacity-50' : ''} ${
                              isActive
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-slate-600 group-hover:text-slate-900'}`} />
                            {locked ? (
                              <KeyRound className="absolute top-1 right-1 h-3 w-3 text-amber-600" />
                            ) : (
                              item.badge && (
                                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white" />
                              )
                            )}
                          </Link>
                        );
                      }

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsMobileOpen(false)}
                          title={locked ? 'Cần khóa AI để sử dụng' : undefined}
                          className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all group ${locked ? 'opacity-55' : ''} ${
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
                                {locked && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800">
                                    <KeyRound className="h-2.5 w-2.5" /> Cần khóa AI
                                  </span>
                                )}
                                {item.aiEnhanced && (
                                  <span title="Dùng được miễn phí; thêm khóa AI để mở thêm tính năng nâng cao" className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700">
                                    <Sparkles className="h-2.5 w-2.5" /> +AI
                                  </span>
                                )}
                                {!locked && item.badge && (
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
                  {isGitCat && (
              <div className="space-y-1 mt-1">
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
                      onClick={() => openSettings('git')}
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
                        openSettings('git');
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
                  )}
                </>
              )}
            </div>
            );
          })}

        </div>

      </aside>
    </>
  );
}
