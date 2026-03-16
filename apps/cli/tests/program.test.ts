import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram, runSpecFile } from '../src/index';

const tempDirectories: string[] = [];

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-test-'));

  tempDirectories.push(repoRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
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
  execFileSync('git', ['add', '.'], { cwd: repoRoot });

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createProgram', () => {
  it('registers the CLI command surface', () => {
    const program = createProgram();

    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        'run',
        'resume',
        'approve',
        'verify',
        'report',
        'benchmark',
        'github',
      ]),
    );
  });
});

describe('runSpecFile', () => {
  it('runs the fake runner end to end and persists Phase 1 artifacts', async () => {
    const repoRoot = await createTempRepo();
    const specPath = resolve(repoRoot, 'phase1-smoke-spec.md');

    await writeFile(
      specPath,
      [
        '---',
        'title: Fake Runner Smoke',
        'task_type: docs',
        'constraints:',
        '  - Stay in Phase 1.',
        'acceptance_criteria:',
        '  - Create the fake runner output file.',
        '---',
        '',
        '# Fake Runner Smoke',
        '',
        '## Objective',
        'Create a tiny docs-only output file at `docs/fake-run-output.md` for the smoke test.',
      ].join('\n'),
      'utf8',
    );

    const summary = await runSpecFile(specPath, {
      cwd: repoRoot,
      runner: 'fake',
    });

    expect(summary.status).toBe('completed');
    expect(summary.changedFiles).toContain('docs/fake-run-output.md');

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const reviewPacket = await readFile(
      resolve(summary.artifactsDirectory, 'review-packet.md'),
      'utf8',
    );
    const commands = await readFile(
      resolve(summary.artifactsDirectory, 'commands-executed.json'),
      'utf8',
    );
    const runRecord = await readFile(resolve(summary.artifactsDirectory, 'run.json'), 'utf8');

    expect(events).toContain('"type":"run.created"');
    expect(events).toContain('"type":"spec.normalized"');
    expect(events).toContain('"type":"plan.created"');
    expect(events).toContain('"type":"runner.started"');
    expect(events).toContain('"type":"runner.completed"');
    expect(events).toContain('"type":"diff.captured"');
    expect(events).toContain('"type":"review_packet.generated"');
    expect(events).toContain('"type":"run.completed"');
    expect(reviewPacket).toContain('docs/fake-run-output.md');
    expect(commands).toContain('fake-runner.write docs/fake-run-output.md');
    expect(runRecord).toContain('"status": "completed"');
  });
});
