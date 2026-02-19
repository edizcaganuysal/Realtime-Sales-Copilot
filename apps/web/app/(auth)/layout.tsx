import { Suspense } from 'react';
import { SiteShell } from '@/components/marketing/site-shell';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell>
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
        <Suspense>{children}</Suspense>
      </div>
    </SiteShell>
  );
}
