import type {
  ApprovalQueueItemView,
  BenchmarkDetailView,
  BenchmarkSummaryView,
  DashboardOverviewView,
  FailureTaxonomyView,
  RunDetailView,
  RunListItemView,
} from '@gdh/domain';

export interface RunListResponse {
  items: RunListItemView[];
}

export interface ApprovalListResponse {
  items: ApprovalQueueItemView[];
}

export interface BenchmarkListResponse {
  items: BenchmarkSummaryView[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export const dashboardApi = {
  getOverview(): Promise<DashboardOverviewView> {
    return fetchJson<DashboardOverviewView>('/api/overview');
  },

  listRuns(options: { sort: string; status?: string }): Promise<RunListResponse> {
    const params = new URLSearchParams();
    params.set('sort', options.sort);

    if (options.status) {
      params.set('status', options.status);
    }

    return fetchJson<RunListResponse>(`/api/runs?${params.toString()}`);
  },

  getRunDetail(runId: string): Promise<RunDetailView> {
    return fetchJson<RunDetailView>(`/api/runs/${encodeURIComponent(runId)}`);
  },

  listApprovals(): Promise<ApprovalListResponse> {
    return fetchJson<ApprovalListResponse>('/api/approvals');
  },

  listBenchmarks(): Promise<BenchmarkListResponse> {
    return fetchJson<BenchmarkListResponse>('/api/benchmarks');
  },

  getBenchmarkDetail(benchmarkRunId: string): Promise<BenchmarkDetailView> {
    return fetchJson<BenchmarkDetailView>(`/api/benchmarks/${encodeURIComponent(benchmarkRunId)}`);
  },

  getFailures(): Promise<FailureTaxonomyView> {
    return fetchJson<FailureTaxonomyView>('/api/failures');
  },
};
