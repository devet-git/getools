'use client';

import { useState, useMemo, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Clock, 
  Star, 
  Trash2, 
  FolderDown, 
  ExternalLink, 
  RotateCcw, 
  Copy, 
  Download,
  Search
} from 'lucide-react';
import {
  HistoryItem,
  removeHistoryItem,
  clearHistory,
  toggleBookmarkItem,
  formatTimeAgo,
  subscribeStorageSync,
} from '@/lib/storage';
import { useApp } from '@/components/AppContext';
import { useRouter } from 'next/navigation';
import { toolHref } from '@/lib/tools';

const emptyArrayString = () => '[]';

function getBookmarksSnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_bookmarks') || '[]';
  } catch {
    return '[]';
  }
}

function getHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  try {
    return localStorage.getItem('git_downloader_history') || '[]';
  } catch {
    return '[]';
  }
}

export function HistoryBookmarksModal() {
  const { 
    isHistoryModalOpen, 
    setIsHistoryModalOpen, 
    historyModalTab, 
    setHistoryModalTab, 
    showToast 
  } = useApp();
  
  const router = useRouter();

  const rawBookmarks = useSyncExternalStore(subscribeStorageSync, getBookmarksSnapshot, emptyArrayString);
  const bookmarks: HistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawBookmarks);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [rawBookmarks]);

  const rawHistory = useSyncExternalStore(subscribeStorageSync, getHistorySnapshot, emptyArrayString);
  const history: HistoryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(rawHistory);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [rawHistory]);

  const [searchFilter, setSearchFilter] = useState('');

  const handleOpenChange = (open: boolean) => {
    setIsHistoryModalOpen(open);
  };

  const handleToggleBookmark = (item: HistoryItem) => {
    const { isBookmarked } = toggleBookmarkItem(item);
    showToast(isBookmarked ? 'Đã ghim vào danh sách Bookmark!' : 'Đã bỏ ghim bookmark!');
  };

  const handleRemoveHistory = (id: string) => {
    removeHistoryItem(id);
    showToast('Đã xóa mục khỏi lịch sử!');
  };

  const handleClearHistory = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử tải? (Bookmarks vẫn được giữ nguyên)')) {
      clearHistory();
      showToast('Đã xóa toàn bộ lịch sử tải!');
    }
  };

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    showToast(msg);
  };

  const handleNavigateToUrl = (url: string) => {
    setIsHistoryModalOpen(false);
    router.push(toolHref('download', { url }));
    showToast('Đã chuyển liên kết vào trang Tải File/Folder');
  };

  const activeList = historyModalTab === 'bookmarks' ? bookmarks : history;
  const filteredList = activeList.filter(item => 
    item.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    item.url.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (item.repoName && item.repoName.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <Dialog open={isHistoryModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-5 w-5 text-primary" />
            Lịch sử tải & Quản lý Bookmark
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Truy cập nhanh các thư mục đã ghim yêu thích hoặc xem lại lịch sử các link đã tải trước đây.
          </DialogDescription>
        </DialogHeader>

        {/* Tab Switcher & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b pb-3 pt-2">
          <div className="flex rounded-lg border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setHistoryModalTab('bookmarks')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                historyModalTab === 'bookmarks' 
                  ? 'bg-amber-500 text-white shadow-xs' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Star className="h-3.5 w-3.5 fill-current" />
              Đã ghim ({bookmarks.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryModalTab('history')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                historyModalTab === 'history' 
                  ? 'bg-primary text-primary-foreground shadow-xs' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              Lịch sử gần đây ({history.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-48">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Tìm nhanh..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {historyModalTab === 'history' && history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearHistory}
                className="text-xs text-destructive hover:bg-destructive/10 h-8 px-2"
              >
                Xóa tất cả
              </Button>
            )}
          </div>
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-border pr-1">
          {filteredList.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
              <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                {historyModalTab === 'bookmarks' ? <Star className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
              </div>
              <p>
                {searchFilter 
                  ? 'Không tìm thấy kết quả phù hợp'
                  : historyModalTab === 'bookmarks' 
                    ? 'Chưa có mục nào được ghim bookmark. Hãy bấm biểu tượng ngôi sao để ghim thư mục yêu thích!'
                    : 'Chưa có lịch sử tải nào.'}
              </p>
            </div>
          ) : (
            filteredList.map((item) => (
              <div key={item.id} className="py-3 px-1 flex items-start justify-between gap-3 group hover:bg-muted/30 rounded-md transition-colors">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs text-foreground truncate max-w-[280px]" title={item.name}>
                      {item.name}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                      {item.provider}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      · {item.type === 'folder' ? 'Thư mục' : item.type === 'file' ? 'File lẻ' : item.type === 'release' ? 'Release' : 'Kho'}
                    </span>
                    {item.size && (
                      <span className="text-[11px] text-muted-foreground">
                        · {item.size}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground truncate font-mono" title={item.url}>
                    {item.url}
                  </p>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{formatTimeAgo(item.timestamp)}</span>
                    {item.branch && <span>· Nhánh {item.branch}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-500"
                    onClick={() => handleToggleBookmark(item)}
                    title={item.isBookmarked ? 'Bỏ ghim' : 'Ghim bookmark'}
                  >
                    <Star className={`h-3.5 w-3.5 ${item.isBookmarked ? 'text-amber-500 fill-amber-500' : ''}`} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => copyToClipboard(item.url, 'Đã sao chép link!')}
                    title="Sao chép URL"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                    onClick={() => handleNavigateToUrl(item.url)}
                    title="Nạp URL vào ô Tải"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  {historyModalTab === 'history' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveHistory(item.id)}
                      title="Xóa khỏi lịch sử"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
