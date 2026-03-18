import type {
  ApprovalQueueItemView,
  ArtifactLinkView,
  BenchmarkDetailView,
  BenchmarkSummaryView,
  DashboardOverviewView,
  FailureTaxonomyBucketView,
  FailureTaxonomyView,
  RunDetailView,
  RunListItemView,
} from '@gdh/domain';
import { type ReactNode, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  MemoryRouter,
  NavLink,
  Route,
  Routes,
  useParams,
} from 'react-router-dom';
import { dashboardApi } from './api';
import './app.css';

type AsyncState<T> =
  | { status: 'loading' }
  | { error: string; status: 'error' }
  | { data: T; status: 'ready' };

const runSortOptions = [
  { label: 'Updated newest', value: 'updated_desc' },
  { label: 'Updated oldest', value: 'updated_asc' },
  { label: 'Created newest', value: 'created_desc' },
  { label: 'Created oldest', value: 'created_asc' },
] as const;

const runStatusFilters = [
  { label: 'All statuses', value: '' },
  { label: 'Awaiting approval', value: 'awaiting_approval' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
] as const;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function startAsyncRequest<T>(
  loader: () => Promise<T>,
  setState: (nextState: AsyncState<T>) => void,
): () => void {
  let cancelled = false;
  setState({ status: 'loading' });

  void loader()
    .then((data) => {
      if (!cancelled) {
        setState({ data, status: 'ready' });
      }
    })
    .catch((error) => {
      if (!cancelled) {
        setState({
          error: error instanceof Error ? error.message : 'Unknown request failure.',
          status: 'error',
        });
      }
    });

  return () => {
    cancelled = true;
  };
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return 'Unavailable';
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return dateFormatter.format(date);
}

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusTone(value: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (
    value === 'completed' ||
    value === 'passed' ||
    value === 'ready' ||
    value === 'draft_pr_created'
  ) {
    return 'success';
  }

  if (value === 'awaiting_approval' || value === 'pending' || value === 'prompt') {
    return 'warning';
  }

  if (
    value === 'failed' ||
    value === 'verification_failed' ||
    value === 'denied' ||
    value === 'forbid'
  ) {
    return 'error';
  }

  return 'neutral';
}

function StatusPill({ value }: { value: string }) {
  return <span className={`pill pill-${statusTone(value)}`}>{formatLabel(value)}</span>;
}

function PageFrame({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Governed Delivery Dashboard</p>
          <h1>{title}</h1>
          <p className="page-copy">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="panel state-panel">Loading {label}...</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="panel state-panel error-panel">{message}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="panel state-panel">{message}</div>;
}

function SectionCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ArtifactLinks({ links }: { links: ArtifactLinkView[] }) {
  if (links.length === 0) {
    return <p className="muted">No artifact links are available for this section.</p>;
  }

  return (
    <ul className="artifact-list">
      {links.map((link) => (
        <li className="artifact-item" key={`${link.path}:${link.label}`}>
          <div>
            {link.href ? (
              <a href={link.href} rel="noreferrer" target="_blank">
                {link.label}
              </a>
            ) : (
              <span>{link.label}</span>
            )}
            <p className="muted">{link.summary ?? link.relativePath}</p>
          </div>
          <code>{link.relativePath}</code>
        </li>
      ))}
    </ul>
  );
}

function OverviewPage() {
  const [state, setState] = useState<AsyncState<DashboardOverviewView>>({ status: 'loading' });

  useEffect(() => startAsyncRequest(() => dashboardApi.getOverview(), setState), []);

  if (state.status === 'loading') {
    return <LoadingState label="overview" />;
  }

  if (state.status === 'error') {
    return <ErrorState message={state.error} />;
  }

  const overview = state.data;

  return (
    <PageFrame
      subtitle="Operational counts, recent activity, pending approvals, and benchmark health derived from persisted artifacts."
      title="Overview"
    >
      <div className="summary-grid">
        <section className="summary-card">
          <span className="summary-label">Runs</span>
          <strong>{overview.analytics.totalRuns}</strong>
          <span className="summary-footnote">
            {overview.analytics.approvalPendingRuns} pending approvals
          </span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Verification failures</span>
          <strong>{overview.analytics.verificationFailedRuns}</strong>
          <span className="summary-footnote">
            {overview.analytics.verificationPassedRuns} passed verifications
          </span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Draft PRs</span>
          <strong>{overview.analytics.githubDraftPrRuns}</strong>
          <span className="summary-footnote">Recorded in local run artifacts</span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Benchmark regressions</span>
          <strong>{overview.analytics.benchmarkRegressionFailures}</strong>
          <span className="summary-footnote">
            {overview.analytics.totalBenchmarks} benchmark runs
          </span>
        </section>
      </div>

      <div className="two-column-grid">
        <SectionCard title="Recent runs">
          <RunListTable items={overview.recentRuns} />
        </SectionCard>
        <SectionCard title="Recent benchmarks">
          <BenchmarkListTable items={overview.recentBenchmarks} />
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title="Pending approvals">
          <ApprovalsList items={overview.approvals} />
        </SectionCard>
        <SectionCard title="Failure taxonomy">
          <FailureBuckets buckets={overview.failures.buckets} condensed />
        </SectionCard>
      </div>
    </PageFrame>
  );
}

function RunListTable({ items }: { items: RunListItemView[] }) {
  if (items.length === 0) {
    return <EmptyState message="No governed runs are available in the current artifact store." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Approval</th>
            <th>Verification</th>
            <th>GitHub</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link to={`/runs/${encodeURIComponent(item.id)}`}>{item.title}</Link>
                <p className="table-subcopy">{item.objective}</p>
              </td>
              <td>
                <StatusPill value={item.status} />
              </td>
              <td>
                <StatusPill value={item.approval.status} />
              </td>
              <td>
                <StatusPill value={item.verification.status} />
              </td>
              <td>
                <StatusPill value={item.github.status} />
              </td>
              <td>{formatTimestamp(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<(typeof runSortOptions)[number]['value']>('updated_desc');
  const [state, setState] = useState<AsyncState<{ items: RunListItemView[] }>>({
    status: 'loading',
  });

  useEffect(() => {
    return startAsyncRequest(
      () => dashboardApi.listRuns({ sort, status: statusFilter || undefined }),
      setState,
    );
  }, [sort, statusFilter]);

  return (
    <PageFrame
      subtitle="Governed runs normalized into a consistent operator view, even when older artifacts are missing newer fields."
      title="Runs"
    >
      <div className="panel filter-panel">
        <label>
          Status
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            {runStatusFilters.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}>
            {runSortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === 'loading' ? (
        <LoadingState label="runs" />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error} />
      ) : (
        <RunListTable items={state.data.items} />
      )}
    </PageFrame>
  );
}

function DetailStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="muted">No additional entries.</p>;
  }

  return (
    <ul className="simple-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const [state, setState] = useState<AsyncState<RunDetailView>>({ status: 'loading' });

  useEffect(() => {
    return startAsyncRequest(() => dashboardApi.getRunDetail(params.runId ?? ''), setState);
  }, [params.runId]);

  if (state.status === 'loading') {
    return <LoadingState label="run detail" />;
  }

  if (state.status === 'error') {
    return <ErrorState message={state.error} />;
  }

  const detail = state.data;

  return (
    <PageFrame subtitle={detail.summary} title={detail.title}>
      <div className="detail-grid">
        <section className="summary-card">
          <span className="summary-label">Run status</span>
          <StatusPill value={detail.status} />
          <span className="summary-footnote">{detail.currentStage ?? 'Stage unavailable'}</span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Approval</span>
          <StatusPill value={detail.approval.status} />
          <span className="summary-footnote">{detail.approval.summary}</span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Verification</span>
          <StatusPill value={detail.verification.status} />
          <span className="summary-footnote">{detail.verification.summary}</span>
        </section>
        <section className="summary-card">
          <span className="summary-label">GitHub</span>
          <StatusPill value={detail.github.status} />
          <span className="summary-footnote">{detail.github.summary}</span>
        </section>
      </div>

      <div className="two-column-grid">
        <SectionCard title="Normalized spec">
          <DetailStat label="Objective" value={detail.normalizedSpec.objective} />
          <DetailStat label="Source" value={detail.normalizedSpec.source} />
          <DetailStat label="Source path" value={<code>{detail.normalizedSpec.sourcePath}</code>} />
          <SummaryList items={detail.normalizedSpec.acceptanceCriteria} />
        </SectionCard>
        <SectionCard title="Plan summary">
          <p>{detail.plan.summary}</p>
          <ol className="simple-list numbered-list">
            {detail.plan.taskUnits.map((task) => (
              <li key={`${task.order}:${task.title}`}>
                <strong>{task.title}</strong>
                <span>{task.description}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title="Approval and verification">
          <DetailStat label="Approval summary" value={detail.approval.summary} />
          <DetailStat label="Verification summary" value={detail.verification.summary} />
          <SummaryList items={detail.verification.mandatoryFailures} />
          <ArtifactLinks
            links={[...detail.approval.artifactLinks, ...detail.verification.artifactLinks]}
          />
        </SectionCard>
        <SectionCard title="Review packet">
          <DetailStat
            label="Packet status"
            value={<StatusPill value={detail.reviewPacket.packetStatus} />}
          />
          <p>{detail.reviewPacket.overview}</p>
          <SummaryList items={detail.reviewPacket.diffSummary} />
          <ArtifactLinks links={detail.reviewPacket.artifactLinks} />
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title="GitHub delivery">
          <p>{detail.github.summary}</p>
          {detail.github.pullRequest ? (
            <p>
              <a href={detail.github.pullRequest.url} rel="noreferrer" target="_blank">
                Draft PR #{detail.github.pullRequest.pullRequestNumber}
              </a>
            </p>
          ) : (
            <p className="muted">No draft PR is recorded for this run.</p>
          )}
          <ArtifactLinks links={detail.github.artifactLinks} />
        </SectionCard>
        <SectionCard title="Linked benchmarks">
          {detail.benchmarkLinks.length === 0 ? (
            <p className="muted">No benchmark runs reference this governed run yet.</p>
          ) : (
            <BenchmarkListTable items={detail.benchmarkLinks} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Timeline">
        {detail.timeline.length === 0 ? (
          <p className="muted">No event timeline is available for this run.</p>
        ) : (
          <ol className="timeline-list">
            {detail.timeline.map((event) => (
              <li className={`timeline-item timeline-${event.severity}`} key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.summary}</p>
                </div>
                <span>{formatTimestamp(event.timestamp)}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard title="Artifacts">
        <ArtifactLinks links={detail.artifactLinks} />
      </SectionCard>
    </PageFrame>
  );
}

function ApprovalsList({ items }: { items: ApprovalQueueItemView[] }) {
  if (items.length === 0) {
    return <EmptyState message="No approval-requiring runs are currently recorded." />;
  }

  return (
    <div className="stack">
      {items.map((item) => (
        <article className="approval-card" key={item.runId}>
          <div className="approval-card-header">
            <div>
              <Link to={`/runs/${encodeURIComponent(item.runId)}`}>{item.title}</Link>
              <p className="table-subcopy">{item.approval.summary}</p>
            </div>
            <StatusPill value={item.approval.status} />
          </div>
          <div className="chip-row">
            {item.approval.affectedPaths.map((path) => (
              <code key={path}>{path}</code>
            ))}
          </div>
          <SummaryList items={item.approval.reasons} />
        </article>
      ))}
    </div>
  );
}

function ApprovalsPage() {
  const [state, setState] = useState<AsyncState<{ items: ApprovalQueueItemView[] }>>({
    status: 'loading',
  });

  useEffect(() => startAsyncRequest(() => dashboardApi.listApprovals(), setState), []);

  return (
    <PageFrame
      subtitle="Runs that required explicit approval, along with the recorded reasons and affected scope."
      title="Approvals"
    >
      {state.status === 'loading' ? (
        <LoadingState label="approvals" />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error} />
      ) : (
        <ApprovalsList items={state.data.items} />
      )}
    </PageFrame>
  );
}

function BenchmarkListTable({ items }: { items: BenchmarkSummaryView[] }) {
  if (items.length === 0) {
    return <EmptyState message="No benchmark runs are recorded yet." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Benchmark</th>
            <th>Score</th>
            <th>Status</th>
            <th>Regression</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link to={`/benchmarks/${encodeURIComponent(item.id)}`}>{item.title}</Link>
                <p className="table-subcopy">{item.summary}</p>
              </td>
              <td>{formatScore(item.normalizedScore)}</td>
              <td>
                <StatusPill value={item.status} />
              </td>
              <td>
                <StatusPill value={item.regressionStatus ?? 'not_requested'} />
              </td>
              <td>{formatTimestamp(item.completedAt ?? item.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BenchmarksPage() {
  const [state, setState] = useState<AsyncState<{ items: BenchmarkSummaryView[] }>>({
    status: 'loading',
  });

  useEffect(() => startAsyncRequest(() => dashboardApi.listBenchmarks(), setState), []);

  return (
    <PageFrame
      subtitle="Suite and case outcomes derived from persisted benchmark artifacts, including comparison and regression state."
      title="Benchmarks"
    >
      {state.status === 'loading' ? (
        <LoadingState label="benchmarks" />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error} />
      ) : (
        <BenchmarkListTable items={state.data.items} />
      )}
    </PageFrame>
  );
}

function BenchmarkDetailPage() {
  const params = useParams<{ benchmarkRunId: string }>();
  const [state, setState] = useState<AsyncState<BenchmarkDetailView>>({
    status: 'loading',
  });

  useEffect(() => {
    return startAsyncRequest(
      () => dashboardApi.getBenchmarkDetail(params.benchmarkRunId ?? ''),
      setState,
    );
  }, [params.benchmarkRunId]);

  if (state.status === 'loading') {
    return <LoadingState label="benchmark detail" />;
  }

  if (state.status === 'error') {
    return <ErrorState message={state.error} />;
  }

  const detail = state.data;

  return (
    <PageFrame subtitle={detail.summary.summary} title={detail.summary.title}>
      <div className="summary-grid">
        <section className="summary-card">
          <span className="summary-label">Score</span>
          <strong>{formatScore(detail.summary.normalizedScore)}</strong>
          <span className="summary-footnote">{detail.summary.totalCases} total cases</span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Regression</span>
          <StatusPill value={detail.summary.regressionStatus ?? 'not_requested'} />
          <span className="summary-footnote">
            {detail.summary.regressionSummary ?? 'No comparison artifact.'}
          </span>
        </section>
        <section className="summary-card">
          <span className="summary-label">Status</span>
          <StatusPill value={detail.summary.status} />
          <span className="summary-footnote">{detail.summary.summary}</span>
        </section>
      </div>

      <div className="two-column-grid">
        <SectionCard title="Suite and thresholds">
          <DetailStat
            label="Suite"
            value={detail.suiteTitle ?? detail.summary.suiteId ?? 'Single-case benchmark'}
          />
          <DetailStat
            label="Threshold policy"
            value={detail.thresholdPolicy ? 'Configured' : 'Not configured'}
          />
          <SummaryList
            items={
              detail.thresholdPolicy
                ? [
                    `Max overall score drop: ${detail.thresholdPolicy.maxOverallScoreDrop}`,
                    `Required metrics: ${detail.thresholdPolicy.requiredMetrics.join(', ')}`,
                    detail.thresholdPolicy.failOnNewlyFailingCases
                      ? 'Fails on newly failing cases.'
                      : 'Does not fail on newly failing cases.',
                  ]
                : []
            }
          />
        </SectionCard>
        <SectionCard title="Artifacts">
          <ArtifactLinks links={detail.summary.artifactLinks} />
        </SectionCard>
      </div>

      <SectionCard title="Case outcomes">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>Score</th>
                <th>Governed run</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {detail.caseSummaries.map((caseSummary) => (
                <tr key={caseSummary.caseId}>
                  <td>
                    <strong>{caseSummary.title}</strong>
                    <p className="table-subcopy">
                      {caseSummary.failureReasons.join(' ') || 'No failure reasons.'}
                    </p>
                  </td>
                  <td>
                    <StatusPill value={caseSummary.status} />
                  </td>
                  <td>{formatScore(caseSummary.normalizedScore)}</td>
                  <td>
                    {caseSummary.governedRunId ? (
                      <Link to={`/runs/${encodeURIComponent(caseSummary.governedRunId)}`}>
                        {caseSummary.governedRunId}
                      </Link>
                    ) : (
                      <span className="muted">Not linked</span>
                    )}
                  </td>
                  <td>{Math.round(caseSummary.durationMs / 1000)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </PageFrame>
  );
}

function FailureBuckets({
  buckets,
  condensed = false,
}: {
  buckets: FailureTaxonomyBucketView[];
  condensed?: boolean;
}) {
  const visibleBuckets = condensed
    ? buckets.filter((bucket) => bucket.count > 0).slice(0, 4)
    : buckets;

  if (visibleBuckets.length === 0) {
    return <EmptyState message="No failure buckets are available." />;
  }

  return (
    <div className="stack">
      {visibleBuckets.map((bucket) => (
        <article className="failure-bucket" key={bucket.kind}>
          <div className="failure-bucket-header">
            <h3>{bucket.title}</h3>
            <span className="pill pill-neutral">{bucket.count}</span>
          </div>
          {bucket.items.length === 0 ? (
            <p className="muted">No current items.</p>
          ) : (
            <ul className="simple-list">
              {bucket.items.map((item) => (
                <li key={`${bucket.kind}:${item.id}`}>
                  {item.href ? <Link to={item.href}>{item.title}</Link> : <span>{item.title}</span>}
                  <span className="table-subcopy">{item.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

function FailuresPage() {
  const [state, setState] = useState<AsyncState<FailureTaxonomyView>>({
    status: 'loading',
  });

  useEffect(() => startAsyncRequest(() => dashboardApi.getFailures(), setState), []);

  return (
    <PageFrame
      subtitle="Operational failure buckets derived from run and benchmark artifacts, without reading raw files."
      title="Failure taxonomy"
    >
      {state.status === 'loading' ? (
        <LoadingState label="failure taxonomy" />
      ) : state.status === 'error' ? (
        <ErrorState message={state.error} />
      ) : (
        <FailureBuckets buckets={state.data.buckets} />
      )}
    </PageFrame>
  );
}

function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<OverviewPage />} path="/" />
      <Route element={<RunsPage />} path="/runs" />
      <Route element={<RunDetailPage />} path="/runs/:runId" />
      <Route element={<ApprovalsPage />} path="/approvals" />
      <Route element={<BenchmarksPage />} path="/benchmarks" />
      <Route element={<BenchmarkDetailPage />} path="/benchmarks/:benchmarkRunId" />
      <Route element={<FailuresPage />} path="/failures" />
    </Routes>
  );
}

function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Phase 8 RC</p>
          <h1>Governed Delivery Dashboard</h1>
          <p className="sidebar-copy">
            Local visibility over governed runs, approvals, verification, GitHub delivery, and
            benchmarks.
          </p>
        </div>
        <nav className="nav-stack">
          <NavLink end to="/">
            Overview
          </NavLink>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/benchmarks">Benchmarks</NavLink>
          <NavLink to="/failures">Failure taxonomy</NavLink>
        </nav>
      </aside>
      <main className="content-shell">
        <DashboardRoutes />
      </main>
    </div>
  );
}

export function TestApp({ initialEntries }: { initialEntries: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
    </MemoryRouter>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
