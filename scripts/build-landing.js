const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const landingDir = path.join(rootDir, 'landing');
const distDir = path.join(landingDir, 'dist');
const outputDir = path.join(rootDir, 'frontend', 'landing');

function runNpm(args, cwd) {
  console.log(`[Landing Build] Running: npm ${args.join(' ')}`);

  const npmCli = process.env.npm_execpath;
  const useNpmCli = npmCli && fs.existsSync(npmCli);
  const command = useNpmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = useNpmCli ? [npmCli, ...args] : args;

  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: useNpmCli ? false : process.platform === 'win32',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: npm ${args.join(' ')}`
    );
  }
}

function main() {
  if (!fs.existsSync(path.join(landingDir, 'package.json'))) {
    throw new Error(`Landing project not found at ${landingDir}`);
  }

  const hasLockfile = fs.existsSync(path.join(landingDir, 'package-lock.json'));
  const installArgs = hasLockfile
    ? ['ci', '--include=dev', '--no-audit', '--no-fund']
    : ['install', '--include=dev', '--no-audit', '--no-fund'];

  runNpm(installArgs, landingDir);
  runNpm(['run', 'build'], landingDir);

  const distIndex = path.join(distDir, 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error(`Landing build did not produce ${distIndex}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.cpSync(distDir, outputDir, { recursive: true });

  console.log(`[Landing Build] Copied build output to ${outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(`[Landing Build] FAILED: ${error.message}`);
  process.exit(1);
}
