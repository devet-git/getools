'use client';

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/* ----------------------------------------------------------------------------
 * Ô chọn có tìm kiếm: SearchableSelect (chọn 1), Select (thay thế trực tiếp <select>),
 * MultiSelect (chọn nhiều). Không phụ thuộc thư viện ngoài.
 * - Tìm không phân biệt hoa/thường và dấu tiếng Việt (đ → d).
 * - Ô tìm kiếm tự hiện khi có từ `searchThreshold` tùy chọn trở lên (mặc định 6; 0 = luôn hiện).
 * - Bàn phím: ↑ ↓ Home End Enter Esc Tab, gõ chữ để lọc ngay khi mở.
 * -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  /** Tên nhóm (tương đương <optgroup>) */
  group?: string;
  /** Từ khóa phụ để tìm kiếm */
  keywords?: string;
  /** Mô tả ngắn hiển thị mờ bên phải */
  hint?: string;
  disabled?: boolean;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const DEFAULT_THRESHOLD = 6;

function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter((o) => {
    const hay = norm(`${o.label} ${o.value} ${o.group ?? ''} ${o.keywords ?? ''}`);
    return terms.every((t) => hay.includes(t));
  });
}

/* ------------------------------ Popover dùng chung ------------------------------ */

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  minWidth?: number;
  id?: string;
}

function Popover({ anchor, open, onClose, children, minWidth = 220, id }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null);

  const place = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, minWidth), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 220 && above > below;
    const maxH = Math.max(160, Math.min(360, up ? above : below));
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, width, maxH, up });
  }, [anchor, minWidth]);

  // Đo vị trí nút trong layout effect để popover xuất hiện đúng chỗ ngay khung hình đầu tiên
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, place, anchor, onClose]);

  if (!open || typeof document === 'undefined' || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      style={{
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
        maxHeight: pos.maxH,
        zIndex: 300,
      }}
      className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-800 shadow-xl"
      // giữ focus ở ô tìm kiếm khi bấm vào danh sách
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------ Danh sách tùy chọn ------------------------------ */

interface ListProps {
  options: SelectOption[];
  active: number;
  isSelected: (o: SelectOption) => boolean;
  onPick: (o: SelectOption) => void;
  onHover: (i: number) => void;
  multi?: boolean;
  emptyText: string;
  listId: string;
}

function OptionList({ options, active, isSelected, onPick, onHover, multi, emptyText, listId }: ListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, options]);

  if (!options.length) return <div className="px-3 py-6 text-center text-xs text-slate-500">{emptyText}</div>;

  return (
    <ul ref={listRef} id={listId} role="listbox" aria-multiselectable={multi || undefined} className="overflow-y-auto p-1 min-h-0">
      {options.map((o, i) => {
        const showGroup = !!o.group && o.group !== options[i - 1]?.group;
        const sel = isSelected(o);
        return (
          <Fragment key={o.value + ':' + i}>
            {showGroup && (
              <li role="presentation" className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {o.group}
              </li>
            )}
            <li
              role="option"
              aria-selected={sel}
              aria-disabled={o.disabled || undefined}
              data-active={i === active}
              onMouseMove={() => onHover(i)}
              onClick={() => !o.disabled && onPick(o)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                o.disabled ? 'cursor-not-allowed opacity-40' : i === active ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-slate-50'
              }`}
            >
              {multi ? (
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    sel ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {sel && <Check className="h-3 w-3" />}
                </span>
              ) : (
                <Check className={`h-3.5 w-3.5 shrink-0 ${sel ? 'text-indigo-600' : 'opacity-0'}`} />
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[10px] text-slate-400">{o.hint}</span>}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
  inputRef,
  listId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  listId: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 px-2.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-controls={listId}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="h-9 min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Xóa nội dung tìm" className="rounded p-0.5 text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const TRIGGER_BASE =
  'inline-flex max-w-full min-w-0 items-center justify-between gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const TRIGGER_DEFAULT = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50';

/* ------------------------------ Chọn một ------------------------------ */

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Hiện ô tìm kiếm khi số tùy chọn >= ngưỡng (mặc định 6; 0 = luôn hiện) */
  searchThreshold?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  title?: string;
  'aria-label'?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Chọn...',
  searchPlaceholder = 'Tìm kiếm...',
  emptyText = 'Không tìm thấy kết quả',
  searchThreshold = DEFAULT_THRESHOLD,
  disabled,
  className,
  id,
  title,
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showSearch = options.length >= searchThreshold;

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const selected = options.find((o) => o.value === value);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerEl?.focus();
  }, [triggerEl]);

  const openList = () => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === value);
    setQuery('');
    setActive(Math.max(0, idx));
    setOpen(true);
  };

  const pick = (o: SelectOption) => {
    onChange(o.value);
    close();
  };

  const move = (delta: number) => {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o && !o.disabled) pick(o);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        className={`${TRIGGER_BASE} ${className ?? TRIGGER_DEFAULT}`}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <Popover anchor={triggerEl} open={open} onClose={() => close(false)}>
        {showSearch && (
          <div onKeyDown={onKey}>
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v);
                setActive(0);
              }}
              placeholder={searchPlaceholder}
              inputRef={inputRef}
              listId={listId}
            />
          </div>
        )}
        <OptionList
          options={filtered}
          active={active}
          isSelected={(o) => o.value === value}
          onPick={pick}
          onHover={setActive}
          emptyText={emptyText}
          listId={listId}
        />
      </Popover>
    </>
  );
}

/* ------------------------------ Thay thế trực tiếp <select> ------------------------------ */

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Đọc <option>/<optgroup> (kể cả lồng trong Fragment, mảng, điều kiện) thành danh sách tùy chọn. */
export function optionsFromChildren(children: ReactNode, group?: string): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>;
    if (el.type === Fragment) {
      out.push(...optionsFromChildren(el.props.children, group));
    } else if (el.type === 'optgroup') {
      out.push(...optionsFromChildren(el.props.children, el.props.label ?? ''));
    } else if (el.type === 'option') {
      const label = textOf(el.props.children).trim();
      out.push({
        value: el.props.value !== undefined ? String(el.props.value) : label,
        label: label || String(el.props.value ?? ''),
        disabled: el.props.disabled,
        group,
      });
    }
  });
  return out;
}

export interface SelectProps {
  value: string | number;
  /** Giống <select>: nhận sự kiện có `e.target.value` (kiểu string) */
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  searchThreshold?: number;
  'aria-label'?: string;
}

/**
 * Thay thế trực tiếp `<select>`: giữ nguyên `<option>`/`<optgroup>` và `onChange={(e) => ... e.target.value}`,
 * nhưng có ô tìm kiếm khi danh sách dài. `className` áp dụng cho nút hiển thị (giống cách style <select> cũ).
 */
export function Select({ value, onChange, children, ...rest }: SelectProps) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  return (
    <SearchableSelect
      {...rest}
      value={String(value)}
      options={options}
      onChange={(v) => onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>)}
    />
  );
}

/* ------------------------------ Chọn nhiều ------------------------------ */

export interface MultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  searchThreshold?: number;
  /** Số mục tối đa hiển thị trên nút trước khi gộp thành "n đã chọn" */
  maxChips?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder = 'Chọn...',
  searchPlaceholder = 'Tìm kiếm...',
  emptyText = 'Không tìm thấy kết quả',
  searchThreshold = 0,
  maxChips = 2,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: MultiSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showSearch = options.length >= searchThreshold;
  const set = useMemo(() => new Set(values), [values]);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const selectedLabels = options.filter((o) => set.has(o.value)).map((o) => o.label);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerEl?.focus();
  }, [triggerEl]);

  const toggle = (o: SelectOption) => {
    onChange(set.has(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value]);
  };

  const enabledFiltered = filtered.filter((o) => !o.disabled);
  const allFilteredSelected = enabledFiltered.length > 0 && enabledFiltered.every((o) => set.has(o.value));
  const toggleAllFiltered = () => {
    if (allFilteredSelected) onChange(values.filter((v) => !enabledFiltered.some((o) => o.value === v)));
    else onChange([...new Set([...values, ...enabledFiltered.map((o) => o.value)])]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setQuery('');
        setActive(0);
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o && !o.disabled) toggle(o);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const summary =
    selectedLabels.length === 0
      ? null
      : selectedLabels.length <= maxChips
        ? selectedLabels.join(', ')
        : `${selectedLabels.length} mục đã chọn`;

  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else {
            setQuery('');
            setActive(0);
            setOpen(true);
          }
        }}
        onKeyDown={onKey}
        className={`${TRIGGER_BASE} ${className ?? TRIGGER_DEFAULT}`}
      >
        <span className={`min-w-0 truncate ${summary ? '' : 'text-slate-400'}`}>{summary ?? placeholder}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <Popover anchor={triggerEl} open={open} onClose={() => close(false)} minWidth={260}>
        <div onKeyDown={onKey}>
          {showSearch && (
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v);
                setActive(0);
              }}
              placeholder={searchPlaceholder}
              inputRef={inputRef}
              listId={listId}
            />
          )}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-[11px] text-slate-500">
            <span>{values.length} đã chọn</span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={toggleAllFiltered} disabled={!enabledFiltered.length} className="font-medium text-indigo-600 hover:underline disabled:opacity-40">
                {allFilteredSelected ? 'Bỏ chọn' : query ? 'Chọn kết quả' : 'Chọn tất cả'}
              </button>
              {values.length > 0 && (
                <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:underline">
                  Xóa hết
                </button>
              )}
            </span>
          </div>
        </div>
        <OptionList
          options={filtered}
          active={active}
          isSelected={(o) => set.has(o.value)}
          onPick={toggle}
          onHover={setActive}
          multi
          emptyText={emptyText}
          listId={listId}
        />
      </Popover>
    </>
  );
}
