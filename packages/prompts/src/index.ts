export const promptTemplates = [
  {
    id: 'planner',
    file: 'prompts/planner.md',
    purpose: 'Turn a normalized spec into a bounded milestone plan.',
  },
  {
    id: 'executor',
    file: 'prompts/executor.md',
    purpose: 'Guide governed execution inside approved task boundaries.',
  },
  {
    id: 'verifier',
    file: 'prompts/verifier.md',
    purpose: 'Summarize verification evidence and unsupported claims.',
  },
  {
    id: 'reviewer',
    file: 'prompts/reviewer.md',
    purpose: 'Generate a human-facing review packet from verified artifacts.',
  },
  {
    id: 'summarizer',
    file: 'prompts/summarizer.md',
    purpose: 'Compress long-running progress into compact artifact-linked context.',
  },
] as const;

export function listPromptTemplateIds(): string[] {
  return promptTemplates.map((template) => template.id);
}
