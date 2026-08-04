// 新宿区の標高タイル（国土地理院 標高タイル dem_png, z14）をR2へ収集する。
// 坂道・上り坂情報の算出に使用。実行時はR2から自前配信。
// 出典: 国土地理院 https://maps.gsi.go.jp/development/ichiran.html
// 使い方: npm run collect:elev
import { execFile } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const X_RANGE = [14548, 14552];
const Y_RANGE = [6448, 6452];
const Z = 14;

async function fetchTile(x, y) {
  const url = `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${Z}/${x}/${y}.png`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'odh-tokyo-qol/0.1 (open data hackathon)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function main() {
  const tmpDir = '/tmp/opencode/elev';
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpDir, { recursive: true });

  const jobs = [];
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x++) {
    for (let y = Y_RANGE[0]; y <= Y_RANGE[1]; y++) {
      jobs.push({ x, y });
    }
  }
  console.log(`標高タイル ${jobs.length} 枚を取得`);
  for (const { x, y } of jobs) {
    const buf = await fetchTile(x, y);
    writeFileSync(join(tmpDir, `${x}-${y}.png`), buf);
  }

  let idx = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (idx < jobs.length) {
      const { x, y } = jobs[idx++];
      const file = join(tmpDir, `${x}-${y}.png`);
      await new Promise((resolve, reject) => {
        execFile('npx', ['wrangler', 'r2', 'object', 'put', `odh-raw/elev/${Z}/${x}/${y}.png`, '--file', file, '--remote', '--content-type', 'image/png'], { stdio: 'inherit' }, (err) => (err ? reject(err) : resolve()));
      });
    }
  });
  await Promise.all(workers);
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
