/** 量化：不同篇幅下 saveNovels 写入 localStorage 的载荷大小（UTF-8 字节） */
const enc = new TextEncoder();

function buildNovel(chapterCount: number, charsPerChapter: number) {
  const chapters = [];
  for (let i = 0; i < chapterCount; i++) {
    chapters.push({
      id: `ch-${i}`,
      title: `第${i + 1}章 测试章节标题`,
      content: '这是一段用于压力测试的中文正文内容，包含标点与对话。'.repeat(
        Math.ceil(charsPerChapter / 25),
      ),
      updatedAt: new Date().toISOString(),
      wordCount: charsPerChapter,
    });
  }
  return [
    {
      id: 'novel-1',
      title: '压力测试作品',
      type: 'xianxia',
      volumes: [{ id: 'vol-1', title: '第一卷', chapters }],
      updatedAt: new Date().toISOString(),
    },
  ];
}

const LIMIT_MB = 5; // 浏览器 localStorage 常见配额（保守）
const cases: Array<[string, number, number]> = [
  ['10 万字 (20章×5000)', 20, 5000],
  ['50 万字 (100章×5000)', 100, 5000],
  ['100 万字 (200章×5000)', 200, 5000],
  ['200 万字 (400章×5000)', 400, 5000],
];

console.log('\n=== saveNovels 载荷大小 vs localStorage 配额（' + LIMIT_MB + 'MB 保守估计）===\n');
console.log('篇幅'.padEnd(24) + 'JSON 大小'.padEnd(14) + '占配额'.padEnd(10) + '判定');
console.log('-'.repeat(70));

for (const [label, chCount, chars] of cases) {
  const payload = JSON.stringify(buildNovel(chCount, chars));
  const bytes = enc.encode(payload).length;
  const mb = bytes / 1024 / 1024;
  const pct = (mb / LIMIT_MB) * 100;
  const verdict = mb > LIMIT_MB ? '❌ 超出配额 → setItem 抛错' : pct > 70 ? '⚠️ 逼近上限' : '✅ 可容纳';
  console.log(
    label.padEnd(22) + (mb.toFixed(2) + ' MB').padEnd(14) + (pct.toFixed(0) + '%').padEnd(10) + verdict,
  );
}
console.log('');
