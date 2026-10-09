'use client';

import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clock,
  Star,
  Settings,
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
import { TOOL_CATEGORIES, findCategoryByPath, getCategory, type ToolDef } from '@/lib/tools';
import { subscribeToolPrefs, getGeneralModeSnapshot, getServerGeneralModeSnapshot } from '@/lib/recent-tools';

/** Lựa chọn mở/đóng mục do người dùng tự đặt: { [id nhóm]: true = mở, false = đóng }. Mặc định mọi mục đóng, trừ mục chứa trang đang xem. */
const CATEGORY_STATE_KEY = 'getools_sidebar_category_state';

function readCategoryState(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATEGORY_STATE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Chỉ giữ id nhóm còn tồn tại (bỏ khóa cũ theo tiêu đề nhóm / nhóm đã gộp)
    return Object.fromEntries(
      Object.entries(parsed).filter(([k, v]) => typeof v === 'boolean' && getCategory(k)),
    ) as Record<string, boolean>;
  } catch {
    return {}; // không đọc được localStorage
  }
}

/** Nút ở chân thanh bên (Bookmark / Lịch sử tải / Cài đặt) */
interface SidebarAction {
  label: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  onClick: () => void;
  /** Nhãn bên phải khi sidebar mở rộng */
  pill?: { text: string; className: string };
  /** Chấm/nhãn nhỏ ở góc khi sidebar thu gọn */
  dot?: { text?: string; className: string };
}

export function Sidebar() {
  const pathname = usePathname();
  const { isToolLocked, ready: aiReady } = useAiSettings();
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCatOverrides(readCategoryState());
  }, []);

  const closeMobile = () => setIsMobileOpen(false);

  // Chế độ Phổ thông: ẩn nhóm dành cho dev, nhưng vẫn giữ nhóm của trang đang xem
  const generalMode = useSyncExternalStore(subscribeToolPrefs, getGeneralModeSnapshot, getServerGeneralModeSnapshot) === '1';

  // Mục chứa trang đang xem luôn mở (trừ khi người dùng tự đóng) để thấy mình đang ở đâu
  const activeCategory = findCategoryByPath(pathname)?.id;
  const isCategoryExpanded = (id: string) => catOverrides[id] ?? id === activeCategory;
  const visibleCategories = TOOL_CATEGORIES.filter((cat) => !generalMode || cat.general || cat.id === activeCategory);

  const openPalette = () => {
    setIsMobileOpen(false);
    window.dispatchEvent(new CustomEvent('getools:open-palette'));
  };

  const toggleCategory = (id: string) => {
    const next = { ...catOverrides, [id]: !isCategoryExpanded(id) };
    setCatOverrides(next);
    try {
      localStorage.setItem(CATEGORY_STATE_KEY, JSON.stringify(next));
    } catch {
      /* bỏ qua */
    }
  };

  const hasConfiguredKeys = !!(keys.github || keys.gitlab || keys.bitbucket);

  const openHistory = (tab: 'bookmarks' | 'history') => {
    setHistoryModalTab(tab);
    setIsHistoryModalOpen(true);
    closeMobile();
  };
  const settingsConfigured = hasConfiguredKeys || aiReady;

  // Chân thanh bên: thao tác dùng chung cho cả ứng dụng, không thuộc riêng nhóm nào
  const footerActions: SidebarAction[] = [
    {
      label: 'Bookmark đã ghim',
      title: `Bookmark repo / link đã ghim (${bookmarksCount})`,
      icon: Star,
      iconClassName: 'text-amber-500 fill-amber-500/20',
      onClick: () => openHistory('bookmarks'),
      pill: { text: String(bookmarksCount), className: 'text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/50' },
      dot: bookmarksCount > 0 ? { text: String(bookmarksCount), className: 'bg-amber-500 text-white' } : undefined,
    },
    {
      label: 'Lịch sử tải',
      title: `Lịch sử tải file / repo (${historyCount})`,
      icon: Clock,
      iconClassName: 'text-slate-500',
      onClick: () => openHistory('history'),
      pill: { text: String(historyCount), className: 'text-[11px] font-semibold bg-slate-100 text-slate-600' },
      dot: historyCount > 0 ? { text: String(historyCount), className: 'bg-slate-700 text-white' } : undefined,
    },
    {
      label: 'Cài đặt',
      title: `Cài đặt: token Git, khóa AI, sao lưu & đồng bộ Google Drive${settingsConfigured ? ' • Đã thiết lập' : ''}`,
      icon: Settings,
      iconClassName: 'text-slate-500 group-hover:rotate-45 transition-transform duration-200',
      onClick: () => {
        openSettings();
        closeMobile();
      },
      pill: settingsConfigured
        ? { text: 'Đã thiết lập', className: 'text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50' }
        : undefined,
      dot: settingsConfigured ? { className: 'bg-emerald-500' } : undefined,
    },
  ];

  return (
    <>
      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-40 shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-border shadow-xs">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <div>
            <span className="font-semibold text-sm tracking-tight block">GeTools</span>
            <span className="text-[10px] text-muted-foreground block -mt-1">All tools for life</span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={openPalette}
            className="h-8 w-8 p-0"
            data-tooltip="Tìm công cụ"
            aria-label="Tìm công cụ"
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
            data-tooltip="Lịch sử & Bookmark"
          >
            <Clock className="h-4 w-4" />
            {bookmarksCount > 0 && (
              <span className="ml-1 text-[11px] font-semibold text-amber-600">★{bookmarksCount}</span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => openSettings()}
            className="h-8 w-8 p-0"
            data-tooltip="Cài đặt"
            aria-label="Cài đặt"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="h-8 w-8 p-0"
            aria-label={isMobileOpen ? 'Đóng menu' : 'Mở menu'}
          >
            {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 lg:hidden backdrop-blur-xs animate-in fade-in"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 bg-white border-r border-border flex flex-col transition-all duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 shadow-2xl w-72' : '-translate-x-full'
        } ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        {/* Logo + nút sáng/tối + thu gọn */}
        <div className={`relative p-4 border-b border-border flex items-center ${isSidebarCollapsed ? 'flex-col gap-2' : 'justify-between'}`}>
          <Link
            href="/"
            onClick={closeMobile}
            className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}
            data-tooltip-side={isSidebarCollapsed ? 'right' : undefined}
            data-tooltip="GeTools — Trang chủ"
          >
            <Logo className="h-10 w-10" />
            {!isSidebarCollapsed && (
              <span className="min-w-0">
                <span className="block font-bold text-base leading-tight tracking-tight text-slate-900 truncate">GeTools</span>
                <span className="block text-[11px] leading-tight text-muted-foreground truncate">All tools for life</span>
              </span>
            )}
          </Link>

          {isSidebarCollapsed ? (
            <>
              <ThemeToggle compact />
              {/* Nút mở rộng dính ở mép phải thanh bên, ngang tâm logo */}
              <button
                type="button"
                onClick={toggleSidebarCollapse}
                aria-label="Mở rộng thanh bên"
                data-tooltip-side="right"
                data-tooltip="Mở rộng thanh bên"
                className="hidden lg:flex absolute -right-3 top-9 -translate-y-1/2 h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-900 hover:bg-slate-50 transition-colors"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-0.5">
              <ThemeToggle compact />
              <button
                type="button"
                onClick={toggleSidebarCollapse}
                aria-label="Thu gọn thanh bên"
                data-tooltip="Thu gọn thanh bên"
                className="hidden lg:flex p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              {/* Nút đóng trên điện thoại */}
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Đóng thanh bên"
                className="lg:hidden p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        {/* Tìm nhanh công cụ (Ctrl+K) */}
        <div className={isSidebarCollapsed ? 'px-2.5 pt-3' : 'px-3.5 pt-3'}>
          <button
            type="button"
            onClick={openPalette}
            data-tooltip-side={isSidebarCollapsed ? 'right' : undefined}
            data-tooltip="Tìm công cụ (Ctrl+K)"
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
              data-tooltip-side={isSidebarCollapsed ? 'right' : undefined}
              data-tooltip={title}
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
            onClick={closeMobile}
            data-tooltip-side={isSidebarCollapsed ? 'right' : undefined}
            data-tooltip="Trang chủ - tổng quan các công cụ"
            className={`flex items-center rounded-lg text-[13px] font-semibold transition-all ${
              isSidebarCollapsed ? 'justify-center p-2.5 rounded-xl' : 'gap-3 px-3 py-2.5'
            } ${pathname === '/' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <House className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>Trang chủ</span>}
          </Link>

          {visibleCategories.map((cat) => {
            const expanded = isSidebarCollapsed || isCategoryExpanded(cat.id);
            return (
              <div key={cat.id}>
                {isSidebarCollapsed ? (
                  <div className="w-full h-px bg-slate-100 my-2" />
                ) : (
                  <div className="pb-1">
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      aria-expanded={expanded}
                      data-tooltip={expanded ? 'Thu gọn mục' : 'Mở rộng mục'}
                      className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold text-slate-400 hover:text-slate-700 hover:bg-slate-50 uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
                      />
                      <span className="truncate">{cat.title}</span>
                      {!expanded && (
                        <span className="ml-auto text-[10px] font-medium normal-case tracking-normal px-1.5 rounded-full bg-slate-100 text-slate-500">
                          {cat.items.length}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {expanded && (
                  <nav className="space-y-1">
                      {cat.items.map((item) => (
                        <SidebarToolLink
                          key={item.id}
                          tool={item}
                          active={pathname === item.href}
                          locked={isToolLocked(item)}
                          collapsed={isSidebarCollapsed}
                          onNavigate={closeMobile}
                        />
                      ))}
                  </nav>
                )}
              </div>
            );
          })}
        </div>

        {/* Chân thanh bên */}
        <div className="shrink-0 border-t border-border p-2.5 space-y-1">
          {footerActions.map((a) => (
            <SidebarActionButton key={a.label} action={a} collapsed={isSidebarCollapsed} />
          ))}
        </div>
      </aside>
    </>
  );
}

function SidebarToolLink({ tool, active, locked, collapsed, onNavigate }: {
  tool: ToolDef;
  active: boolean;
  locked: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const Icon = tool.icon;

  if (collapsed) {
    return (
      <Link
        href={tool.href}
        onClick={onNavigate}
        data-tooltip-side="right"
        data-tooltip={`${tool.name} - ${tool.description}${locked ? ' (cần khóa AI)' : ''}`}
        className={`flex items-center justify-center p-2.5 rounded-xl transition-all relative group ${locked ? 'opacity-50' : ''} ${
          active
            ? 'bg-slate-900 text-white shadow-xs'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <Icon className={`h-5 w-5 ${active ? 'text-white' : 'text-slate-600 group-hover:text-slate-900'}`} />
        {locked ? (
          <KeyRound className="absolute top-1 right-1 h-3 w-3 text-amber-600" />
        ) : (
          tool.badge && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white" />
          )
        )}
      </Link>
    );
  }

  return (
    <Link
      href={tool.href}
      onClick={onNavigate}
      data-tooltip={locked ? 'Cần khóa AI để sử dụng' : undefined}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all group ${locked ? 'opacity-55' : ''} ${
        active
          ? 'bg-slate-900 text-white shadow-xs'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? 'text-white' : 'text-slate-500 group-hover:text-slate-900'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[13px] flex items-center gap-1.5">
            {tool.name}
            {locked && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800">
                <KeyRound className="h-2.5 w-2.5" /> Cần khóa AI
              </span>
            )}
            {tool.aiEnhanced && (
              <span data-tooltip="Dùng được miễn phí; thêm khóa AI để mở thêm tính năng nâng cao" className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700">
                <Sparkles className="h-2.5 w-2.5" /> +AI
              </span>
            )}
            {!locked && tool.badge && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider ${
                active ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-700'
              }`}>
                {tool.badge}
              </span>
            )}
          </span>
          {active && <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
        </div>
        <p className={`text-[11px] truncate mt-0.5 ${active ? 'text-slate-300' : 'text-muted-foreground'}`}>
          {tool.description}
        </p>
      </div>
    </Link>
  );
}

/** Nút ở chân thanh bên: dạng icon khi thu gọn, dạng dòng có nhãn khi mở rộng */
function SidebarActionButton({ action, collapsed }: { action: SidebarAction; collapsed: boolean }) {
  const Icon = action.icon;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={action.onClick}
        data-tooltip-side="right"
        data-tooltip={action.title}
        className="group w-full flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors relative"
      >
        <Icon className={`h-5 w-5 ${action.iconClassName}`} />
        {action.dot && (
          action.dot.text ? (
            <span className={`absolute top-1 right-1 text-[9px] font-bold px-1 rounded-full ${action.dot.className}`}>
              {action.dot.text}
            </span>
          ) : (
            <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${action.dot.className}`} />
          )
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className="group w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <Icon className={`h-4 w-4 ${action.iconClassName}`} />
        <span>{action.label}</span>
      </div>
      {action.pill && (
        <span className={`px-2 py-0.5 rounded-full ${action.pill.className}`}>
          {action.pill.text}
        </span>
      )}
    </button>
  );
}
