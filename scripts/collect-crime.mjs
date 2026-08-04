// 警視庁の町丁字別犯罪情報（令和6年）を新宿区分だけ抽出してD1へ投入する。
// 出典: 警視庁 町丁字別犯罪情報 令和6年分（累計値）
// URL: https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.files/R6.csv
// 使い方: npm run collect:crime
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CRIME_CSV =
  'https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.files/R6.csv';

async function main() {
  const res = await fetch(CRIME_CSV, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('shift_jis').decode(buf);
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const header = lines[0].split(',');
  console.log('列:', header.map((h, i) => `${i}:${h}`).slice(0, 6).join(' | '));

  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (!cols[0].startsWith('新宿区')) continue;
    rows.push(cols);
  }
  console.log(`新宿区の犯罪データ: ${rows.length} 町丁目（サンプル: ${rows[0]?.[0]}, ${rows[0]?.[1]}件）`);

  const townName = (s) => s.replace(/^新宿区/, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const sqlLines = ['DELETE FROM crime_stats;'];
  for (const cols of rows) {
    const town = townName(cols[0]).replace(/丁目$/, '丁目');
    const total = Number(cols[1]) || 0; // 総合計
    const esc = town.replace(/'/g, "''");
    sqlLines.push(
      `INSERT OR REPLACE INTO crime_stats (town, total_crimes, source_year) VALUES ('${esc}', ${total}, 2024);`,
    );
  }
  const tmp = '/tmp/opencode/crime.sql';
  writeFileSync(tmp, sqlLines.join('\n'));
  console.log(`犯罪SQL: ${sqlLines.length - 1} 件をD1へ投入`);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'odh-db', '--remote', `--file=${tmp}`], {
    stdio: 'inherit',
  });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
