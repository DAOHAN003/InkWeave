/**
 * 确定性 SDR（稀疏分布表示）编码器 —— 前端版
 *
 * 与 wanxiang_engines/memory_core/src/nmm.rs 的 SdrEncoder 保持「编码单元同源」：
 *   sha256(text) → u64 seed → 确定性 shuffle(0..dim) → 前 active_bits 个位置 1
 * 相同文本始终产生相同向量（跨刷新/跨进程可复现），契合确定性铁律。
 *
 * 但本模块用于「短文本检索」而非「记忆去重」，因此额外提供词袋聚合
 * （token-level OR）：把文本的多个 token 的 SDR 按位取并，使「共享词」产生重叠。
 * 这补足了纯关键词匹配的语义盲区（如「写正文」↔「续写」文字不同但共享概念），
 * 而 NMM 原版整文 SDR 因雪崩效应对 paraphrase 不敏感，不适合直接做检索。
 *
 * 注：Rust 端用 StdRng(ChaCha)，此处用 mulberry32 Fisher-Yates；shuffle 序列不同，
 * 但前端闭环只需「内部确定性」（不跨语言比对向量），不影响检索一致性。
 */

const DIM = 2048;
const ACTIVE_BITS = 41;

const ror = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

// SHA-256 第一轮常量
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0xc4ac5665, 0x42922444, 0x2fce8cd5, 0x266e31cc, 0x9e2f098d, 0x5940e1db,
  0x36c5f72f, 0x596f9c30, 0xa1f4df3b, 0x92328e0b, 0xbf597fc7, 0x81ca6ab4, 0xbfc1e556, 0x2862c532,
  0x1462b108, 0x5163abf0, 0xf8d1a2a3, 0x29b7c0e2, 0xa8837f60, 0x2f3f1c4b, 0x65511d9d, 0x8f3d3c95,
  0xff2fe510, 0xc9c73915, 0xbef90dae, 0xe9b5dba5, 0x3da88a4d, 0x2ff4ade0, 0x9abfdbcb, 0x429f44c9,
  0x2f1e1a4f, 0x6ab73b98, 0xab188b6b, 0xba91b5c3, 0xcc1b1c0c, 0xe19be39c, 0x3cde57d9, 0x4f3c7ce8,
  0x596f9c30, 0xa1f4df3b, 0x92328e0b, 0xbf597fc7, 0x81ca6ab4, 0xbfc1e556, 0x2862c532, 0x53380d13,
]);

/** 同步 SHA-256（纯 JS，RFC 6234），输入 UTF-8 字符串，返回 32 字节。 */
function syncSha256Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      const c2 = text.charCodeAt(i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const bitLen = len * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  const w = new Uint32Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[off + i * 4] << 24) |
          (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) |
          bytes[off + i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整文 SDR（与 NMM 同源编码单元）：sha256 → u64 → 确定性 shuffle → 前 active_bits 位置 1。 */
export function sdrEncode(text: string, dim = DIM, activeBits = ACTIVE_BITS): Float32Array {
  const bytes = syncSha256Bytes(text);
  const seed = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  const rand = mulberry32(seed);
  const idx: number[] = [];
  for (let i = 0; i < dim; i++) idx.push(i);
  for (let i = dim - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  const vec = new Float32Array(dim);
  for (let k = 0; k < activeBits; k++) vec[idx[k]] = 1;
  return vec;
}

const tokenizeText = (text: string): string[] =>
  Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[一-龥]{2,}|[a-z0-9_-]{2,}/g) || [],
    ),
  );

/**
 * 词袋 SDR：分词 → 每个 token 整文编码 → 按位 OR 聚合。
 * 共享词越多，向量重叠越高，用于语义补全关键词匹配盲区。
 */
export function sdrEncodeBag(text: string, dim = DIM, activeBits = ACTIVE_BITS): Float32Array {
  const tokens = tokenizeText(text);
  if (tokens.length === 0) return sdrEncode(text, dim, activeBits);
  const vec = new Float32Array(dim);
  for (const tk of tokens) {
    const tvec = sdrEncode(tk, dim, activeBits);
    for (let i = 0; i < dim; i++) if (tvec[i] > 0) vec[i] = 1;
  }
  return vec;
}

/** SDR 重叠度（归一化到 [0,1]）：共享激活位 / active_bits。 */
export function sdrSimilarity(a: Float32Array, b: Float32Array, activeBits = ACTIVE_BITS): number {
  let overlap = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) overlap += a[i] * b[i];
  return Math.min(1, overlap / activeBits);
}

const skillVecCache = new Map<string, Float32Array>();
const SKILL_VEC_CACHE_MAX = 100;

/** 编码一个 skill 用于检索（按 id 缓存，内容不变则向量不变）。 */
export function encodeSkillBag(skill: {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
}): Float32Array {
  const cached = skillVecCache.get(skill.id);
  if (cached) return cached;
  const text = `${skill.name} ${skill.description} ${skill.triggers.join(' ')} ${skill.instructions}`;
  const vec = sdrEncodeBag(text);
  // LRU-like eviction: remove oldest entry when cache is full
  if (skillVecCache.size >= SKILL_VEC_CACHE_MAX) {
    const firstKey = skillVecCache.keys().next().value;
    if (firstKey) skillVecCache.delete(firstKey);
  }
  skillVecCache.set(skill.id, vec);
  return vec;
}

/** 清除 skill 向量缓存（skill 内容更新后调用）。 */
export function clearSkillVecCache(): void {
  skillVecCache.clear();
}
