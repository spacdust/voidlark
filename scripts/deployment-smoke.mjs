const baseUrl = (process.env.VOIDLARK_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const checks = ['/health/live', '/health', '/metrics'];
let failed = false;
for (const path of checks) {
  try {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();
    if (!response.ok && path !== '/health') throw new Error(`${response.status}`);
    if (!body) throw new Error('empty response');
    console.log(`${response.ok ? 'ok' : 'degraded'} ${path} ${response.status}`);
  } catch (error) {
    failed = true;
    console.error(`fail ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) process.exitCode = 1;
