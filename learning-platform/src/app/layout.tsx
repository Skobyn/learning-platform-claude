import './globals.css';
import { Inter } from 'next/font/google';
import { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Enterprise Learning Platform',
    template: '%s | Enterprise Learning Platform',
  },
  description: 'A comprehensive employee learning management system that enables organizations to deliver training, track progress, and certify skills through an intuitive, AI-powered platform.',
  keywords: [
    'learning management system',
    'employee training',
    'corporate education',
    'skill certification',
    'online courses',
    'professional development'
  ],
  authors: [{ name: 'Enterprise Learning Platform Team' }],
  creator: 'Enterprise Learning Platform',
  publisher: 'Enterprise Learning Platform',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Enterprise Learning Platform',
    description: 'Transform your organization\'s learning experience with our comprehensive LMS platform.',
    url: '/',
    siteName: 'Enterprise Learning Platform',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Enterprise Learning Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Enterprise Learning Platform',
    description: 'Transform your organization\'s learning experience with our comprehensive LMS platform.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/safari-pinned-tab.svg',
        color: '#3b82f6',
      },
    ],
  },
  manifest: '/site.webmanifest',
  other: {
    'msapplication-TileColor': '#3b82f6',
    'theme-color': '#ffffff',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html 
      lang="en" 
      className={`${inter.variable} scroll-smooth`}
      suppressHydrationWarning
    >
      <head>
        {/* Preconnect to external domains */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        
        {/* DNS prefetch for performance */}
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        
        {/* Critical CSS variables */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body 
        className={`
          ${inter.className} 
          min-h-screen 
          bg-background 
          font-sans 
          antialiased
          overflow-x-hidden
        `}
        suppressHydrationWarning
      >
        <Providers>
          {/* Skip to main content for accessibility */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Skip to main content
          </a>

          {/* Main Application */}
          <div className="relative min-h-screen flex flex-col">
            {/* Global Loading Indicator */}
            <div 
              id="global-loading" 
              className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary-600 transform -translate-y-full transition-transform duration-300 z-50"
              style={{ display: 'none' }}
            />

            {/* Main Content */}
            <main 
              id="main-content" 
              className="flex-1 relative"
              role="main"
            >
              {children}
            </main>

            {/* Global Footer */}
            <footer className="border-t bg-muted/50">
              <div className="container mx-auto px-4 py-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                      <div className="w-3 h-3 bg-white rounded-sm" />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      © 2024 Enterprise Learning Platform. All rights reserved.
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm">
                    <a 
                      href="/privacy" 
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Privacy Policy
                    </a>
                    <a 
                      href="/terms" 
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Terms of Service
                    </a>
                    <a 
                      href="/support" 
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Support
                    </a>
                  </div>
                </div>
              </div>
            </footer>
          </div>

          {/* Global Toast Notifications */}
          <Toaster
            position="top-right"
            gutter={8}
            containerClassName="z-50"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
              },
              success: {
                iconTheme: {
                  primary: 'hsl(var(--success-600))',
                  secondary: 'hsl(var(--success-50))',
                },
              },
              error: {
                iconTheme: {
                  primary: 'hsl(var(--error-600))',
                  secondary: 'hsl(var(--error-50))',
                },
              },
            }}
          />

          {/* Development Tools */}
          {process.env.NODE_ENV === 'development' && (
            <div className="fixed bottom-4 right-4 z-50">
              <div className="bg-gray-900 text-white p-2 rounded-lg text-xs font-mono">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Development Mode
                </div>
              </div>
            </div>
          )}
        </Providers>

        {/* Performance optimization scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Performance observer for monitoring
              if ('PerformanceObserver' in window) {
                const observer = new PerformanceObserver((list) => {
                  const entries = list.getEntries();
                  entries.forEach((entry) => {
                    if (entry.entryType === 'navigation') {
                      // Track page load time
                      console.log('Page load time:', entry.loadEventEnd - entry.loadEventStart, 'ms');
                    }
                    if (entry.entryType === 'largest-contentful-paint') {
                      // Track LCP
                      console.log('LCP:', entry.startTime, 'ms');
                    }
                  });
                });
                
                observer.observe({ entryTypes: ['navigation', 'largest-contentful-paint'] });
              }

              // Global error handling
              window.addEventListener('error', (event) => {
                console.error('Global error:', event.error);
                // Send to error reporting service in production
              });

              window.addEventListener('unhandledrejection', (event) => {
                console.error('Unhandled promise rejection:', event.reason);
                // Send to error reporting service in production
              });

              // Loading indicator helper
              function showGlobalLoading() {
                const indicator = document.getElementById('global-loading');
                if (indicator) {
                  indicator.style.display = 'block';
                  indicator.style.transform = 'translateY(0)';
                }
              }

              function hideGlobalLoading() {
                const indicator = document.getElementById('global-loading');
                if (indicator) {
                  indicator.style.transform = 'translateY(-100%)';
                  setTimeout(() => {
                    indicator.style.display = 'none';
                  }, 300);
                }
              }

              // Make available globally
              window.showGlobalLoading = showGlobalLoading;
              window.hideGlobalLoading = hideGlobalLoading;
            `,
          }}
        />
      </body>
    </html>
  );
}