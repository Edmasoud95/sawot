// Unprivileged launcher: only the installed systemd service runs verification.
import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const defaultSocket = '/run/sawot-runner/runner.sock';

export async function waitForApp({ pid, probe, alive = () => {
  try { process.kill(pid, 0); return true; } catch { return false; }
}, attempts = 120, pause = () => new Promise(resolve => setTimeout(resolve, 500)) }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!alive()) return false;
    if (await probe()) return alive();
    await pause();
  }
  return false;
}

function appReady({ host, port, tls }) {
  return new Promise(resolve => {
    const request = (tls ? https : http).get({ host, port, path: '/health',
      // This local readiness probe accepts the app's self-signed LAN certificate.
      rejectUnauthorized: false,
    }, response => { response.resume(); resolve(response.statusCode === 200); });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

export function runnerReady(socket) {
  return new Promise(resolve => {
    const request = http.get({ socketPath: socket, path: '/v1/ready' }, response => {
      let body = '';
      response.on('error', () => resolve(false));
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          resolve(response.statusCode === 200 && value.ready === true && value.runtime === 'runsc'
            && value.inputPaths === 'stable-v1' && /^sha256:[0-9a-f]{64}$/.test(value.imageDigest));
        } catch { resolve(false); }
      });
    });
    request.setTimeout(2000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

export async function ensureRunner({ socket, ready = () => runnerReady(socket),
  active = () => spawnSync('systemctl', ['is-active', '--quiet', 'sawot-runner.service']).status === 0,
  start = () => {
    const command = process.getuid?.() === 0 ? 'systemctl' : 'sudo';
    const args = command === 'sudo'
      ? [...(process.stdin.isTTY ? [] : ['-n']), 'systemctl', 'start', 'sawot-runner.service']
      : ['start', 'sawot-runner.service'];
    return spawnSync(command, args, { stdio: 'inherit' }).status === 0;
  },
  waitReady = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await ready()) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }, log = console.log,
}) {
  if (!socket || await ready()) return;
  if (socket !== defaultSocket) {
    log('Code execution unavailable: start the runner configured for your custom socket. SAWOT will continue.');
    return;
  }
  if (active()) {
    log('Code execution unavailable: the running sandbox is not ready. Check sudo journalctl -u sawot-runner.service. SAWOT will continue.');
    return;
  }
  log('Starting the code execution sandbox. Isolation checks may take about 45 seconds after reboot or updates.');
  if (!start() || !await waitReady()) {
    log('Code execution unavailable: sandbox startup or verification failed. Check sudo journalctl -u sawot-runner.service. SAWOT will continue.');
    return;
  }
  log('Code execution sandbox ready.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(new URL('../ts-backend/package.json', import.meta.url));
  require('dotenv').config({ path: '.env', quiet: true });
  const socket = process.env.SAWOT_RUNNER_SOCKET;
  let appStarted = true;
  if (socket && process.argv[2] === '--wait-for-app') {
    const pid = Number(process.argv[3]);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid backend PID');
    const config = existsSync('config.yaml') ? require('yaml').parse(readFileSync('config.yaml', 'utf8')) ?? {} : {};
    const configuredHost = process.env.SERVER_HOST || config.server?.host || '127.0.0.1';
    const host = ['0.0.0.0', '::'].includes(configuredHost) ? '127.0.0.1' : configuredHost;
    const port = Number(process.env.SERVER_PORT || config.server?.port || 8765);
    const tls = Boolean((process.env.TLS_CERTFILE || config.tls?.certfile) && (process.env.TLS_KEYFILE || config.tls?.keyfile));
    appStarted = await waitForApp({ pid, probe: () => appReady({ host, port, tls }) });
    if (!appStarted) console.log('Sandbox startup skipped: the app did not become ready.');
  }
  if (appStarted) await ensureRunner({ socket });
}
