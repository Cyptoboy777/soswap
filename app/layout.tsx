import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SoSwap — Cross-chain swaps',
  description: 'Cross-chain asset transfers through SoDEX Mirror and live SoDEX spot markets.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try { document.documentElement.dataset.theme = localStorage.getItem('soswap-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }` }} /></head><body>{children}</body></html>;
}
