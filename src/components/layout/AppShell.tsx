import { Menu, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { DatasetSwitcher } from './DatasetSwitcher';
import { JobActivity } from './JobActivity';
import { PrivacyIndicator } from './PrivacyIndicator';
import { Sidebar } from './Sidebar';

/**
 * Application frame.
 *
 * A fixed sidebar with a scrolling content pane, which is what a dense
 * analytical tool wants: navigation stays put while a table of a hundred
 * thousand rows scrolls, and the dataset switcher in the header is always
 * reachable because every analysis page operates on the selected dataset.
 *
 * Below the large breakpoint the sidebar collapses into a dialog rather than a
 * squeezed rail, because the navigation labels matter more than the icons.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar className="hidden w-56 shrink-0 lg:flex" />

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="max-w-60 p-0" hideClose>
          <div className="flex items-center justify-end border-b border-border px-2 py-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
            >
              <X />
            </Button>
          </div>
          {/*
            The dialog closes on navigation rather than on a route-change
            effect: the link click is the event that should dismiss it, and
            handling it there avoids an extra render pass on every navigation.
          */}
          <Sidebar className="border-r-0" onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>

          <DatasetSwitcher />

          <div className="ml-auto flex items-center gap-2">
            <PrivacyIndicator className="hidden sm:inline-flex" />
            <JobActivity />
            <Button size="sm" asChild>
              <Link to="/import">
                <Upload />
                <span className="hidden sm:inline">Import FASTA / FASTQ</span>
                <span className="sm:hidden">Import</span>
              </Link>
            </Button>
          </div>
        </header>

        <main
          id="main-content"
          className="min-w-0 flex-1 overflow-y-auto"
          // Key on the path so the scroll position resets between pages rather
          // than carrying over from a long table to a short one.
          key={location.pathname}
        >
          <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
