'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type Props = {
  role: 'ADMIN' | 'MANAGER' | 'REP';
};

export function SubscriptionGate({ role }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (role !== 'ADMIN') return;
    if (pathname.startsWith('/app/onboarding/plan')) return;

    let active = true;

    async function check() {
      const res = await fetch('/api/org/subscription', { cache: 'no-store' });
      if (!active) return;
      if (res.status === 404) {
        router.replace('/app/onboarding/plan');
      }
    }

    void check();

    return () => {
      active = false;
    };
  }, [pathname, role, router]);

  return null;
}
