import type { Metadata } from 'next';
import './globals.css';

const metadataBase = process.env['APP_BASE_URL']
  ? new URL(process.env['APP_BASE_URL'])
  : undefined;

export const metadata: Metadata = {
  title: 'Sales AI',
  description: 'Real-time AI coaching for sales reps — clean, focused, and live on every call.',
  metadataBase,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">{children}</body>
    </html>
  );
}
