import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lockPath = resolve(root, 'data', 'voidlark.lock');
const pid = Number(existsSync(lockPath) ? readFileSync(lockPath, 'utf8').trim() : 0);

const run = (file, args) => new Promise((resolveRun, reject) => {
  execFile(file, args, { windowsHide: true }, (error, stdout) => error ? reject(error) : resolveRun(stdout));
});

if (pid > 0 && pid !== process.pid) {
  try {
    const processInfo = async processId => JSON.parse(String(await run('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress` ])));
    const current = await processInfo(pid);
    if (String(current.CommandLine).toLowerCase().includes(root.toLowerCase()) && current.CommandLine.includes('src/index.ts')) {
      let rootPid = pid;
      let parentPid = current.ParentProcessId;
      while (parentPid > 0) {
        const parent = await processInfo(parentPid).catch(() => null);
        if (!parent || !String(parent.CommandLine).toLowerCase().includes(root.toLowerCase())) break;
        rootPid = parent.ProcessId;
        parentPid = parent.ParentProcessId;
      }
      await run('taskkill.exe', ['/PID', String(rootPid), '/T', '/F']);
      for (let i = 0; i < 40 && existsSync(lockPath); i += 1) await new Promise(r => setTimeout(r, 250));
    } else {
      console.error(`Lock PID ${pid} bukan proses Voidlark workspace. Hentikan manual jika memang aman.`);
      process.exit(1);
    }
  } catch {
    // No live process: instance-lock will remove stale file on next start.
  }
}

const child = spawn('npm.cmd', ['run', 'dev'], { cwd: root, stdio: 'inherit', windowsHide: false });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
