import {
  AlignLeft,
  BarChart3,
  Dna,
  FileText,
  FlaskConical,
  FolderOpen,
  LayoutDashboard,
  Network,
  ScatterChart,
  Settings,
  Upload,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { APP_VERSION } from '@/types';
import { cn } from '@/utils/cn';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Short description used as the link's title attribute. */
  hint: string;
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, hint: 'Project dashboard and headline metrics' },
  { to: '/projects', label: 'Projects', icon: FolderOpen, hint: 'Create, switch, and delete local projects' },
  { to: '/import', label: 'Import', icon: Upload, hint: 'Import FASTA and FASTQ files' },
];

const ANALYSIS: NavItem[] = [
  { to: '/qc', label: 'QC', icon: BarChart3, hint: 'Quality control and dataset statistics' },
  { to: '/composition', label: 'Composition', icon: FlaskConical, hint: 'Residue composition and k-mer spectra' },
  { to: '/similarity', label: 'Similarity', icon: Network, hint: 'Redundancy, similarity matrix, and clustering' },
  { to: '/orf', label: 'ORF & Translation', icon: Dna, hint: 'Open reading frames and six-frame translation' },
  { to: '/alignment', label: 'Alignment', icon: AlignLeft, hint: 'Pairwise and multiple sequence alignment' },
  { to: '/embeddings', label: 'Embeddings', icon: ScatterChart, hint: 'Sequence embeddings and 2-D exploration' },
];

const SECONDARY: NavItem[] = [
  { to: '/reports', label: 'Reports', icon: FileText, hint: 'Generate and export local analysis reports' },
  { to: '/settings', label: 'Settings', icon: Settings, hint: 'Thresholds, display, privacy, and local data' },
];

/**
 * Left navigation.
 *
 * Grouped by workflow stage - set up, analyse, report - rather than
 * alphabetically, so the order matches the order a user actually works in. The
 * analysis group is indented to signal that every item in it operates on the
 * dataset selected above.
 */
export function Sidebar({
  className,
  onNavigate,
}: {
  className?: string;
  /** Called when a navigation link is followed; used to close the mobile drawer. */
  onNavigate?: () => void;
}) {
  return (
    <nav
      className={cn('flex h-full flex-col border-r border-border bg-card', className)}
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-2 px-4 py-3.5">
        <Logo />
        <div className="min-w-0">
          <p className="text-[13px] leading-none font-semibold tracking-tight text-foreground">
            SeqLens
          </p>
          <p className="mt-1 text-[10px] leading-none text-muted-foreground">
            Local sequence intelligence
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <NavGroup items={PRIMARY} onNavigate={onNavigate} />

        <GroupLabel>Analysis</GroupLabel>
        <NavGroup items={ANALYSIS} indent onNavigate={onNavigate} />

        <div className="my-3 h-px bg-border" />
        <NavGroup items={SECONDARY} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-border px-4 py-2.5">
        <p className="text-[10px] text-muted-foreground">
          Version {APP_VERSION} &middot; runs offline
        </p>
      </div>
    </nav>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function NavGroup({
  items,
  indent = false,
  onNavigate,
}: {
  items: NavItem[];
  indent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === '/'}
            title={item.hint}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                indent && 'pl-3',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn('size-4 shrink-0', isActive ? 'text-primary' : '')}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** Wordmark: a stylised double helix over a rule, matching the favicon. */
function Logo() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 32 32"
      className="shrink-0"
      role="img"
      aria-label="SeqLens"
    >
      <rect width="32" height="32" rx="7" fill="#0f172a" />
      <g stroke="#7dd3fc" strokeWidth="2.1" strokeLinecap="round" fill="none">
        <path d="M9 7c6 3 6 15 0 18" />
        <path d="M23 7c-6 3-6 15 0 18" />
      </g>
      <g stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round">
        <path d="M11.2 11h9.6" />
        <path d="M10.4 16h11.2" />
        <path d="M11.2 21h9.6" />
      </g>
    </svg>
  );
}
