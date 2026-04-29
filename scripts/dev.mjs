import { spawn } from 'node:child_process';

const workspaces = [
  '@notes/web',
  '@notes/user-service',
  '@notes/document-service',
  '@notes/collab-service',
  '@notes/sync-service'
];

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const workspace of workspaces) {
  const child = spawn(npmCommand, ['run', 'dev', '--workspace', workspace], {
    stdio: 'inherit',
    env: process.env
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (!shuttingDown && code !== 0) {
      console.error(`${workspace} dev process exited with ${signal ?? code}`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
