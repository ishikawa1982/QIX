// End-to-end smoke test: drives the built app in Chromium to verify solo play
// and 2-player online multiplayer against the real server.
//
// Two topologies (env MODE):
//   single (default) — the Node server serves both the client and /ws.
//   pages            — client served by `vite preview` under a subpath
//                      (like GitHub Pages), multiplayer over a cross-origin WS
//                      to the Node server (like Render). Built beforehand with
//                      PAGES_BASE + VITE_WS_URL matching PORT.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODE = process.env.MODE ?? 'single';
const PORT = Number(process.env.PORT ?? 8791);
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const BASE_PATH = process.env.PAGES_BASE ?? '/';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SERVER_ORIGIN = `http://localhost:${PORT}`;
const PAGE_URL =
  MODE === 'pages' ? `http://localhost:${PREVIEW_PORT}${BASE_PATH}` : `${SERVER_ORIGIN}/`;

const serverEntry = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));
const clientDir = fileURLToPath(new URL('../client', import.meta.url));

function startServer() {
  return spawn('node', [serverEntry], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
}

function startPreview() {
  return spawn(
    'npm',
    ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: clientDir, env: { ...process.env, PAGES_BASE: BASE_PATH }, stdio: 'inherit' },
  );
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, executablePath: EXEC });
  }
}

async function readTopPercent(page) {
  const txt = await page.locator('.hud-pct').first().innerText();
  return parseFloat(txt.replace('%', '')) || 0;
}

async function pressFor(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function drawBox(page) {
  // Quickly carve a small box in the top-left corner (away from the enemy)
  // and close it back onto the top border. Fast so the enemy rarely hits it.
  await pressFor(page, 'ArrowDown', 350);
  await pressFor(page, 'ArrowRight', 500);
  await pressFor(page, 'ArrowUp', 450);
}

async function claimSome(page, readPercent) {
  // Retry a few times: the enemy may erase a line mid-draw.
  for (let attempt = 0; attempt < 5; attempt++) {
    await drawBox(page);
    await page.waitForTimeout(300);
    if ((await readPercent()) > 0) return true;
  }
  return false;
}

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures++;
  }
}

async function testPagesAssets() {
  console.log('PAGES ASSETS');
  for (const rel of ['manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon.svg']) {
    const res = await fetch(`${PAGE_URL}${rel}`);
    check(`${BASE_PATH}${rel} -> ${res.status}`, res.status === 200);
  }
}

async function testSolo(browser) {
  console.log('SOLO');
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE_URL);
  await page.getByText('はじめる').click();
  await page.getByText('1人で遊ぶ（ソロ）').click();
  await page.waitForSelector('canvas');
  const box = await page.locator('canvas').boundingBox();
  check('canvas has size', !!box && box.width > 50 && box.height > 50);
  const claimed = await claimSome(page, () => readTopPercent(page));
  const pct = await readTopPercent(page);
  check(`claimed territory (>0%): got ${pct.toFixed(1)}%`, claimed && pct > 0);
  check('no page errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await page.close();
}

async function testMultiplayer(browser) {
  console.log('MULTIPLAYER');
  const host = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const guest = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  host.on('pageerror', (e) => errs.push('host: ' + e.message));
  guest.on('pageerror', (e) => errs.push('guest: ' + e.message));

  await host.goto(PAGE_URL);
  await host.getByText('はじめる').click();
  await host.locator('.field').fill('HOST');
  await host.getByText('オンライン対戦（最大4人）').click();
  await host.getByText('ルームを作る').click();
  await host.waitForSelector('.roomcode');
  const code = (await host.locator('.roomcode').innerText()).trim();
  check(`room code created: ${code}`, code.length === 4);

  await guest.goto(PAGE_URL);
  await guest.getByText('はじめる').click();
  await guest.locator('.field').fill('GUEST');
  await guest.getByText('オンライン対戦（最大4人）').click();
  await guest.locator('.field.code').fill(code);
  await guest.getByText('コードで参加').click();
  await guest.waitForSelector('.roomcode');

  // Host should now see 2 players in the lobby.
  await host.waitForTimeout(500);
  const lobbyCount = await host.locator('.playeritem').count();
  check(`host lobby shows 2 players: ${lobbyCount}`, lobbyCount === 2);

  await host.getByText('ゲーム開始').click();
  await host.waitForSelector('canvas');
  await guest.waitForSelector('canvas');
  check('both clients in game', true);

  // Host draws a box; guest should receive the claim via the server.
  const readGuestMax = async () => {
    const bars = await guest.locator('.hud-pct').allInnerTexts();
    return Math.max(0, ...bars.map((t) => parseFloat(t) || 0));
  };
  const synced = await claimSome(host, readGuestMax);
  const maxPct = await readGuestMax();
  check(`guest sees host's claim synced (>0%): ${maxPct.toFixed(1)}%`, synced && maxPct > 0);
  check('no page errors', errs.length === 0);
  if (errs.length) console.error(errs);

  await host.close();
  await guest.close();
}

async function main() {
  console.log(`MODE=${MODE}  page=${PAGE_URL}  ws-server=${SERVER_ORIGIN}`);
  const server = startServer();
  const preview = MODE === 'pages' ? startPreview() : null;
  try {
    await waitFor(`${SERVER_ORIGIN}/healthz`);
    if (preview) await waitFor(PAGE_URL);
    if (MODE === 'pages') await testPagesAssets();
    const browser = await launch();
    await testSolo(browser);
    await testMultiplayer(browser);
    await browser.close();
  } finally {
    server.kill();
    preview?.kill();
  }
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
