import { pathToFileURL } from 'node:url';
import { defaultRunnerDefaults } from '@gdh/runner-codex';
import { phaseZeroMetadata } from '@gdh/shared';
import { Command } from 'commander';

function logPlaceholder(command: string): void {
  console.log(
    [
      `Phase 0 placeholder: "${command}" is scaffolded but not implemented yet.`,
      `Current defaults: model=${defaultRunnerDefaults.model}, sandbox=${defaultRunnerDefaults.sandboxMode}, approval=${defaultRunnerDefaults.approvalPolicy}.`,
      `Next implementation target: ${phaseZeroMetadata.nextPhase}.`,
    ].join(' '),
  );
}

export function createProgram(): Command {
  const program = new Command();

  program.name('cp').description('Governed delivery control plane CLI').version('0.1.0');

  program
    .command('run')
    .description('Normalize a spec and start a governed run')
    .argument('<spec-file>', 'Path to a local spec file')
    .action((specFile: string) => {
      logPlaceholder(`run ${specFile}`);
    });

  program
    .command('resume')
    .description('Resume a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      logPlaceholder(`resume ${runId}`);
    });

  program
    .command('approve')
    .description('Approve or reject a pending approval packet')
    .argument('<approval-id>', 'Approval packet identifier')
    .option('--yes', 'Approve the packet')
    .option('--no', 'Reject the packet')
    .action((approvalId: string) => {
      logPlaceholder(`approve ${approvalId}`);
    });

  program
    .command('verify')
    .description('Run verification for a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      logPlaceholder(`verify ${runId}`);
    });

  program
    .command('report')
    .description('Generate a review packet')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      logPlaceholder(`report ${runId}`);
    });

  program
    .command('benchmark')
    .description('Run a benchmark suite')
    .argument('<suite>', 'Benchmark suite name')
    .action((suite: string) => {
      logPlaceholder(`benchmark ${suite}`);
    });

  program
    .command('github')
    .description('GitHub integration commands')
    .command('draft-pr')
    .description('Open a draft pull request for a completed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      logPlaceholder(`github draft-pr ${runId}`);
    });

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run();
}
