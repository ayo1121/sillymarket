import React from "react";
import { Button } from "@/components/ui/button";

type S = { error: any; errorInfo: any };

/**
 * Enhanced Error Boundary with friendly fallback UI
 * 
 * Features:
 * - Win95-styled error screen
 * - "Try Again" button (navigates to home)
 * - "Reload Page" button
 * - Debug info only in development
 * - Responsive design
 */
export default class ErrorBoundary extends React.Component<React.PropsWithChildren, S> {
  state: S = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
    window.location.href = "/"; // Navigate to home
  };

  render() {
    if (this.state.error) {
      const isDev = process.env.NODE_ENV === "development";

      return (
        <div className="min-h-screen bg-[#c0c0c0] dark:bg-[#1d1d1d] flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0px_0px_#000] p-6 sm:p-8">
            {/* Error Icon */}
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">:(</div>
              <h1 className="text-2xl font-black mb-2">Something went wrong</h1>
              <p className="text-muted-foreground">
                The application encountered an unexpected error.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
              <Button
                onClick={this.handleReset}
                className="win95-btn-press bg-[#e8e8e8] dark:bg-[#2b2b2b] font-bold"
              >
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
                className="border-[#8b8b8b] dark:border-[#3a3a3a] font-semibold"
              >
                Reload Page
              </Button>
            </div>

            {/* Debug Info (Development Only) */}
            {isDev && (
              <details className="mt-6 border-t border-[#e0e0e0] dark:border-[#333] pt-4">
                <summary className="cursor-pointer font-semibold text-sm mb-2">
                  Debug Information (Development Only)
                </summary>
                <div className="bg-[#f5f5f5] dark:bg-[#181818] border border-[#d3d3d3] dark:border-[#333] rounded p-4 overflow-auto">
                  <div className="text-xs font-mono">
                    <div className="text-red-600 dark:text-red-400 font-bold mb-2">
                      {String(this.state.error?.message || this.state.error)}
                    </div>
                    {this.state.error?.stack && (
                      <pre className="text-[10px] whitespace-pre-wrap opacity-70">
                        {this.state.error.stack}
                      </pre>
                    )}
                  </div>
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children as any;
  }
}
