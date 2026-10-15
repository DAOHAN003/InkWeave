/**
 * localStorage 键名统一管理
 * 所有 localStorage 键名必须在此定义，禁止在代码中硬编码
 */

// 小说数据相关
export const STORAGE_KEYS = {
  // 核心数据
  NOVEL_DATA: 'inkpire_data',

  // UI 设置
  // V5.7.1 文风红线 + 一致性检查阈值（GuardThresholdsPanel 持久化）
  GUARD_THRESHOLDS: 'guard_thresholds',

  // AI 配置
  AI_BASE_URL: 'ai_base_url',
  AI_KEY: 'ai_key',
  AI_MODEL: 'ai_model',
  AI_TEMPERATURE: 'ai_temperature',
  AI_TOP_P: 'ai_top_p',
  AI_MAX_TOKENS: 'ai_max_tokens',
  AI_SYSTEM_PROMPT: 'ai_system_prompt',

  // 本地模型高级参数（改造 P0：后端类型 + 采样器透传）
  AI_BACKEND_KIND: 'ai_backend_kind',
  AI_LOCAL_PARAMS: 'ai_local_params',

  // 语义嵌入（RAG 前情召回）：bge-m3 等，经 OpenAI 兼容 /v1/embeddings 调用
  // 未配置时 RAG 自动回退到内置离线词向量（256 维，确定性、零网络）
  EMBED_BASE_URL: 'embed_base_url',
  EMBED_API_KEY: 'embed_api_key',
  EMBED_MODEL: 'embed_model',

  // 多角色异构编排（改造 P1）：每个写作角色可配独立模型 endpoint
  AI_ROLE_MODELS: 'ai_role_models',

  // 经验库回流（改造 P2）：质量门判定结果持久化，用于 bias skill 选择
  LOCAL_SKILL_FEEDBACK: 'local_skill_feedback',

  // 翻译模型配置
  TRANSLATE_BASE_URL: 'translate_base_url',
  TRANSLATE_KEY: 'translate_key',
  TRANSLATE_MODEL: 'translate_model',

  // 图像生成（R4 AI 插图，V7.1.0）：base/model/size 三键；key 走凭据库（ai.image）
  IMAGE_BASE_URL: 'image_base_url',
  IMAGE_API_KEY: 'image_api_key',
  IMAGE_MODEL: 'image_model',
  IMAGE_SIZE: 'image_size',

  // 建议配置

  // 建议数据

  // AI 检测配置

  // Agent
  LOCAL_SKILLS: 'inkpire_local_skills_v1',

  // 翻译面板

  // 可复现性（种子 / 测试模式）

  // App.tsx 中历史字面量（S3 收口，键值字符串保持不变）
  // 注意：APP_WRITING_MODE ('app_writing_mode') 与 WRITING_MODE ('inkpire_writing_mode')
  // 是历史遗留的两个不同键，不要混用。

  // 万象引擎状态持久化（伏笔/角色锁定/故事状态）
  WANXIANG_STATE_PREFIX: 'wanxiang_state_',

  // 数据备份（商业化：自动快照 + 手动备份 + 恢复，滚动保留）
  BACKUP_INDEX: 'fuxiloom.backup.index',
  BACKUP_PREFIX: 'fuxiloom.backup.',

  // 写作历史（商业化：每日总字数记录，趋势看板数据源；按 novelId 分 key）
  WRITING_HISTORY_PREFIX: 'fuxiloom.writing_history.',

  // 首启引导（商业化 onboarding，已见即不再弹）
  WELCOME_SEEN: 'fuxiloom.welcome_seen',
  UPDATE_CHECK_LAST_AT: 'fuxiloom.updateCheck.lastAt',

  // 每日写作目标（商业化：状态栏进度；0=未设置）
  DAILY_GOAL: 'fuxiloom.daily_goal',

  // 极简直出模式（本地模型提速：跳过 6 步富管线，单 prompt 直出整章）
  EXPRESS_MODE: 'fuxiloom.express_mode',

} as const;

// 动态键名工厂函数

/**
 * 获取 Agent 状态存储键名
 * @param novelId 小说 ID
 * @returns 完整的 localStorage 键名
 */
export const getAgentStateKey = (novelId: string): string => `agent_state_v1_${novelId}`;

export const getAgentPlanFeedbackKey = (novelId: string): string => `agent_plan_feedback_v1_${novelId}`;

/**
 * 获取模型列表缓存键名
 * @param baseUrl 基础 URL
 * @param apiKeyFingerprint API Key 指纹
 * @returns 缓存键名
 */
export const getModelCacheKey = (baseUrl: string, apiKeyFingerprint: string): string =>
  `model_cache_${baseUrl}_${apiKeyFingerprint}`;

/**
 * 获取知识卡片元数据存储键名
 * @param id 知识卡片 ID
 * @returns localStorage 键名
 */
export const getKnowledgeCardMetaKey = (id: string): string => `kc_meta_${id}`;
