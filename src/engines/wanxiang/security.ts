/**
 * L8 security_suite — 七层纵深防御 + 文件沙箱
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeJson } from './types';
import type {
  RiskReport,
  RiskLevel,
  PiiHit,
  InjectionReport,
  SandboxViolation,
  Threat,
  ThreatReport,
  RedTeamReport,
  SecurityReport,
} from './types';

/** L0 深度扫描：文本五维风险评分 */
export async function securityScanText(text: string): Promise<RiskReport> {
  return invokeJson<RiskReport>('wx_security_scan_text', { text });
}

/** 风险等级判定：< 30 Low / < 60 Medium / < 85 High / ≥ 85 Critical */
export async function securityClassifyRisk(score: number): Promise<RiskLevel> {
  try {
    return await invoke<string>('wx_security_classify_risk', { score }) as RiskLevel;
  } catch (error) {
    console.error('[wanxiang] wx_security_classify_risk 调用失败:', error);
    throw error;
  }
}

/**
 * 路径规范化：解析 ./../ / 多余分隔符（纯字符串，不访问 FS）
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securitySandboxNormalizePath(path: string): Promise<string> {
  try {
    return await invoke<string>('wx_security_sandbox_normalize_path', { path });
  } catch (error) {
    console.error('[wanxiang] wx_security_sandbox_normalize_path 调用失败:', error);
    throw error;
  }
}

/** 路径遍历攻击检测：匹配 ../ / ..\ / %2e%2e 形态 */
export async function securitySandboxDetectTraversal(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_security_sandbox_detect_traversal', { path });
  } catch (error) {
    console.error('[wanxiang] wx_security_sandbox_detect_traversal 调用失败:', error);
    throw error;
  }
}

/** 创建文件沙箱实例，返回 sandbox_id */
export async function securitySandboxNew(): Promise<number> {
  try {
    return await invoke<number>('wx_security_sandbox_new');
  } catch (error) {
    console.error('[wanxiang] wx_security_sandbox_new 调用失败:', error);
    throw error;
  }
}

/**
 * 配置 agent 的读/写/拒绝白名单
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securitySandboxConfigure(
  sandboxId: number,
  agentId: string,
  allowRead: string[],
  allowWrite: string[],
  deny: string[]
): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_security_sandbox_configure', {
      sandboxId,
      agentId,
      allowReadJson: JSON.stringify(allowRead),
      allowWriteJson: JSON.stringify(allowWrite),
      denyJson: JSON.stringify(deny),
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_sandbox_configure 调用失败:', error);
    throw error;
  }
}

/**
 * 沙箱权限检查（mode: "read" / "write"）
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securitySandboxCheck(
  sandboxId: number,
  agentId: string,
  path: string,
  mode: string
): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_security_sandbox_check', { sandboxId, agentId, path, mode });
  } catch (error) {
    console.error('[wanxiang] wx_security_sandbox_check 调用失败:', error);
    throw error;
  }
}

/**
 * 列出 agent 的沙箱违规记录
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securitySandboxViolations(
  sandboxId: number,
  agentId: string
): Promise<SandboxViolation[]> {
  return invokeJson<SandboxViolation[]>('wx_security_sandbox_violations', { sandboxId, agentId });
}

/** PII 检测：扫描 5 类（phone/email/id_card/bank_card/ip） */
export async function securityPiiDetect(text: string): Promise<PiiHit[]> {
  return invokeJson<PiiHit[]>('wx_security_pii_detect', { text });
}

/** PII 脱敏：根据类型替换敏感内容 */
export async function securityPiiMask(text: string): Promise<string> {
  try {
    return await invoke<string>('wx_security_pii_mask', { text });
  } catch (error) {
    console.error('[wanxiang] wx_security_pii_mask 调用失败:', error);
    throw error;
  }
}

/**
 * k-匿名信息泄露量 I = -log2(k) bits
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityPrivacyInfoLeaked(k: number): Promise<number> {
  try {
    return await invoke<number>('wx_security_privacy_info_leaked', { k });
  } catch (error) {
    console.error('[wanxiang] wx_security_privacy_info_leaked 调用失败:', error);
    throw error;
  }
}

/**
 * 差分隐私 Laplace 加噪（确定性种子，可复现）
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityPrivacyDp(value: number, epsilon: number, seed: number): Promise<number> {
  try {
    return await invoke<number>('wx_security_privacy_dp', { value, epsilon, seed });
  } catch (error) {
    console.error('[wanxiang] wx_security_privacy_dp 调用失败:', error);
    throw error;
  }
}

/** CSP 注入检测：XSS / SQL / 命令 / Prompt 注入 */
export async function securityCspCheckInjection(text: string): Promise<InjectionReport> {
  return invokeJson<InjectionReport>('wx_security_csp_check_injection', { text });
}

/**
 * CSP 输出消毒：移除/替换危险模式
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityCspSanitize(text: string): Promise<string> {
  try {
    return await invoke<string>('wx_security_csp_sanitize', { text });
  } catch (error) {
    console.error('[wanxiang] wx_security_csp_sanitize 调用失败:', error);
    throw error;
  }
}

/** HTML 转义：< > & " ' → 实体 */
export async function securityCspEscapeHtml(text: string): Promise<string> {
  try {
    return await invoke<string>('wx_security_csp_escape_html', { text });
  } catch (error) {
    console.error('[wanxiang] wx_security_csp_escape_html 调用失败:', error);
    throw error;
  }
}

/**
 * CSP 阻断率 P_block = matched / total
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityCspBlockRate(matched: number, total: number): Promise<number> {
  try {
    return await invoke<number>('wx_security_csp_block_rate', { matched, total });
  } catch (error) {
    console.error('[wanxiang] wx_security_csp_block_rate 调用失败:', error);
    throw error;
  }
}

/**
 * 创建审计日志器，返回 audit_id
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityAuditNew(): Promise<number> {
  try {
    return await invoke<number>('wx_security_audit_new');
  } catch (error) {
    console.error('[wanxiang] wx_security_audit_new 调用失败:', error);
    throw error;
  }
}

/**
 * 记录一条审计日志（链式哈希 SHA256 防篡改），返回 entry id
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityAuditLog(
  auditId: number,
  agentId: string,
  action: string,
  args: string,
  result: string,
  riskLevel: string
): Promise<number> {
  try {
    return await invoke<number>('wx_security_audit_log', {
      auditId,
      agentId,
      action,
      args,
      result,
      riskLevel,
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_audit_log 调用失败:', error);
    throw error;
  }
}

/**
 * 审计日志完整性校验：重新计算链式哈希比对
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityAuditVerify(auditId: number): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_security_audit_verify', { auditId });
  } catch (error) {
    console.error('[wanxiang] wx_security_audit_verify 调用失败:', error);
    throw error;
  }
}

/**
 * 导出审计日志 JSON
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityAuditExport(auditId: number): Promise<string> {
  try {
    return await invoke<string>('wx_security_audit_export', { auditId });
  } catch (error) {
    console.error('[wanxiang] wx_security_audit_export 调用失败:', error);
    throw error;
  }
}

/**
 * 审计日志条目数
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityAuditLen(auditId: number): Promise<number> {
  try {
    return await invoke<number>('wx_security_audit_len', { auditId });
  } catch (error) {
    console.error('[wanxiang] wx_security_audit_len 调用失败:', error);
    throw error;
  }
}

/**
 * STRIDE 单一威胁 Risk = L × I
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityThreatRisk(likelihood: number, impact: number): Promise<number> {
  try {
    return await invoke<number>('wx_security_threat_risk', { likelihood, impact });
  } catch (error) {
    console.error('[wanxiang] wx_security_threat_risk 调用失败:', error);
    throw error;
  }
}

/**
 * 系统总风险 R_total = 1 - ∏(1 - Rᵢ)
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityThreatSystemRisk(risks: number[]): Promise<number> {
  try {
    return await invoke<number>('wx_security_threat_system_risk', {
      risksJson: JSON.stringify(risks),
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_threat_system_risk 调用失败:', error);
    throw error;
  }
}

/**
 * 默认 STRIDE 威胁表（6 类）
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityThreatDefault(): Promise<Threat[]> {
  return invokeJson<Threat[]>('wx_security_threat_default');
}

/**
 * 评估威胁列表，返回 ThreatReport（含 threats + total_risk）
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityThreatAssess(threats: Threat[]): Promise<ThreatReport> {
  return invokeJson<ThreatReport>('wx_security_threat_assess', {
    threatsJson: JSON.stringify(threats),
  });
}

/**
 * 纵深防御穿透概率 P_breach = ∏(1 - Pᵢ)
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityDefenseBreachProbability(detectionProbs: number[]): Promise<number> {
  try {
    return await invoke<number>('wx_security_defense_breach_probability', {
      detectionProbsJson: JSON.stringify(detectionProbs),
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_defense_breach_probability 调用失败:', error);
    throw error;
  }
}

/**
 * 纵深防御拦截概率 P_block = 1 - P_breach
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityDefenseBlockProbability(detectionProbs: number[]): Promise<number> {
  try {
    return await invoke<number>('wx_security_defense_block_probability', {
      detectionProbsJson: JSON.stringify(detectionProbs),
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_defense_block_probability 调用失败:', error);
    throw error;
  }
}

/**
 * 红队测试：执行 5 类攻击模拟
 * @internal 供 SecurityGuard 内部使用，也可被外部模块直接调用
 */
export async function securityRedTeamRun(): Promise<RedTeamReport> {
  return invokeJson<RedTeamReport>('wx_security_red_team_run');
}

/**
 * 创建 SecurityGuard 统一守卫实例（组合七层），返回 guard_id
 * 这是安全模块的统一入口，组合所有安全层进行全链路检查
 */
export async function securityGuardNew(): Promise<number> {
  try {
    return await invoke<number>('wx_security_guard_new');
  } catch (error) {
    console.error('[wanxiang] wx_security_guard_new 调用失败:', error);
    throw error;
  }
}

/**
 * 为 guard 内的沙箱配置 agent 白名单
 * 这是安全模块的统一入口，组合所有安全层进行全链路检查
 */
export async function securityGuardConfigureAgent(
  guardId: number,
  agentId: string,
  allowRead: string[],
  allowWrite: string[],
  deny: string[]
): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_security_guard_configure_agent', {
      guardId,
      agentId,
      allowReadJson: JSON.stringify(allowRead),
      allowWriteJson: JSON.stringify(allowWrite),
      denyJson: JSON.stringify(deny),
    });
  } catch (error) {
    console.error('[wanxiang] wx_security_guard_configure_agent 调用失败:', error);
    throw error;
  }
}

/**
 * SecurityGuard 全链路检查：扫描 → 沙箱 → 隐私 → CSP → 审计
 * 这是安全模块的统一入口，组合所有安全层进行全链路检查
 */
export async function securityGuardCheckAction(
  guardId: number,
  agentId: string,
  path: string,
  mode: string,
  content: string
): Promise<SecurityReport> {
  return invokeJson<SecurityReport>('wx_security_guard_check_action', {
    guardId,
    agentId,
    path,
    mode,
    content,
  });
}
