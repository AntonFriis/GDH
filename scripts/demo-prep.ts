import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createIsoTimestamp } from '../packages/shared/src/index.ts';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntrypoint = resolve(repoRoot, 'apps/cli/dist/index.js');
const reportDirectory = resolve(repoRoot, 'reports/release');

interface RunSummary {
  artifactsDirectory: string;
  runId: string;
  summary: string;
}

interface BenchmarkSummary {
  artifactsDirectory: string;
  benchmarkRunId: string;
  score: number;
  status: string;
  summary: string;
}

async function ensureBuiltCli(): Promise<void> {
  try {
    await access(cliEntrypoint);
  } catch {
    throw new Error(
      'The built CLI entrypoint is missing. Run `pnpm build` before `pnpm demo:prepare`.',
    );
  }
}

async function runCliJson<T>(args: string[]): Promise<T> {
  const { stdout, stderr } = await execFileAsync('node', [cliEntrypoint, ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 20,
  });

  try {
    return JSON.parse(stdout.trim()) as T;
  } catch (error) {
    throw new Error(
      `Could not parse JSON output from \`node apps/cli/dist/index.js ${args.join(' ')}\`.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  await ensureBuiltCli();
  await mkdir(reportDirectory, { recursive: true });

  const runSummary = await runCliJson<RunSummary>([
    'run',
    'runs/fixtures/release-candidate-demo-spec.md',
    '--runner',
    'fake',
    '--approval-mode',
    'fail',
    '--json',
  ]);
  const benchmarkSummary = await runCliJson<BenchmarkSummary>([
    'benchmark',
    'run',
    'smoke',
    '--ci-safe',
    '--json',
  ]);

  const report = {
    generatedAt: createIsoTimestamp(),
    demoRun: runSummary,
    benchmarkRun: benchmarkSummary,
    nextSteps: [
      'Run `pnpm dashboard:dev` to inspect the generated governed run and benchmark artifacts.',
      `Open /runs/${runSummary.runId} in the dashboard for the demo governed run.`,
      `Open /benchmarks/${benchmarkSummary.benchmarkRunId} in the dashboard for the smoke benchmark result.`,
    ],
  };

  await writeFile(
    resolve(reportDirectory, 'demo-prep.latest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(`Prepared demo governed run: ${runSummary.runId}`);
  console.log(`  Artifacts: ${runSummary.artifactsDirectory}`);
  console.log(`Prepared smoke benchmark run: ${benchmarkSummary.benchmarkRunId}`);
  console.log(`  Artifacts: ${benchmarkSummary.artifactsDirectory}`);
  console.log(`  Score: ${benchmarkSummary.score}`);
  console.log('Dashboard next step: pnpm dashboard:dev');
}

void main();
