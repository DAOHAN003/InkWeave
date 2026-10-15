#!/usr/bin/env node
/**
 * verify_constrained.mjs — llama-server 约束解码（structured output）真机首验脚本
 *
 * 背景：V5.8.0 起 request 层接入 jsonSchema（按后端翻译 response_format / format +
 * 4xx 剥离重试 + 会话级能力记忆）。本脚本绕开应用层，直接对 llama-server 的
 * OpenAI 兼容端点发一次带 json_schema 的请求，验证服务端真的在做约束解码。
 *
 * 用法（在用户真机、llama-server 已启动的前提下）：
 *   node scripts/verify_constrained.mjs                          # 默认 http://127.0.0.1:8080
 *   node scripts/verify_constrained.mjs http://127.0.0.1:1234    # LM Studio 端口
 *   BASE=http://127.0.0.1:11434 node scripts/verify_constrained.mjs   # Ollama 兼容端点
 *
 * 判定：
 *   [PASS] 返回内容为合法 JSON 且逐字段符合 schema → 服务端约束解码生效
 *   [WARN] 返回内容经宽松修复才合法 → 端点接受了 schema 但未真正约束（需靠前端宽松提取兜底）
 *   [FAIL] 4xx / 5xx / 非法 JSON → 端点不支持（前端会自动降级为裸调用，不阻塞写作）
 */

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '');

async function main() {
  console.log(`=== llama-server 约束解码首验 @ ${BASE} ===\n`);

  // 1) 探活 + 取模型名
  let model = 'local';
  try {
    const r = await fetch(`${BASE}/v1/models`);
    if (r.ok) {
      const j = await r.json();
      model = j?.data?.[0]?.id || model;
      console.log(`[1] 端点可达，model = ${model}`);
    } else {
      console.log(`[1] /v1/models 返回 ${r.status}，继续用默认 model 名尝试`);
    }
  } catch (e) {
    console.error(`[1] 端点不可达：${e.message}\n    请确认 llama-server 已启动且端口正确。`);
    process.exit(2);
  }

  // 2) 发带 json_schema 的请求（与前端 request 层同形：response_format → json_schema）
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '一个中文人名' },
      age: { type: 'integer', description: '年龄' },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 4, description: '两个标签' },
    },
    required: ['name', 'age', 'tags'],
    additionalProperties: false,
  };
  const body = {
    model,
    messages: [
      { role: 'system', content: '你是一个档案生成器，只输出 JSON。' },
      { role: 'user', content: '生成一条角色档案：一个会剑术的青年侠客。' },
    ],
    max_tokens: 512,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'profile', strict: true, schema } },
  };

  let res;
  try {
    res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`[2] 请求失败：${e.message}`);
    process.exit(2);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[FAIL] ${res.status} ${res.statusText}\n${text.slice(0, 400)}\n    → 端点不支持 json_schema（前端会自动剥 schema 降级，功能不受影响，但拿不到约束解码收益）。`);
    process.exit(1);
  }

  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content ?? '';
  console.log(`[2] 响应内容（前 200 字）：${content.slice(0, 200)}`);

  // 3) 判定：严格 JSON.parse → PASS；需要宽松修复 → WARN；全失败 → FAIL
  let parsed = null;
  let strict = false;
  try {
    parsed = JSON.parse(content);
    strict = true;
  } catch {
    /* 落到宽松提取 */
  }
  if (!parsed) {
    // 宽松提取（与前端 extractJsonLoose 同思路：截 { } / [ ]）
    const a = content.indexOf('{');
    const b = content.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { parsed = JSON.parse(content.slice(a, b + 1)); } catch { parsed = null; }
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    console.error('[FAIL] 返回内容连宽松提取都无法解析为对象。');
    process.exit(1);
  }

  const okShape =
    typeof parsed.name === 'string' &&
    Number.isInteger(parsed.age) &&
    Array.isArray(parsed.tags) &&
    parsed.tags.every((t) => typeof t === 'string');
  const extraKeys = Object.keys(parsed).filter((k) => !['name', 'age', 'tags'].includes(k));

  if (strict && okShape && extraKeys.length === 0) {
    console.log('\n[PASS] 约束解码生效：严格 JSON + 形状逐字段符合 + 无越权字段。');
    console.log('       前端 chatStructured 在此端点将走 constrained=true 快速路径。');
    process.exit(0);
  }
  if (okShape) {
    console.log('\n[WARN] 形状正确但存在宽松修复空间（严格解析失败或字段越权）：');
    if (!strict) console.log('       - 内容非纯 JSON（可能带解释文字/围栏），前端靠宽松提取兜底');
    if (extraKeys.length) console.log(`       - 越权字段：${extraKeys.join(', ')}（schema additionalProperties:false 未被强制）`);
    console.log('       → 端点接受了 schema 参数但未真正约束解码，收益打折；功能仍可用。');
    process.exit(0);
  }
  console.error('\n[FAIL] 返回对象与 schema 形状不符，约束解码未生效。');
  process.exit(1);
}

main();
