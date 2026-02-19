import { redirect } from 'next/navigation';

export default function LegacyCompanySettingsRedirect() {
  redirect('/app/admin/context');
}
