import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useAuth();
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#090B09] text-[#F3F5EF] flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-[#929B90]">
          <Loader2 className="w-4 h-4 animate-spin text-[#B8F34A]" aria-hidden="true" />
          <span>Restoring session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
