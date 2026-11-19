import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RepositoryDetailPage } from './pages/RepositoryDetailPage';
import { ProjectMemoryPage } from './pages/ProjectMemoryPage';
import { TimelinePage } from './pages/TimelinePage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <BrowserRouter>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/signup" element={<AuthPage mode="signup" />} />
                <Route path="/reset-password" element={<AuthPage mode="reset" />} />

                {/* Protected Application Routes */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/projects"
                  element={
                    <ProtectedRoute>
                      <ProjectsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/projects/:repositoryId"
                  element={
                    <ProtectedRoute>
                      <RepositoryDetailPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/projects/:repositoryId/memory"
                  element={
                    <ProtectedRoute>
                      <ProjectMemoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/memory"
                  element={
                    <ProtectedRoute>
                      <ProjectMemoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/timeline"
                  element={
                    <ProtectedRoute>
                      <TimelinePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/integrations"
                  element={
                    <ProtectedRoute>
                      <IntegrationsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
