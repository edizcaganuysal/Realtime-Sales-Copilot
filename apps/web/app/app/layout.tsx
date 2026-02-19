import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { getMe } from '@/lib/api';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let me;
  try {
    me = await getMe();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Service configuration is incomplete')) {
      redirect('/login?config=missing-api-base-url');
    }
    redirect('/login');
  }

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar me={me} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
