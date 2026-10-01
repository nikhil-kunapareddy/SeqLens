import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const OverviewPage = lazy(() => import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ImportPage = lazy(() => import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage })));
const QCPage = lazy(() => import('@/pages/QCPage').then((m) => ({ default: m.QCPage })));
const CompositionPage = lazy(() => import('@/pages/CompositionPage').then((m) => ({ default: m.CompositionPage })));
const SimilarityPage = lazy(() => import('@/pages/SimilarityPage').then((m) => ({ default: m.SimilarityPage })));
const OrfPage = lazy(() => import('@/pages/OrfPage').then((m) => ({ default: m.OrfPage })));
const AlignmentPage = lazy(() => import('@/pages/AlignmentPage').then((m) => ({ default: m.AlignmentPage })));
const EmbeddingsPage = lazy(() => import('@/pages/EmbeddingsPage').then((m) => ({ default: m.EmbeddingsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ExplorerPage = lazy(() => import('@/pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })));
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
        if (requestPersistence)
            void requestPersistentStorage();
    }, [requestPersistence]);
    return (_jsx(ErrorBoundary, { children: _jsx(TooltipProvider, { delayDuration: 300, skipDelayDuration: 100, children: _jsxs(HashRouter, { children: [_jsx("a", { href: "#main-content", className: "sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-xs focus:shadow-md", children: "Skip to main content" }), _jsx(Routes, { children: _jsxs(Route, { element: _jsx(AppShell, {}), children: [_jsx(Route, { index: true, element: _jsx(PageSuspense, { children: _jsx(OverviewPage, {}) }) }), _jsx(Route, { path: "projects", element: _jsx(PageSuspense, { children: _jsx(ProjectsPage, {}) }) }), _jsx(Route, { path: "import", element: _jsx(PageSuspense, { children: _jsx(ImportPage, {}) }) }), _jsx(Route, { path: "explorer", element: _jsx(PageSuspense, { children: _jsx(ExplorerPage, {}) }) }), _jsx(Route, { path: "qc", element: _jsx(PageSuspense, { children: _jsx(QCPage, {}) }) }), _jsx(Route, { path: "composition", element: _jsx(PageSuspense, { children: _jsx(CompositionPage, {}) }) }), _jsx(Route, { path: "similarity", element: _jsx(PageSuspense, { children: _jsx(SimilarityPage, {}) }) }), _jsx(Route, { path: "orf", element: _jsx(PageSuspense, { children: _jsx(OrfPage, {}) }) }), _jsx(Route, { path: "alignment", element: _jsx(PageSuspense, { children: _jsx(AlignmentPage, {}) }) }), _jsx(Route, { path: "embeddings", element: _jsx(PageSuspense, { children: _jsx(EmbeddingsPage, {}) }) }), _jsx(Route, { path: "reports", element: _jsx(PageSuspense, { children: _jsx(ReportsPage, {}) }) }), _jsx(Route, { path: "settings", element: _jsx(PageSuspense, { children: _jsx(SettingsPage, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) })] }) }) }));
}
/**
 * Loading placeholder for a split route.
 *
 * Mirrors the shape of a page - heading, stat row, panel - rather than a
 * spinner, so the layout does not jump when the real content arrives.
 */
function PageSuspense({ children }) {
    return (_jsx(Suspense, { fallback: _jsxs("div", { className: "space-y-4", children: [_jsx(Skeleton, { className: "h-6 w-56" }), _jsx("div", { className: "grid gap-2 sm:grid-cols-2 lg:grid-cols-4", children: [0, 1, 2, 3].map((index) => (_jsx(Skeleton, { className: "h-20" }, index))) }), _jsx(Skeleton, { className: "h-64" })] }), children: children }));
}
