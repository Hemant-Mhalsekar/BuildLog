import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { parseFriendlyFirestoreError } from '../../lib/firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unhandled application error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const friendly = parseFriendlyFirestoreError(
        this.state.error,
        'An unexpected error occurred in the application.'
      );
      return (
        <div className="min-h-screen bg-[#090B09] text-[#F3F5EF] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-[#252D24] bg-[#121712] p-6">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-lg font-semibold text-[#F3F5EF]">Something went wrong</h1>
            </div>
            <p className="mt-3 text-sm text-[#929B90] leading-relaxed">{friendly}</p>
            <div className="mt-6 flex items-center gap-3">
              <Button
                variant="primary"
                icon={<RotateCcw className="w-4 h-4" />}
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                Reload BuildLog
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
