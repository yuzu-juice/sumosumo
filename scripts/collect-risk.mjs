// 東京都の地震地域危険度（町丁目別）を新宿区分だけ抽出してD1へ投入する。
// 出典: 東京都都市整備局 地震に関する地域危険度測定調査（第9回）
// URL: https://www.toshiseibi.metro.tokyo.lg.jp/bosai/chousa_6/download/all2.csv
// 使い方: npm run collect:risk
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RISK_CSV = 'https://www.toshiseibi.metro.tokyo.lg.jp/bosai/chousa_6/download/all2.csv?2209=';

async function main() {
  const res = await fetch(RISK_CSV, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('shift_jis').decode(buf);
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const header = lines[0].split(',');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols[0] !== '新宿区') continue;
    rows.push(cols);
  }
  console.log(`新宿区の危険度データ: ${rows.length} 町丁目`);

  // 列インデックスを確認
  console.log('列:', header.map((h, i) => `${i}:${h}`).slice(0, 14).join(' | '));

  // SQL生成: 新宿区の町丁目別危険度ランク
  const townName = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const sqlLines = ['DELETE FROM risk_levels;'];
  for (const cols of rows) {
    const town = townName(cols[1]).replace(/丁目$/, '丁目');
    const collapse = Number(cols[5]);
    const fire = Number(cols[8]);
    const total = Number(cols[12]);
    if (!Number.isFinite(collapse) || !Number.isFinite(fire) || !Number.isFinite(total)) continue;
    const esc = town.replace(/'/g, "''");
    sqlLines.push(
      `INSERT OR REPLACE INTO risk_levels (town, collapse_rank, fire_rank, total_rank) VALUES ('${esc}', ${collapse}, ${fire}, ${total});`,
    );
  }
  const tmp = '/tmp/opencode/risk.sql';
  writeFileSync(tmp, sqlLines.join('\n'));
  console.log(`危険度SQL: ${sqlLines.length - 1} 件をD1へ投入`);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'odh-db', '--remote', `--file=${tmp}`], {
    stdio: 'inherit',
  });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
