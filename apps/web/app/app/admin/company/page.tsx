import { redirect } from 'next/navigation';

export default function LegacyCompanyPageRedirect() {
  redirect('/app/admin/context');
}
