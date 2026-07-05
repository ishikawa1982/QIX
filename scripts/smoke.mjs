// End-to-end smoke test: drives the built app in Chromium to verify solo play
// and 2-player online multiplayer against the real server.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const serverEntry = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));

function startServer() {
  const proc = spawn('node', [serverEntry], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
  return proc;
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
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

async function testSolo(browser) {
  console.log('SOLO');
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
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

  await host.goto(BASE);
  await host.getByText('はじめる').click();
  await host.locator('.field').fill('HOST');
  await host.getByText('オンライン対戦（最大4人）').click();
  await host.getByText('ルームを作る').click();
  await host.waitForSelector('.roomcode');
  const code = (await host.locator('.roomcode').innerText()).trim();
  check(`room code created: ${code}`, code.length === 4);

  await guest.goto(BASE);
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
  const server = startServer();
  try {
    await waitForServer();
    const browser = await launch();
    await testSolo(browser);
    await testMultiplayer(browser);
    await browser.close();
  } finally {
    server.kill();
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
