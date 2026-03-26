import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createIsoTimestamp,
  type ReviewChecklistData,
  renderReviewChecklistMarkdown,
} from '../packages/shared/src/index.ts';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsDirectory = resolve(repoRoot, 'reports');

interface DemoPrepReport {
  benchmarkRun: {
    artifactsDirectory: string;
    benchmarkRunId: string;
    score: number;
    status: string;
    summary: string;
  };
  demoRun: {
    artifactsDirectory: string;
    runId: string;
    summary: string;
  };
}

interface RootPackageJson {
  version: string;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Command failed: ${command} ${args.join(' ')}`));
    });
  });
}

async function runQuietCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 5,
  });

  return stdout.trim();
}

async function main(): Promise<void> {
  await mkdir(reportsDirectory, { recursive: true });

  await runCommand('pnpm', ['release:validate']);
  await runCommand('pnpm', ['demo:prepare']);

  const packageJson = JSON.parse(
    await readFile(resolve(repoRoot, 'package.json'), 'utf8'),
  ) as RootPackageJson;
  const demoPrepReport = JSON.parse(
    await readFile(resolve(reportsDirectory, 'release', 'demo-prep.latest.json'), 'utf8'),
  ) as DemoPrepReport;
  const pnpmVersion = await runQuietCommand('pnpm', ['--version']);
  const gitSha = await runQuietCommand('git', ['rev-parse', '--short', 'HEAD']);
  const branch = await runQuietCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirtyStatus = await runQuietCommand('git', ['status', '--short']);

  const checklistData: ReviewChecklistData = {
    benchmarkRun: demoPrepReport.benchmarkRun,
    dashboard: {
      apiHealthUrl: 'http://127.0.0.1:3000/health',
      benchmarkRoute: `/benchmarks/${demoPrepReport.benchmarkRun.benchmarkRunId}`,
      command: 'pnpm dashboard:dev',
      runRoute: `/runs/${demoPrepReport.demoRun.runId}`,
      webUrl: 'http://127.0.0.1:5173',
    },
    demoRun: demoPrepReport.demoRun,
    environment: {
      branch,
      dirty: dirtyStatus.length > 0,
      gitSha,
      nodeVersion: process.version,
      pnpmVersion,
    },
    generatedAt: createIsoTimestamp(),
    references: {
      architecture: 'docs/architecture-overview.md',
      benchmarkCorpus: 'reports/benchmark-corpus-summary.md',
      benchmarkSummary: 'reports/benchmark-summary.md',
      demoWalkthrough: 'docs/demo-walkthrough.md',
      knownLimitations: 'README.md#known-limitations',
      releaseReport: 'reports/v1-release-report.md',
    },
    version: packageJson.version,
  };

  const markdownPath = resolve(reportsDirectory, 'review-checklist.md');
  const jsonPath = resolve(reportsDirectory, 'review-checklist.latest.json');

  await writeFile(markdownPath, `${renderReviewChecklistMarkdown(checklistData)}\n`, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(checklistData, null, 2)}\n`, 'utf8');

  console.log('\nReview quick completed.');
  console.log(`Checklist: ${relative(repoRoot, markdownPath)}`);
  console.log(`JSON: ${relative(repoRoot, jsonPath)}`);
  console.log('Dashboard: run `pnpm dashboard:dev`');
  console.log(`Web: ${checklistData.dashboard.webUrl}`);
  console.log(`API health: ${checklistData.dashboard.apiHealthUrl}`);
}

void main();
