import { cn } from '@/lib/utils';

interface DataTableProps {
  headers: { label: string; className?: string }[];
  children: React.ReactNode;
  className?: string;
}

export function DataTable({ headers, children, className }: DataTableProps) {
  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            {headers.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3',
                  h.className,
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}
