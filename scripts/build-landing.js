const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const landingDir = path.join(rootDir, 'landing');
const distDir = path.join(landingDir, 'dist');
const outputDir = path.join(rootDir, 'frontend', 'landing');

function run(command, args, cwd) {
  console.log(`[Landing Build] Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command} ${args.join(' ')}`
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

  run('npm', installArgs, landingDir);
  run('npm', ['run', 'build'], landingDir);

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
