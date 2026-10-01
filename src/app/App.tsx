import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { HashRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Skeleton } from '@/components/ui/display';
import { TooltipProvider } from '@/components/ui/primitives';
import { requestPersistentStorage } from '@/storage/db';
import { useProjectStore } from '@/state/projectStore';
import { useSettingsStore } from '@/state/settingsStore';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Route-level code splitting.
 *
 * Every page is split, including the overview. That matters because the
 * overview renders a length histogram, so importing it eagerly would pull the
 * whole charting library into the initial bundle - and a first-time visitor who
 * reads the landing page and imports a file has no chart to draw yet.
 */
const OverviewPage = lazy(() =>
  import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const ProjectsPage = lazy(() =>
  import('@/pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const ImportPage = lazy(() => import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage })));
const QCPage = lazy(() => import('@/pages/QCPage').then((m) => ({ default: m.QCPage })));
const CompositionPage = lazy(() =>
  import('@/pages/CompositionPage').then((m) => ({ default: m.CompositionPage })),
);
const SimilarityPage = lazy(() =>
  import('@/pages/SimilarityPage').then((m) => ({ default: m.SimilarityPage })),
);
const OrfPage = lazy(() => import('@/pages/OrfPage').then((m) => ({ default: m.OrfPage })));
const AlignmentPage = lazy(() =>
  import('@/pages/AlignmentPage').then((m) => ({ default: m.AlignmentPage })),
);
const EmbeddingsPage = lazy(() =>
  import('@/pages/EmbeddingsPage').then((m) => ({ default: m.EmbeddingsPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const ExplorerPage = lazy(() =>
  import('@/pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })),
);

export function App() {
  const initialize = useProjectStore((state) => state.initialize);
  const loadSettings = useSettingsStore((state) => state.load);
  const requestPersistence = useSettingsStore((state) => state.requestPersistence);

  useEffect(() => {
    void loadSettings();
    void initialize();
  }, [initialize, loadSettings]);

  // Asking for persistent storage matters because a browser under storage
  // pressure may otherwise evict IndexedDB and a saved project disappears. A
  // refusal is not an error; it is surfaced in Settings.
  useEffect(() => {
    if (requestPersistence) void requestPersistentStorage();
  }, [requestPersistence]);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300} skipDelayDuration={100}>
        {/*
          HashRouter rather than BrowserRouter: SeqLens is a static bundle with
          no server to rewrite deep links, so a hash route works when the file
          is opened from disk or served from a subdirectory without any
          host-side configuration.
        */}
        <HashRouter>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-xs focus:shadow-md"
          >
            Skip to main content
          </a>
          <Routes>
            <Route element={<AppShell />}>
              <Route
                index
                element={
                  <PageSuspense>
                    <OverviewPage />
                  </PageSuspense>
                }
              />
              <Route
                path="projects"
                element={
                  <PageSuspense>
                    <ProjectsPage />
                  </PageSuspense>
                }
              />
              <Route
                path="import"
                element={
                  <PageSuspense>
                    <ImportPage />
                  </PageSuspense>
                }
              />
              <Route
                path="explorer"
                element={
                  <PageSuspense>
                    <ExplorerPage />
                  </PageSuspense>
                }
              />
              <Route
                path="qc"
                element={
                  <PageSuspense>
                    <QCPage />
                  </PageSuspense>
                }
              />
              <Route
                path="composition"
                element={
                  <PageSuspense>
                    <CompositionPage />
                  </PageSuspense>
                }
              />
              <Route
                path="similarity"
                element={
                  <PageSuspense>
                    <SimilarityPage />
                  </PageSuspense>
                }
              />
              <Route
                path="orf"
                element={
                  <PageSuspense>
                    <OrfPage />
                  </PageSuspense>
                }
              />
              <Route
                path="alignment"
                element={
                  <PageSuspense>
                    <AlignmentPage />
                  </PageSuspense>
                }
              />
              <Route
                path="embeddings"
                element={
                  <PageSuspense>
                    <EmbeddingsPage />
                  </PageSuspense>
                }
              />
              <Route
                path="reports"
                element={
                  <PageSuspense>
                    <ReportsPage />
                  </PageSuspense>
                }
              />
              <Route
                path="settings"
                element={
                  <PageSuspense>
                    <SettingsPage />
                  </PageSuspense>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

/**
 * Loading placeholder for a split route.
 *
 * Mirrors the shape of a page - heading, stat row, panel - rather than a
 * spinner, so the layout does not jump when the real content arrives.
 */
function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-6 w-56" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
