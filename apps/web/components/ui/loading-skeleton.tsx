import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  count?: number;
  height?: string;
  className?: string;
}

export function LoadingSkeleton({ count = 4, height = 'h-16', className }: LoadingSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className={cn(
            'bg-slate-900 border border-slate-800 rounded-xl animate-pulse',
            height,
          )}
        />
      ))}
    </div>
  );
}
