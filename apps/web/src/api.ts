import type { DashboardSnapshot } from '@gdh/domain';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export const dashboardApi = {
  getSnapshot(): Promise<DashboardSnapshot> {
    return fetchJson<DashboardSnapshot>('/api/dashboard');
  },
};
