// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

import Providers from './providers';
import SiteHeader from '@/components/SiteHeader';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'sillymarket',
  description: 'Prediction markets, simply.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <ToastProvider>
            <SiteHeader />
            <main className="min-h-[calc(100vh-56px)]">{children}</main>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
