export interface ReviewChecklistData {
  benchmarkRun: {
    artifactsDirectory: string;
    benchmarkRunId: string;
    score: number;
    status: string;
    summary: string;
  };
  dashboard: {
    apiHealthUrl: string;
    command: string;
    runRoute: string;
    benchmarkRoute: string;
    webUrl: string;
  };
  demoRun: {
    artifactsDirectory: string;
    runId: string;
    summary: string;
  };
  environment: {
    branch: string;
    dirty: boolean;
    gitSha: string;
    nodeVersion: string;
    pnpmVersion: string;
  };
  generatedAt: string;
  references: {
    architecture: string;
    benchmarkCorpus: string;
    benchmarkSummary: string;
    demoWalkthrough: string;
    knownLimitations: string;
    releaseReport: string;
  };
  version: string;
}

export function renderReviewChecklistMarkdown(data: ReviewChecklistData): string {
  return [
    '# GDH Review Checklist',
    '',
    `Generated: ${data.generatedAt}`,
    `Version: \`${data.version}\``,
    '',
    '## Environment',
    `- [x] Node.js: \`${data.environment.nodeVersion}\``,
    `- [x] pnpm: \`${data.environment.pnpmVersion}\``,
    `- [x] Git SHA: \`${data.environment.gitSha}\``,
    `- [x] Branch: \`${data.environment.branch}\``,
    `- [x] Working tree dirty: \`${data.environment.dirty ? 'yes' : 'no'}\``,
    '',
    '## Validation',
    '- [x] `pnpm release:validate` passed.',
    `- [x] Demo run: \`${data.demoRun.runId}\` — ${data.demoRun.summary}`,
    `- [x] Demo artifacts: \`${data.demoRun.artifactsDirectory}\``,
    `- [x] Smoke benchmark: \`${data.benchmarkRun.benchmarkRunId}\` — ${data.benchmarkRun.summary}`,
    `- [x] Smoke benchmark score: \`${data.benchmarkRun.score.toFixed(2)}\` (\`${data.benchmarkRun.status}\`)`,
    `- [x] Benchmark artifacts: \`${data.benchmarkRun.artifactsDirectory}\``,
    '',
    '## References',
    `- [x] Architecture: [${data.references.architecture}](${data.references.architecture})`,
    `- [x] Demo walkthrough: [${data.references.demoWalkthrough}](${data.references.demoWalkthrough})`,
    `- [x] Known limitations: [${data.references.knownLimitations}](${data.references.knownLimitations})`,
    `- [x] Benchmark summary: [${data.references.benchmarkSummary}](${data.references.benchmarkSummary})`,
    `- [x] Benchmark corpus: [${data.references.benchmarkCorpus}](${data.references.benchmarkCorpus})`,
    `- [x] Release report: [${data.references.releaseReport}](${data.references.releaseReport})`,
    '',
    '## Dashboard',
    `- [x] Start locally with \`${data.dashboard.command}\`.`,
    `- [x] Web UI: [${data.dashboard.webUrl}](${data.dashboard.webUrl})`,
    `- [x] API health: [${data.dashboard.apiHealthUrl}](${data.dashboard.apiHealthUrl})`,
    `- [x] Demo route after startup: \`${data.dashboard.runRoute}\``,
    `- [x] Benchmark route after startup: \`${data.dashboard.benchmarkRoute}\``,
    '',
  ].join('\n');
}
