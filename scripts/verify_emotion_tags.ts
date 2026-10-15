import { extractEmotionTags } from '../src/engines/wanxiang/emotionTags';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

// 1) 强烈情感文本：应检出 悲 + 惧，PAD 的 valence 为负
const angry = '他怒火中烧，咬牙切齿，眼中满是恐惧与绝望，泪水滑落。';
const r1 = extractEmotionTags(angry);
console.log('sample1 ->', JSON.stringify(r1));
assert(r1.tags.length > 0, '应检出情感标签');
assert(r1.tags.includes('悲') || r1.tags.includes('惧'), '应含悲或惧');
assert(r1.pad[0] < 0, 'valence 应为负（含悲/惧）');

// 2) 欢快文本：应检出 喜，valence 为正
const happy = '她欢喜地笑了，眉开眼笑，心里满是欢喜与眷恋。';
const r2 = extractEmotionTags(happy);
console.log('sample2 ->', JSON.stringify(r2));
assert(r2.tags.includes('喜'), '应含 喜');
assert(r2.pad[0] > 0, 'valence 应为正（含喜）');

// 3) 无情感文本：返回空标签、零向量（NMM 走纯向量衰减）
const neutral = '桌上有三本书，窗外下着雨，时间缓缓流逝。';
const r3 = extractEmotionTags(neutral);
console.log('sample3 ->', JSON.stringify(r3));
assert(r3.tags.length === 0, '无情感应返回空标签');
assert(JSON.stringify(r3.pad) === '[0,0,0]', '无情感 pad 应为 [0,0,0]');

// 4) 空输入不崩
const r4 = extractEmotionTags('');
assert(r4.tags.length === 0, '空输入安全');

console.log('\\nALL EMOTION-TAG CHECKS PASSED');
