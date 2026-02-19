import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });
const metadataBase = process.env['APP_BASE_URL']
  ? new URL(process.env['APP_BASE_URL'])
  : undefined;

export const metadata: Metadata = {
  title: 'Live Sales Coach',
  description: 'Real-time AI coaching for sales reps — clean, focused, and live on every call.',
  metadataBase,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
