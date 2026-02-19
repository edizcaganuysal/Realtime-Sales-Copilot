import { cn } from '@/lib/utils';

interface SectionCardProps {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({
  title,
  icon,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        'bg-slate-900 border border-slate-800 rounded-xl overflow-hidden',
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-800">
          {icon && <span className="text-slate-400">{icon}</span>}
          <h2 className="text-sm font-semibold text-white">{title}</h2>
        </div>
      )}
      <div className={cn('p-5', contentClassName)}>{children}</div>
    </div>
  );
}
