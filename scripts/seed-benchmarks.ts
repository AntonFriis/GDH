import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmarkCatalog } from '../packages/benchmark-cases/src/index.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = await loadBenchmarkCatalog(repoRoot);

for (const suite of catalog.suites) {
  const suiteCases = catalog.cases.filter((caseDefinition) =>
    caseDefinition.suiteIds.includes(suite.id),
  );

  console.log(`${suite.id}: ${suiteCases.length} case(s)`);

  for (const caseDefinition of suiteCases) {
    console.log(`  - ${caseDefinition.id}: ${caseDefinition.title}`);
  }
}
