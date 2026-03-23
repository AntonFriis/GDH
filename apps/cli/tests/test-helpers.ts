import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const tempDirectories: string[] = [];
export const benchmarkRunDirectories: string[] = [];

const defaultPolicyContents = [
  'version: 1',
  'name: test-default',
  'defaults:',
  '  sandbox_mode: workspace-write',
  '  network_access: false',
  '  approval_policy: on-request',
  '  fallback_decision: prompt',
  'rules:',
  '  - id: docs-safe',
  '    match:',
  '      task_classes: [docs]',
  '      paths: ["docs/**", "README.md"]',
  '      actions: [read, write]',
  '    decision: allow',
  '  - id: auth-protected',
  '    match:',
  '      paths: ["src/auth/**"]',
  '      actions: [write]',
  '    decision: prompt',
  '    reason: Auth changes require approval.',
  '  - id: secrets-forbidden',
  '    match:',
  '      paths: [".env", ".env.*"]',
  '      actions: [read, write, secrets_touch]',
  '    decision: forbid',
  '    reason: Secrets are forbidden.',
].join('\n');

export interface VerificationConfig {
  optional?: string[];
  postrun?: string[];
  preflight?: string[];
}

export interface MutableRunFixture {
  [key: string]: unknown;
  currentStage?: string;
  lastCheckpointId?: string;
  lastSuccessfulStage?: string;
  pendingStage?: string;
  status?: string;
  verificationStatus?: string;
}

export interface MutableManifestFixture {
  [key: string]: unknown;
  currentStage?: string;
  lastCheckpointId?: string;
  lastSuccessfulStage?: string;
  pendingStage?: string;
  pendingStep?: string;
  status?: string;
  summary?: string;
  verificationState: {
    status?: string;
  };
  workspace: {
    lastSnapshot: {
      repoRoot?: string;
    };
  };
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

export async function writeRunFixtureState(
  runDirectory: string,
  updater: (input: {
    manifest: MutableManifestFixture;
    run: MutableRunFixture;
  }) => Promise<void> | void,
): Promise<void> {
  const manifestPath = resolve(runDirectory, 'session.manifest.json');
  const runPath = resolve(runDirectory, 'run.json');
  const manifest = await readJson<MutableManifestFixture>(manifestPath);
  const run = await readJson<MutableRunFixture>(runPath);

  await updater({ manifest, run });

  await writeJson(manifestPath, manifest);
  await writeJson(runPath, run);
}

export async function checkpointPathForStage(
  runDirectory: string,
  stage: string,
): Promise<string | undefined> {
  const checkpointDirectory = resolve(runDirectory, 'checkpoints');
  const files = await readdir(checkpointDirectory);

  for (const fileName of files) {
    const checkpoint = await readJson<{ stage?: string }>(resolve(checkpointDirectory, fileName));

    if (checkpoint.stage === stage) {
      return resolve(checkpointDirectory, fileName);
    }
  }

  return undefined;
}

export async function createTempRepo(verification?: VerificationConfig): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-test-'));

  tempDirectories.push(repoRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
  await mkdir(resolve(repoRoot, 'scripts'), { recursive: true });
  await writeFile(
    resolve(repoRoot, '.gitignore'),
    ['runs/local/**', '!runs/local/.gitkeep', 'node_modules/', 'dist/'].join('\n'),
    'utf8',
  );
  await writeFile(resolve(repoRoot, 'runs', 'local', '.gitkeep'), '', 'utf8');
  await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\n', 'utf8');
  await writeFile(resolve(repoRoot, 'AGENTS.md'), '# AGENTS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'PLANS.md'), '# PLANS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'implement.md'), '# implement\n', 'utf8');
  await writeFile(resolve(repoRoot, 'documentation.md'), '# documentation\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'codex_governed_delivery_handoff_spec.md'),
    '# handoff\n',
    'utf8',
  );
  await mkdir(resolve(repoRoot, '.codex'), { recursive: true });
  await writeFile(resolve(repoRoot, '.codex', 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'policies', 'default.policy.yaml'),
    defaultPolicyContents,
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'pass.mjs'),
    "console.log(process.argv.slice(2).join(' '));\n",
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'fail.mjs'),
    "console.error(process.argv.slice(2).join(' '));\nprocess.exit(1);\n",
    'utf8',
  );
  await writeJson(resolve(repoRoot, 'gdh.config.json'), {
    verification: {
      preflight: verification?.preflight ?? [],
      postrun: verification?.postrun ?? [],
      optional: verification?.optional ?? [],
    },
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });

  return repoRoot;
}

export async function writeSpec(
  repoRoot: string,
  fileName: string,
  objective: string,
): Promise<string> {
  const specPath = resolve(repoRoot, fileName);

  await writeFile(
    specPath,
    [
      '---',
      'title: CLI Verification Test',
      'task_type: docs',
      'constraints:',
      '  - Keep the change deterministic.',
      'acceptance_criteria:',
      '  - Persist the expected artifacts.',
      '---',
      '',
      '# CLI Verification Test',
      '',
      '## Objective',
      objective,
    ].join('\n'),
    'utf8',
  );

  return specPath;
}

export async function cleanupTempDirectories(): Promise<void> {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export async function cleanupBenchmarkRunDirectories(): Promise<void> {
  await Promise.all(
    benchmarkRunDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
