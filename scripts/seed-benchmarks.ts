import { phaseZeroBenchmarkCases } from '../packages/benchmark-cases/src/index.ts';

for (const benchmarkCase of phaseZeroBenchmarkCases) {
  console.log(
    `Seed placeholder benchmark: ${benchmarkCase.id} (${benchmarkCase.suite}) -> ${benchmarkCase.inputSpecPath}`,
  );
}
