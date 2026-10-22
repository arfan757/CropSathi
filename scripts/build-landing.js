const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const landingDir = path.join(rootDir, 'landing');
const distDir = path.join(landingDir, 'dist');
const frontendDir = path.join(rootDir, 'frontend');
const outputIndex = path.join(frontendDir, 'index.html');
const outputAssetsDir = path.join(frontendDir, 'landing-assets');
const assetsDirName = 'landing-assets';

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

function copyGeneratedOutput() {
  const distIndex = path.join(distDir, 'index.html');
  const distAssetsDir = path.join(distDir, assetsDirName);

  if (!fs.existsSync(distIndex)) {
    throw new Error(`Landing build did not produce ${distIndex}`);
  }

  const unexpectedEntries = fs.readdirSync(distDir).filter(
    (name) => name !== 'index.html' && name !== assetsDirName
  );
  if (unexpectedEntries.length > 0) {
    throw new Error(
      `Unexpected landing build output: ${unexpectedEntries.join(', ')}. ` +
      'Refusing to write unknown files into frontend/.'
    );
  }

  // Only generated landing files are ever removed from frontend/.
  fs.rmSync(outputAssetsDir, { recursive: true, force: true });
  fs.copyFileSync(distIndex, outputIndex);

  if (fs.existsSync(distAssetsDir)) {
    fs.cpSync(distAssetsDir, outputAssetsDir, { recursive: true });
  }

  console.log(`[Landing Build] Wrote ${outputIndex}`);
  console.log(`[Landing Build] Wrote ${outputAssetsDir}`);
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
  copyGeneratedOutput();
}

try {
  main();
} catch (error) {
  console.error(`[Landing Build] FAILED: ${error.message}`);
  process.exit(1);
}
