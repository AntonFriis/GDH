import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createIsoTimestamp } from '../packages/shared/src/index.ts';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = resolve(repoRoot, 'reports/release');

interface RootPackageJson {
  name: string;
  version: string;
}

async function main(): Promise<void> {
  await mkdir(releaseDirectory, { recursive: true });

  const packageJson = JSON.parse(
    await readFile(resolve(repoRoot, 'package.json'), 'utf8'),
  ) as RootPackageJson;
  const tarballName = `${packageJson.name}-${packageJson.version}.tgz`;
  const tarballPath = resolve(releaseDirectory, tarballName);

  await execFileAsync('pnpm', ['pack', '--pack-destination', releaseDirectory], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10,
  });
  await access(tarballPath);

  const manifest = {
    createdAt: createIsoTimestamp(),
    packageName: packageJson.name,
    version: packageJson.version,
    sourceBundle: tarballPath,
    installCommand: 'pnpm bootstrap',
    validateCommand: 'pnpm release:validate',
    demoCommand: 'pnpm demo:prepare',
  };

  await writeFile(
    resolve(releaseDirectory, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    resolve(releaseDirectory, 'release-summary.md'),
    [
      `# ${packageJson.name} ${packageJson.version}`,
      '',
      `- Created: ${manifest.createdAt}`,
      `- Source bundle: ${tarballName}`,
      '- Install: `pnpm bootstrap`',
      '- Validate: `pnpm release:validate`',
      '- Demo: `pnpm demo:prepare`',
    ].join('\n'),
    'utf8',
  );

  console.log(`Created release candidate bundle: ${tarballPath}`);
  console.log(`Wrote release manifest: ${resolve(releaseDirectory, 'release-manifest.json')}`);
}

void main();
