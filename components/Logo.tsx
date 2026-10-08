import { cn } from '@/lib/utils';

/** Logo GeTools: chữ "G" bo tròn kết hợp một điểm "commit" màu hổ phách. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="GeTools"
      className={cn('shrink-0 drop-shadow-sm', className)}
    >
      <defs>
        <linearGradient id="getools-logo-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#getools-logo-bg)" />
      <path
        d="M45.86 24A16 16 0 1 0 48 32H35"
        fill="none"
        stroke="#fff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="45.86" cy="24" r="4.5" fill="#fbbf24" stroke="#4f46e5" strokeWidth="2" />
    </svg>
  );
}
