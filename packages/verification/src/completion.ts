import { resolve } from 'node:path';
import { listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import type {
  RunCompletionDecision,
  VerificationCheck,
  VerificationCommandResult,
  VerificationStatus,
} from '@gdh/domain';
import { RunCompletionDecisionSchema } from '@gdh/domain';
import { createEvidence } from './builders.js';
import { evaluateCheck } from './commands.js';
import type { VerificationRunInput } from './orchestrator.js';

export function decideRunCompletion(checks: VerificationCheck[]): RunCompletionDecision {
  const blockingChecks = checks.filter((check) => check.mandatory && check.status === 'failed');

  return RunCompletionDecisionSchema.parse({
    finalStatus: blockingChecks.length === 0 ? 'completed' : 'failed',
    canComplete: blockingChecks.length === 0,
    summary:
      blockingChecks.length === 0
        ? 'Verification passed and the run can be marked completed.'
        : `Verification failed because ${blockingChecks.length} mandatory check(s) did not pass.`,
    blockingCheckIds: blockingChecks.map((check) => check.id),
    blockingReasons: blockingChecks.map((check) => check.summary),
  });
}

export async function createArtifactCompletenessCheck(
  input: VerificationRunInput,
  commandResults: VerificationCommandResult[],
): Promise<VerificationCheck> {
  return evaluateCheck(
    input,
    {
      idSeed: `${input.run.id}:artifact-completeness`,
      mandatory: true,
      name: 'artifacts.completeness',
    },
    async () => {
      const artifacts = await listArtifactReferencesFromRunDirectory(
        input.run.id,
        input.run.runDirectory,
      );
      const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
      const expectedPaths = [
        'run.json',
        'events.jsonl',
        'spec.normalized.json',
        'plan.json',
        'impact-preview.json',
        'policy.input.json',
        'policy.decision.json',
        'runner.result.json',
        'commands-executed.json',
        'changed-files.json',
        'diff.patch',
        'policy-audit.json',
        'verification.checks.json',
        'claim-checks.json',
        'packet-completeness.json',
        'review-packet.json',
        'review-packet.md',
      ].map((relativePath) => resolve(input.run.runDirectory, relativePath));

      if (input.policyDecision.requiredApprovalMode !== null) {
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-packet.json'));
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-packet.md'));
      }

      if (input.approvalResolution) {
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-resolution.json'));
      }

      for (const command of commandResults) {
        if (command.stdoutArtifactPath) {
          expectedPaths.push(command.stdoutArtifactPath);
        }

        if (command.stderrArtifactPath) {
          expectedPaths.push(command.stderrArtifactPath);
        }
      }

      const missingPaths = expectedPaths.filter((path) => !artifactPaths.has(path));

      return {
        status: missingPaths.length === 0 ? 'passed' : 'failed',
        summary:
          missingPaths.length === 0
            ? 'All expected run and verification artifacts are present.'
            : `${missingPaths.length} expected artifact(s) were missing from the run directory.`,
        details: missingPaths,
        evidence: [
          createEvidence('artifact', 'Run artifact inventory', {
            value: artifacts.map((artifact) => artifact.path).join(', '),
          }),
        ],
      };
    },
  );
}

export function verificationStatusFromDecision(
  decision: RunCompletionDecision,
): VerificationStatus {
  return decision.canComplete ? 'passed' : 'failed';
}
