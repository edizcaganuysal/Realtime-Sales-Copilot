import { cn } from '@/lib/utils';

const VARIANTS: Record<string, string> = {
  success: 'bg-sky-500/15 text-sky-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
  info: 'bg-blue-500/15 text-blue-400',
  neutral: 'bg-slate-700 text-slate-400',
};

interface StatusBadgeProps {
  variant?: keyof typeof VARIANTS;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ variant = 'neutral', children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'text-xs px-1.5 py-0.5 rounded font-medium',
        VARIANTS[variant] ?? VARIANTS.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}
