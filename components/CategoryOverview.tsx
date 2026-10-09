'use client';

import { notFound } from 'next/navigation';
import { ToolGrid } from '@/components/ToolGrid';
import { ToolHeader } from '@/components/ToolHeader';
import { getCategory, type CategoryId } from '@/lib/tools';

/** Trang tổng quan của một nhóm (`/<nhóm>`): tiêu đề nhóm + lưới các tool trong nhóm. */
export function CategoryOverview({ id }: { id: CategoryId }) {
  const category = getCategory(id);
  if (!category) notFound();
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <ToolHeader icon={category.icon} title={category.title} desc={category.description}>
        <span className="text-xs text-slate-400">{category.items.length} công cụ</span>
      </ToolHeader>
      <ToolGrid tools={category.items} />
    </div>
  );
}
