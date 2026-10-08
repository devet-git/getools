import type { ComponentType, ReactNode } from 'react';

/** Thanh tiêu đề chuẩn của một tool (nền tối, icon, mô tả, vùng hành động bên phải). */
export function ToolHeader({ icon: Icon, title, desc, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tight">{title}</h1>
          <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
