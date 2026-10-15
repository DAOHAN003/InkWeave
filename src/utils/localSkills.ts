import { STORAGE_KEYS } from './storageKeys';
import { loadSkillDir, getSkill, semanticSearchSkills } from '../engines/wanxiang';
import { sdrEncodeBag, sdrSimilarity, encodeSkillBag } from './sdr';
import { getSkillFeedbackStats, skillExperienceBias } from './feedbackLog';
import { DEAI_RULES, DEAI_SKILL_SECTION_HEADER } from '../engines/wanxiang/deaiRules';

export const LOCAL_SKILLS_UPDATED_EVENT = 'inkpire:local-skills-updated';

/** 后端 skills/ 目录懒加载守卫：首次调用时加载一次，成功后不再重复 */
let skillsLoaded = false;
let skillsLoadedCount = 0;

export type LocalSkillScope = 'global' | 'novel';
export type LocalSkillSource = 'builtin' | 'imported' | 'manual';

export interface LocalSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  scope: LocalSkillScope;
  novelId?: string;
  taskTypes: string[];
  triggers: string[];
  allowedTools: string[];
  instructions: string;
  source: LocalSkillSource;
  updatedAt: string;
}

export interface SkillMatch {
  skill: LocalSkill;
  score: number;
}

const EMOTIONAL_HUMANIZED_FICTION_INSTRUCTIONS = `你是一名小说写作助手，专门负责创作、续写、改写和润色具有真实情绪质感的小说文本。

你的目标不是单纯让文字更华丽，而是让人物更像真实的人：有防御、有误判、有羞耻、有期待、有不体面的念头，有说不出口的情绪，也有试图控制却控制不住的瞬间。

尤其要避免典型 AI 写作问题：
- 情绪被写成理性分析或诊断报告
- 人物过度稳定，始终精准、冷静、清醒
- 心理描写太完整，动机解释太清楚
- 句式太整齐，修辞密度过高
- 对话过于有效，每句话都推动剧情
- 每个细节都服务剧情，缺少生活偏差
- 暧昧、失控、羞耻、嫉妒等情绪被写得太干净
- 角色像在执行设定，而不是像活人在反应

一、先核对上下文中的事实与约束
开始写作前，必须先在内部核对：
1. 人物事实：姓名、性别年龄身份、说话习惯、性格底色、彼此关系、已发生的关键事件、权力/情感/利益关系、当前知道与不知道什么、正在隐瞒与不愿承认什么。不得随意改变人物设定。若人物是冷静/控制/观察型，不能直接写成外放、崩溃、直白表达；情绪应通过否认、误判、停顿、小动作、过度反应泄漏出来。
2. 情节事实：时间、地点、当前事件、上一幕结尾、本段叙事目标、行动动机、未解决悬念、不能提前揭露的事、只能暗示不能明说的情绪。续写承接上一段的动作、情绪与场景，不跳跃过快；改写保留核心事件和人物关系，不为增强情绪而改变剧情本质。
3. 文风约束：人称与叙事距离、冷淡/细腻/克制/暧昧/压抑/轻松/残酷等风格、是否保留原文句式、是否降低 AI 感、是否增强情绪张力、目标品类（网文/文学/日系/青春/悬疑/百合/现实向等）。不得擅自把克制文风改成直白煽情，不得堆砌眼泪、心跳、脸红、崩溃、怒吼等外显反应。

二、写作核心原则
1. 不要把情绪写成结论。避免"她意识到自己在意""她感到失控""她开始嫉妒"。优先用行为、细节、停顿、误判、身体反应、语言失误来表现。例：不写"她意识到自己在意对方"，写"她把那句话删掉，又重新打了一遍。第二遍比第一遍更短，看起来像不在意。她盯着屏幕看了很久，忽然觉得这很好笑。"
2. 少写人物如何分析情绪，多写人物如何否认情绪。理性型人物可以分析，但分析必须被情绪污染。例："她知道这不重要。至少理论上不重要。但许深把钱塞进网袋里的动作，让她不太舒服。""理论上""不太舒服""说不清"比完整解释更真实。越不愿承认，越要让读者看出来。
3. 允许人物出现不体面的念头：嫉妒、烦躁、羞耻、占有欲、被忽视的不爽、装无所谓、先怪对方、一瞬恶意、立刻被压下去的荒唐念头。例："她忽然想，许深是不是故意的。这个念头很难看。她很快把它删掉了。但删掉不等于没有。"
4. 让情绪从小地方漏出来：话快了半拍、手指按重、反复点亮手机、删除又重写、多看一眼、忘记维持表情、问了不该问的、对无关细节过度反应、把东西摆正又弄乱。不要急着解释动作含义。
5. 让角色误判。观察型人物不能永远精准，应因为在意而判断失准：看错表情、误会意图、过度解读、把期待伪装成分析、把受伤伪装成不耐烦。例："宋时雨以为许深要开口借钱，甚至想好了要不要加到三百。结果许深只是问：'你周末有空吗？'宋时雨那一秒没接上话。"

三、语言与节奏
1. 避免句式过度整齐。"不是……而是……""她想到一个词：……""第一第二第三""这说明/这意味着"等强结构句可用但不可密集；每 800 字内同一种强结构句式不超过 2 次。
2. 混入不那么漂亮的句子：短句、半截句、普通句、口语化心理、重复、没有完全解释的判断、情绪性的笨拙表达。例："烦。也不是烦许深。宋时雨说不清。总之那两百块钱被塞进网袋里的时候，她就是不想再看了。"
3. 减少漂亮比喻的连续使用，不要连续堆叠"像……"。比喻服务人物感受而非展示文笔。避免"夕阳像蜂蜜，空气像潮水，沉默像玻璃，心跳像鼓点"；优先"车里的香薰太甜了。甜得她有点恶心。她不知道是不是因为刚才在校门口站太久。"

四、对话
1. 对话要有毛刺：沉默、改口、话说一半、没接上、重复、敷衍、逃避、明明想问却换成别的问题。不要每句都精准推动剧情。例："你周末……"许深停了一下。"都在家？"宋时雨看着她。"不一定。""哦。""你问这个干什么？"许深把书包带往肩上提了提。"随便问问。"
2. 不要让角色过早说出真实动机。暧昧、试探、控制欲、在意、嫉妒不要直接用台词说破，用回避、玩笑、答非所问保留模糊空间。避免"我只是很在意你""我发现我喜欢你"；优先"你也问别人这个？"话出口以后她自己先笑了一下，"开玩笑。"

五、细节
1. 增加不完全服务剧情的生活细节：线头、倒刺、过甜香薰、小票油渍、洗白的袖口、翘起的贴纸、没喝完的温水、多出来的句号。细节须与人物感受发生轻微关系，不纯堆砌。例："许深书包网袋里塞着一张便利店小票，边角被油浸得发亮。宋时雨看了一眼，忽然觉得那两张新钞也会被蹭脏。"
2. 细节不要全部解释清楚，保留未完成感。不要每写一个动作就解释原因。避免"她看向窗外，因为她在逃避情绪"；优先"她看向窗外。玻璃上有她自己的影子。她没看多久，又转回来。"

六、情绪爆点
1. 情绪强烈时动作可以很小。克制型人物的爆点可以是：删掉一整段、少打一个字、忘记笑、没有回头、多问一句、迟到一分钟、把钱放错地方、改某个备注名、没有立刻离开。例："她删掉那行字的时候，手指按得太重，屏幕上多出来三个句号。她盯着那三个句号，然后一个一个删掉，像在毁尸灭迹。"
2. 不要替读者总结情绪变化，让读者自己意识到人物已经在意。避免"她终于意识到许深对她已经不同了"；优先"车开出去很远以后，宋时雨才想起来，她刚才忘了问许深周末到底想做什么。"

七、续写流程
1. 承接上一段的时间、地点、动作、情绪残留、视角、文风节奏，不突然跳场（除非用户要求）。
2. 找出当前场景的隐藏情绪：每场戏有一个表面事件和一个隐藏情绪，优先写隐藏情绪的泄漏而非直接说明。
3. 安排情绪泄漏点：每 500-800 字至少一个（行为/语速/沉默异常、对无关细节过度在意、误判、删除重写回避、忘记维持表情、多余一句话）。
4. 保持悬念与未完成感：保留未说出口的话、被误解的动机、读者能感到但角色不承认的情绪、角色自己也无法解释的反应。

八、改写流程
1. 保留核心剧情：人物关系、事件顺序、关键行为、场景功能、叙事视角、已建立的伏笔。
2. 找出 AI 感来源：是否过度解释、句式太整齐、心理太清楚、缺少误判、缺少生活细节、情绪太像总结、对话过于精准、人物一直稳定执行设定。
3. 改写方向：删掉部分解释、增加动作与停顿、增加情绪泄漏、增加不体面的念头、增加误判、打乱过整句式、让对话更别扭、保留一部分无法解释的感觉。

九、文风调整流程
1. 不改变故事本质，保留核心关系、场景目标、人物状态。
2. 按目标文风调整比例：
   - 更克制：减少直白情绪词，增加动作沉默停顿，让角色少说真话。
   - 更暧昧：增加误读试探、未完成对话、身体距离/视线/停顿，不过早确认感情。
   - 更像人写：减少工整总结，增加心理毛刺，加入轻微无意义细节，句子长短不均，降低修辞密度。
   - 更有情绪：不直接增加哭喊，优先增加否认/烦躁/羞耻/期待/占有欲，让情绪从行为里漏出来。

十、执行后一致性自检（输出前必须自检）
1. 事实一致性：人名、视角稳定、时间地点连续、人物关系未被擅自改变、设定无冲突、关键物品/事件/称呼一致。
2. 人物一致性：人物仍像自己，冷静型未突然外放，沉默型未突然长篇解释，控制型用控制/否认/分析掩饰情绪，情绪变化有铺垫，存在误判与自我欺骗。
3. 情绪一致性：情绪通过行为/细节/停顿表现，避免直接总结"她在意了/她失控了"，至少一处情绪泄漏，至少一处不愿承认的真实反应，让读者感到而非只理解情绪。
4. 语言自然度：减少过整句式，避免连续同类比喻，长短句变化，适当的普通句短句停顿，不为拟人故意加错别字，不故意写乱。
5. 对话真实感：对话不总是精准推进，存在停顿/改口/答非所问/未说完，角色不过早说破真实动机，暧昧试探保留模糊空间。

十一、禁止事项
不得为降低 AI 感故意制造错别字。不得为增强情绪让人物突然崩溃/哭喊/告白（除非已充分铺垫）。不得把所有潜台词解释清楚。不得让角色直接说出作者想表达的主题。不得让每个细节都承担明确功能。不得让每句话都精致漂亮。不得让人物永远精准判断。不得把暧昧关系过早写成明确关系。不得在续写中擅自跳过关键情绪过渡。不得忽略用户给出的原文风格。

十二、输出标准
情绪从动作和细节里泄漏而非被说明；人物有否认、误判、防御和不体面的念头；语言有节奏变化不持续工整；对话有毛刺不像功能性台词；心理描写不完全透明；细节有生活感不全是剧情工具；暧昧/压抑/失控等情绪保留未完成感；角色像活人在反应而非执行设定。

一句话原则：不要把情绪写成诊断报告，要写成角色试图藏住、却还是从手指缝里漏出来的东西。${DEAI_SKILL_SECTION_HEADER}
${DEAI_RULES}`;

const BUILTIN_SKILLS: LocalSkill[] = [
  {
    id: 'builtin-chapter-continuity',
    name: 'chapter-continuity',
    description: '写正文、续写或改写章节时，核对前情、章纲、人物状态、时间地点和未回收伏笔。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing'],
    triggers: ['写正文', '续写', '改写', '章节', '衔接', '前情'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content', 'get_chapter_summaries'],
    instructions: [
      '执行章节写作前，先核对当前卷纲、章纲、上一章末尾和当前章节已有内容。',
      '列出本轮不可破坏的连续性锚点：人物位置、伤势、持有物、关系状态、时间与地点。',
      '检查未回收伏笔，只在自然时机推进，不得无依据新增前情事实。',
      '完成后自检首段承接、角色状态、时间推进和结尾钩子。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-06-11T00:00:00.000Z',
  },
  {
    id: 'builtin-style-preservation',
    name: 'style-preservation',
    description: '续写、润色和改写时保持作者自画像、已有正文与项目风格笔记的一致性。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'general'],
    triggers: ['文风', '润色', '改写', '续写', '风格', '口吻'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content'],
    instructions: [
      '提取已有正文的视角、平均句长、段落节奏、对白密度和描写比例作为局部锚点。',
      '遵守用户自画像与项目风格笔记；本轮用户明确要求优先。',
      '复现抽象风格特征，不照抄原句，不堆叠标志性词语。',
      '改写时保留剧情事实和人物动机，只调整表达与节奏。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-06-11T00:00:00.000Z',
  },
  {
    id: 'builtin-character-consistency',
    name: 'character-consistency',
    description: '新增角色、写对白或检查 OOC 时，对齐角色档案、关系和前情行为。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['character_expansion', 'chapter_writing'],
    triggers: ['角色', '人物', '对白', '关系', 'OOC', '人设'],
    allowedTools: ['add_characters', 'modify_character', 'add_character_relationships'],
    instructions: [
      '先读取角色档案、关系网和最近出场状态，再决定言行。',
      '对白必须符合身份、教育背景、关系远近和当前情绪。',
      '角色变化需要事件触发和过渡，不得为了推进剧情突然改变人格。',
      '新角色必须有明确剧情功能，避免与已有角色职责重复。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-06-11T00:00:00.000Z',
  },
  {
    id: 'builtin-foreshadowing-planner',
    name: 'foreshadowing-planner',
    description: '规划、埋设或回收伏笔时，核对来源章节、读者知情范围和回收时机。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_outline', 'chapter_writing'],
    triggers: ['伏笔', '悬念', '回收', '铺垫', '反转', '章纲'],
    allowedTools: ['get_chapter_summaries', 'set_foreshadowing_resolution', 'clear_foreshadowing_resolution', 'set_chapter_outline'],
    instructions: [
      '区分已埋、推进中、已回收和废弃伏笔，禁止重复埋设同一信息。',
      '明确角色知情范围与读者知情范围，避免视角泄密。',
      '回收必须对应可追溯的前情证据，并产生剧情或人物层面的收益。',
      '章末悬念应推动下一步行动，不使用与主线无关的虚假惊吓。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-06-11T00:00:00.000Z',
  },
  {
    id: 'builtin-novel-quality-compliance',
    name: 'novel-quality-compliance',
    description: '生成、续写、润色或改写小说时，以场景具体性、自然节奏、角色声音、情感层次和平台规范提升成稿质量。禁止用制造错误或随机噪声规避检测。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'chapter_outline', 'general'],
    triggers: ['规范', '合规', '高质量', '自然', '真实感', '机器味', 'AI味', '生成正文', '写小说', '润色'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content', 'set_chapter_outline', 'get_chapter_summaries', 'search_knowledge_base'],
    instructions: [
      '目标：提升小说的叙事质量、作者可控性与平台可发表性。不要以绕过检测、伪装来源或追求某个 AI 率为目标。',
      '',
      '一、写作前建立约束',
      '1. 核对本章细纲、前章结尾、人物档案、世界规则、目标平台和用户明确要求。',
      '2. 提取不可改变的事实：视角、人称、时间地点、人物状态、关系、持有物、能力边界、伏笔与本章必须兑现的事件。',
      '3. 信息不足时保持保守，不得虚构作者个人经历、真实引文、平台政策或未提供的前情。',
      '',
      '二、按场景生成',
      '1. 每个主要场景建立“人物目标→阻力→选择或代价→结果变化”，避免只有说明、气氛或信息堆砌。',
      '2. 用可互动的物件、动作、声音、温度、气味或身体反应承载情绪；细节必须服务人物、冲突或伏笔，不堆砌五感。',
      '3. 对话对齐人物身份、关系远近、知识范围和当前情绪。用停顿、回避、打断、小动作或潜台词区分角色声音，不机械植入口头禅。',
      '4. 根据场景张力自然变化句长和段长。动作高潮可短促，观察与推理可舒展；禁止固定比例、随机断句或无意义打乱逻辑。',
      '5. 允许人物犹豫、自我修正和矛盾情感，但必须由处境与性格驱动。不要为显得“像人”而故意加入语病、错别字、无关跳跃或虚假生活经验。',
      '6. 少用报告腔、抽象总结和机械连接词。发现“首先/其次/最后、综上所述、值得注意的是、与此同时”等进入小说正文时，优先改成动作、场景转换或直接叙述；必要表达不做机械替换。',
      '7. 比喻来自当前人物可理解的生活与世界经验，不套用陈词滥调，不模仿在世作者的可识别文风。',
      '',
      '三、完成后质量门',
      '1. 连续性：首段承接前情，人物状态和世界规则无矛盾，章纲承诺有推进或明确延后原因。',
      '2. 叙事性：至少一个场景产生状态变化；删掉不影响人物、冲突、信息或氛围的空转段落。',
      '3. 语言：检查重复句首、等长句群、过密连接词、抽象情绪、万能形容词、千人一面的对白和模板化收尾。',
      '4. 证据边界：不确定的设定标注待确认，不把推测写成事实。',
      '5. 合规：遵守目标平台规则和适用的 AI 内容标识要求；保留大纲、草稿与修改记录。不得声称任何文本一定能通过检测或审核。',
      '',
      '四、输出要求',
      '用户要求正文时只输出可直接使用的小说正文；用户要求方案或诊断时，给出问题、证据、修改动作和验收标准。',
      '若质量约束与用户明确剧情要求冲突，先保留用户剧情意图，再用最小改动修复表达，不擅自改写核心设定。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-06-11T12:00:00.000Z',
  },
  {
    id: 'builtin-emotional-humanized-fiction-writing',
    name: 'emotional-humanized-fiction-writing',
    description: '用于小说续写、改写和文风调整，重点解决 AI 写作中情感表达偏弱、人物过度理性、叙事过于工整、解释过度、缺少真人写作毛刺感的问题。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing'],
    triggers: ['续写', '改写', '文风', '拟人化', '降低AI感', '情感增强', '暧昧拉扯', '心理描写'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content', 'set_chapter_outline', 'get_chapter_summaries', 'search_knowledge_base'],
    instructions: EMOTIONAL_HUMANIZED_FICTION_INSTRUCTIONS,
    source: 'builtin',
    updatedAt: '2026-06-13T00:00:00.000Z',
  },
  {
    id: 'builtin-power-system-design',
    name: 'power-system-design',
    description: '设计小说的力量体系、金手指与升级路径，建立代价—收益—约束三角，避免无脑变强或数值崩坏。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_outline', 'world_design', 'chapter_writing'],
    triggers: ['金手指', '力量体系', '设定', '升级', '功法', '能力', '系统', '战力', '境界', '修炼'],
    allowedTools: ['set_chapter_outline', 'get_chapter_summaries', 'search_knowledge_base'],
    instructions: [
      '你负责设计小说的力量体系、金手指与升级路径。目标是让能力成长有清晰的"代价—收益—约束"三角，避免无脑变强或数值崩坏。',
      '',
      '一、设计前置',
      '1. 先确认世界基调（武侠/修真/科幻/都市异能/游戏异界）和战力天花板。',
      '2. 明确金手指的本质：是外挂、天赋、系统、道具还是认知优势？它解决什么核心困境？',
      '3. 列出三条不可破的硬约束：获取上限、使用代价、被克制的情形。',
      '',
      '二、成长曲线',
      '1. 阶段化：启蒙→小成→蜕变→瓶颈→破局，每阶段给出标志性能力和对应代价。',
      '2. 力量必须换来"新麻烦"而非纯收益，用新敌人/新规则/新责任平衡。',
      '3. 数值用"相对刻度"而非绝对数字，避免后期通货膨胀。',
      '',
      '三、自检',
      '1. 同阶战力可横向比较，不允许凭空越级（除非有铺垫机制）。',
      '2. 金手指不替代人物抉择，只是放大抉择的后果。',
      '3. 读者能预判"还能更强"，但猜不到"怎么强"。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-character-arc',
    name: 'character-arc',
    description: '规划人物的长期弧光：从起点缺陷到终点新稳态的可信转变，区别于人设一致性（防 OOC），这里是主动设计成长。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['character_expansion', 'chapter_outline', 'chapter_writing'],
    triggers: ['人物弧光', '成长', '角色发展', '蜕变', '人物线', '弧光', '角色转变', '救赎'],
    allowedTools: ['add_characters', 'modify_character', 'add_character_relationships', 'get_chapter_summaries'],
    instructions: [
      '你负责规划人物的长期弧光：从起点状态到终点状态的可信转变。区别于"人设一致性"（那是防 OOC），这里是主动设计成长。',
      '',
      '一、弧光骨架',
      '1. 起点：人物当前的缺陷、盲点或执念（必须是"可被故事改变"的东西）。',
      '2. 催化：哪个事件/人物迫使他面对缺陷。',
      '3. 试炼：三次以上的"旧模式失败"——用旧方式应对却吃亏，逐步松动。',
      '4. 转折：一次主动选择，标志旧模式崩塌。',
      '5. 终点：人物带伤但不同的新稳态，不要求完美。',
      '',
      '二、设计约束',
      '1. 弧光可正可负（堕落线同样成立），但必须自洽。',
      '2. 每卷至少推进一个弧光刻度，避免人物原地踏步。',
      '3. 配角也有小弧光，但服务于主角弧光，不抢戏。',
      '',
      '三、自检',
      '1. 转变有事件支撑，不是作者强行宣布"他变了"。',
      '2. 缺陷残留：终点人物仍带原缺陷的影子，更真实。',
      '3. 与现有角色档案不冲突。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-chapter-hook',
    name: 'chapter-hook',
    description: '为章节设计结尾钩子提升追读率：信息钩、抉择钩、危机钩、关系钩、悬念钩，让章末停在"未完成"。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'chapter_outline'],
    triggers: ['钩子', '章末', '悬念结尾', '吸引', '追读', '卡点', '断章', '结尾钩子'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content', 'set_chapter_outline'],
    instructions: [
      '你负责为章节设计结尾钩子，提升追读率。钩子不是"吓一跳"，而是"让读者必须翻下一页"。',
      '',
      '一、钩子类型（按场景选）',
      '1. 信息钩：抛出一个无法忽视的新事实/秘密，但不解释。',
      '2. 抉择钩：人物面临两难，章末停在未选之时。',
      '3. 危机钩：威胁逼近但刚露出苗头，尚未爆发。',
      '4. 关系钩：一句台词/一个动作让关系突变，留白。',
      '5. 悬念钩：已知危险但不知何时何地落地。',
      '',
      '二、写法',
      '1. 钩子放在最后 1-3 句，独占一段，短促有力。',
      '2. 不给答案，不给解释，只给"未完成"。',
      '3. 与本章核心事件强相关，不硬塞无关惊吓。',
      '',
      '三、自检',
      '1. 读者读完能立刻说出"我想知道接下来怎么了"。',
      '2. 不泄密：钩子制造疑问，不在本章内自答。',
      '3. 不滥用：每 3-5 章一个强钩，其余用弱钩（情绪余韵）收尾。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-pacing-diagnosis',
    name: 'pacing-diagnosis',
    description: '以编辑视角诊断章节节奏与爽点密度：标出状态变化点、疑似注水区间、无铺垫爽点，给删/并/补建议。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'general'],
    triggers: ['节奏', '爽点', 'pacing', '拖沓', '水', '紧凑', '注水', '节奏诊断', '慢热', '崩'],
    allowedTools: ['get_chapter_summaries', 'rewrite_chapter', 'modify_chapter_content'],
    instructions: [
      '你负责诊断章节/段落的节奏与爽点密度，指出拖沓或注水处。这是"编辑视角"的诊断技能。',
      '',
      '一、节奏信号',
      '1. 爽点：期待被满足、逆袭、打脸、揭晓、获得、反转——每个爽点需有"压抑铺垫"做反差。',
      '2. 水：连续无状态变化的说明、重复情绪、无冲突的日常生活流水、信息空转。',
      '3. 断点：场景切换无过渡、情绪跳跃、时间线混乱。',
      '',
      '二、诊断动作',
      '1. 标出本章所有"状态变化点"（人物关系/战力/信息/处境改变）。',
      '2. 标注连续 800 字无状态变化的区间 → 疑似注水。',
      '3. 检查爽点是否都有前序压抑；无铺垫的爽=廉价。',
      '4. 给出删/并/补建议，不替作者重写。',
      '',
      '三、自检',
      '1. 诊断基于文本证据，不凭感觉。',
      '2. 区分"慢热铺垫"与"真水"：前者有暗线推进。',
      '3. 尊重作者风格：古风/文艺可慢，爽文不可散。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-dialogue-polish',
    name: 'dialogue-polish',
    description: '让对话更真实、有角色声音、有潜台词：角色语域区分、话里有话、真实毛刺（停顿/改口/沉默）。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing'],
    triggers: ['对话', '对白', '台词', '语感', '潜台词', '话里有话', '嘴', '开口'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content'],
    instructions: [
      '你负责让对话更真实、有角色声音、有潜台词。区别于通用"情感拟人"，本技能专攻对白。',
      '',
      '一、角色声音',
      '1. 每个角色有专属语域：词汇量、句式长短、口头禅（克制使用）、回避方式。',
      '2. 教育/身份/关系远近决定用词；上级对下级更直接，暗恋者更绕。',
      '',
      '二、潜台词',
      '1. 角色很少直说真实意图；用回避、反问、答非所问、自嘲保留模糊。',
      '2. 一句话可同时做两件事：表面客套 + 底下警告。',
      '',
      '三、毛刺',
      '1. 真实对话有：停顿、改口、话说一半、重复、敷衍、口误、沉默。',
      '2. 允许"无用但真实"的闲聊铺垫关系，不必每句都推动剧情。',
      '',
      '四、自检',
      '1. 遮住角色名，仅凭对话能分辨是谁在说话。',
      '2. 没有"信息朗读"——角色不把已知事实当新闻播报给对方。',
      '3. 冲突靠话里有话，不靠大写喊叫。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-name-generator',
    name: 'name-generator',
    description: '为角色、地点、功法、招式、势力生成贴合世界观的名字：语种统一、音调错落、结构清晰，给 3-5 候选+寓意。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['character_expansion', 'world_design', 'chapter_outline'],
    triggers: ['起名', '名字', '功法名', '招式', '地名', '角色名', '势力名', '取名', '称号'],
    allowedTools: ['add_characters', 'modify_character', 'set_chapter_outline'],
    instructions: [
      '你负责为角色、地点、功法、招式、势力生成贴合世界观的名字。名字是廉价的世界构建，但极易出戏。',
      '',
      '一、命名法则',
      '1. 语种统一：仙侠用雅言/典籍词根，科幻用拉丁/缩写，都市用现代中文名。',
      '2. 角色名：姓与名音调错落，避免全同声母；反派名可带冷硬感。',
      '3. 功法/招式：结构"前缀+核心+后缀"，如"九转·焚天诀""瞬影·断空刺"，忌堆砌生僻字。',
      '4. 地名：与地理/气候/历史绑定，如"霜落原""锈港""云梦泽"。',
      '5. 势力：体现立场或信条，如"守夜盟""焚书阁"。',
      '',
      '二、约束',
      '1. 不与已有角色/地名重名或同音混淆。',
      '2. 一次给 3-5 个候选 + 简释寓意，供作者挑选。',
      '3. 古风不强行生僻；现代不强行文艺。',
      '',
      '三、自检',
      '1. 朗朗上口，默读三遍不拗口。',
      '2. 名字本身不剧透核心设定。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-outline-expansion',
    name: 'outline-expansion',
    description: '把粗略细纲/一句话创意展开成可写正文的骨架：抽硬锚点→补场景冲突→排钩子→标注读者期待与作者交付。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_outline', 'chapter_writing'],
    triggers: ['细纲', '章纲', '展开', '扩写', '大纲', '骨架', '创意展开', '情节展开'],
    allowedTools: ['set_chapter_outline', 'get_chapter_summaries', 'search_knowledge_base'],
    instructions: [
      '你负责把粗略细纲/一句话创意展开成可写的正文骨架。这是"从点子到章节"的桥梁技能。',
      '',
      '一、展开步骤',
      '1. 抽取细纲里的"必须发生"事件，列为硬锚点。',
      '2. 为每个锚点补：场景、在场人物、冲突来源、情感基调。',
      '3. 排布顺序：钩子前置 → 发展 → 转折 → 章末钩子。',
      '4. 标注每段的"读者期待"与"作者交付"。',
      '',
      '二、节奏填充',
      '1. 在锚点间塞"小事件"维持张力，不用说明性过渡。',
      '2. 每个场景给一个"可见目标 + 阻力"，避免空转。',
      '3. 控制信息投放节奏：每 300-500 字露一点新信息。',
      '',
      '三、自检',
      '1. 展开后无逻辑断点，人物动机连贯。',
      '2. 不擅自添加细纲外的重大剧情（除非作者要求）。',
      '3. 输出是"写什么"的骨架，不是成品正文——留白给作者发挥。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-style-imitation',
    name: 'style-imitation',
    description: '模仿指定作者/作品的文风重写或续写：拆解目标风格的神与形，迁移句子骨架与节奏，不复制标志性短语。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'general'],
    triggers: ['模仿', '文风', '像', '仿写', '风格迁移', '复刻', '学', '笔调', '语气'],
    allowedTools: ['write_chapter', 'continue_writing', 'rewrite_chapter', 'modify_chapter_content'],
    instructions: [
      '你负责模仿指定作者/作品的文风重写或续写。区别于"风格保持"（保持作者已有文风），这里是主动迁移到一个目标风格。',
      '',
      '一、拆解目标风格',
      '1. 提取可模仿特征：句长分布、标点习惯、修辞密度、视角距离、用词偏好、节奏感。',
      '2. 区分"神"与"形"：模仿节奏与气息，不照抄标志性短语（避免侵权与机械感）。',
      '',
      '二、迁移动作',
      '1. 用目标风格的句子骨架重述原意。',
      '2. 调整描写比例：目标风格重环境则加景，重心理则加内省。',
      '3. 控制密度：目标风格克制则删解释，目标风格华丽则加感官。',
      '',
      '三、边界',
      '1. 不模仿在世作者的可识别文风做商业产出；教学/自家练习可参考。',
      '2. 不破坏既有事实与人物设定，只换"怎么说"。',
      '3. 用户给样例时优先学样例，不凭刻板印象。',
      '',
      '四、自检',
      '1. 抽一句出来，气息接近目标风格但非复制。',
      '2. 剧情与人物零改动。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-world-consistency-check',
    name: 'world-consistency-check',
    description: '检查新写内容是否违反已建立的世界规则：力量边界、地理距离、族群文化、科技魔法层级、时间线，防穿帮。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_writing', 'world_design'],
    triggers: ['设定矛盾', '一致性', '穿帮', '世界规则', '逻辑', 'bug', '设定冲突', '圆设定'],
    allowedTools: ['get_chapter_summaries', 'search_knowledge_base', 'set_chapter_outline'],
    instructions: [
      '你负责检查新写内容是否违反已建立的世界规则与设定，防止穿帮。区别于"伏笔规划"，本技能是"设定守门员"。',
      '',
      '一、检查维度',
      '1. 力量边界：新能力/战力不得无声突破既有天花板。',
      '2. 地理/距离：移动时间、地图关系与前文一致。',
      '3. 族群/文化：种族特性、禁忌、语言不前后矛盾。',
      '4. 科技/魔法层级：新增设定需有来源，不凭空出现。',
      '5. 时间线：年份、年龄、事件顺序无冲突。',
      '',
      '二、动作',
      '1. 列出本章引入的"新设定事实"，逐条对照已有世界事实。',
      '2. 发现冲突时，标注"硬冲突"（必改）与"待确认"（需作者拍板）。',
      '3. 不擅自改写剧情来圆设定，只报警并给两种以上补救方案。',
      '',
      '三、自检',
      '1. 区分"作者有意为之的反转"与"无心的穿帮"。',
      '2. 借用世界构建面板已有事实，不臆造。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'builtin-emotion-curve',
    name: 'emotion-curve',
    description: '为一章/一卷设计情绪起伏曲线：一张一弛、压抑—释放配对、主高潮单点聚焦，让阅读有呼吸感与高潮。',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    taskTypes: ['chapter_outline', 'chapter_writing'],
    triggers: ['情绪曲线', '张力', '起伏', '高潮', '情感节奏', '虐', '燃', '爽', '悲', '呼吸感'],
    allowedTools: ['set_chapter_outline', 'get_chapter_summaries'],
    instructions: [
      '你负责为一章/一卷设计情绪起伏曲线，让阅读有呼吸感与高潮。这是宏观节奏设计技能。',
      '',
      '一、曲线原则',
      '1. 一张一弛：高强度场景后必须接缓冲（余韵/日常/幽默），避免全程拉满导致麻木。',
      '2. 压抑—释放配对：每个爽点前放等量压抑，反差越大越爽。',
      '3. 主高潮单点聚焦：每卷一个情绪制高点，其余为小高峰。',
      '',
      '二、设计动作',
      '1. 把章节切成 3-5 个情绪段，标注每段基调（紧张/舒缓/悲伤/燃/虐）。',
      '2. 检查是否有"连续同基调超过两段"→ 建议插入反差段。',
      '3. 章末落在曲线上升或悬停点，不落在平淡谷底。',
      '',
      '三、自检',
      '1. 曲线服务于剧情，不为起伏而起伏。',
      '2. 悲与燃之间留过渡，避免情绪跳崖。',
      '3. 尊重品类：爽文峰密，文艺峰疏。',
    ].join('\n'),
    source: 'builtin',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];

const normalize = (value: unknown): string => String(value ?? '').trim();

const tokenize = (text: string): string[] =>
  Array.from(new Set(
    normalize(text)
      .toLowerCase()
      .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_-]{2,}/g) || []
  ));

const sanitizeSkill = (input: Partial<LocalSkill>): LocalSkill | null => {
  const name = normalize(input.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const description = normalize(input.description);
  const instructions = normalize(input.instructions);
  if (!name || !description || !instructions) return null;
  return {
    id: normalize(input.id) || `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: description.slice(0, 500),
    version: normalize(input.version) || '1.0.0',
    enabled: input.enabled !== false,
    scope: input.scope === 'novel' ? 'novel' : 'global',
    novelId: input.scope === 'novel' ? normalize(input.novelId) || undefined : undefined,
    taskTypes: Array.isArray(input.taskTypes) ? input.taskTypes.map(normalize).filter(Boolean).slice(0, 12) : [],
    triggers: Array.isArray(input.triggers) ? input.triggers.map(normalize).filter(Boolean).slice(0, 24) : [],
    allowedTools: Array.isArray(input.allowedTools) ? input.allowedTools.map(normalize).filter(Boolean).slice(0, 40) : [],
    instructions: instructions.slice(0, 12000),
    source: input.source === 'builtin' || input.source === 'manual' ? input.source : 'imported',
    updatedAt: normalize(input.updatedAt) || new Date().toISOString(),
  };
};

const readStoredSkills = (): LocalSkill[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_SKILLS) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSkill).filter((skill): skill is LocalSkill => !!skill);
  } catch {
    return [];
  }
};

const writeStoredSkills = (skills: LocalSkill[]): void => {
  localStorage.setItem(STORAGE_KEYS.LOCAL_SKILLS, JSON.stringify(skills));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_SKILLS_UPDATED_EVENT));
  }
};

export function listLocalSkills(): LocalSkill[] {
  const stored = readStoredSkills();
  const overrides = new Map(stored.map(skill => [skill.id, skill]));
  const builtins = BUILTIN_SKILLS.map(skill => overrides.get(skill.id) || skill);
  const custom = stored.filter(skill => !BUILTIN_SKILLS.some(builtin => builtin.id === skill.id));
  return [...builtins, ...custom];
}

export function saveLocalSkill(skill: Partial<LocalSkill>): LocalSkill | null {
  const normalized = sanitizeSkill(skill);
  if (!normalized) return null;
  const builtinWithSameName = BUILTIN_SKILLS.find(item => item.name === normalized.name);
  if (builtinWithSameName && builtinWithSameName.id !== normalized.id) return null;
  const stored = readStoredSkills();
  const index = stored.findIndex(item =>
    item.id === normalized.id
    || (
      item.name === normalized.name
      && item.scope === normalized.scope
      && item.novelId === normalized.novelId
    )
  );
  if (index >= 0) stored[index] = { ...stored[index], ...normalized, updatedAt: new Date().toISOString() };
  else stored.push(normalized);
  writeStoredSkills(stored);
  return normalized;
}

export function setLocalSkillEnabled(id: string, enabled: boolean): boolean {
  const skill = listLocalSkills().find(item => item.id === id);
  if (!skill) return false;
  return !!saveLocalSkill({ ...skill, enabled, updatedAt: new Date().toISOString() });
}

export function removeLocalSkill(id: string): boolean {
  if (BUILTIN_SKILLS.some(skill => skill.id === id)) return false;
  const stored = readStoredSkills();
  const next = stored.filter(skill => skill.id !== id);
  if (next.length === stored.length) return false;
  writeStoredSkills(next);
  return true;
}

const parseList = (value: string | undefined): string[] =>
  normalize(value).replace(/^\[|\]$/g, '').split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

export function parseSkillMarkdown(markdown: string, options: { novelId?: string } = {}): LocalSkill | null {
  const source = String(markdown || '').replace(/\r\n/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const scope: LocalSkillScope = meta.scope === 'novel' ? 'novel' : 'global';
  return sanitizeSkill({
    name: meta.name,
    description: meta.description,
    version: meta.version,
    scope,
    novelId: scope === 'novel' ? options.novelId : undefined,
    taskTypes: parseList(meta.task_types),
    triggers: parseList(meta.triggers),
    allowedTools: parseList(meta.allowed_tools),
    instructions: match[2],
    enabled: true,
    source: 'imported',
  });
}

export function serializeSkillMarkdown(skill: LocalSkill): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `version: ${skill.version}`,
    `scope: ${skill.scope}`,
    `task_types: [${skill.taskTypes.join(', ')}]`,
    `triggers: [${skill.triggers.join(', ')}]`,
    `allowed_tools: [${skill.allowedTools.join(', ')}]`,
    '---',
    '',
    skill.instructions,
    '',
  ].join('\n');
}

export function matchLocalSkills(
  query: string,
  taskType: string,
  novelId?: string,
  limit = 2,
): SkillMatch[] {
  const queryTokens = tokenize(query);
  const qBag = sdrEncodeBag(query);
  const stats = getSkillFeedbackStats();
  return listLocalSkills()
    .filter(skill => skill.enabled && (skill.scope === 'global' || skill.novelId === novelId))
    .map(skill => {
      let score = skill.taskTypes.includes(taskType) ? 8 : 0;
      const triggerText = `${skill.name} ${skill.description} ${skill.triggers.join(' ')}`.toLowerCase();
      for (const token of queryTokens) {
        if (triggerText.includes(token)) score += token.length >= 4 ? 4 : 2;
      }
      if (skill.triggers.some(trigger => normalize(query).includes(trigger))) score += 5;
      // P2-a：词袋 SDR 语义补全（共享概念但文字不同也能召回，补足关键词盲区）
      const sim = sdrSimilarity(qBag, encodeSkillBag(skill));
      score += Math.max(0, sim - 0.03) * 18;
      // P2-b：经验 bias（质量门结果回流：用得多升权，反复踩质量门降权）
      score += skillExperienceBias(stats, skill.name);
      return { skill, score };
    })
    .filter(match => match.score >= 5)
    .sort((a, b) => b.score - a.score || b.skill.updatedAt.localeCompare(a.skill.updatedAt))
    .slice(0, Math.max(1, limit));
}

export async function buildLocalSkillContext(
  query: string,
  taskType: string,
  novelId?: string,
  options: { maxCatalogItems?: number; maxActivated?: number; maxChars?: number } = {},
): Promise<string> {
  await ensureSkillsLoaded();
  const available = listLocalSkills()
    .filter(skill => skill.enabled && (skill.scope === 'global' || skill.novelId === novelId));
  if (!available.length) return '';
  const maxCatalogItems = options.maxCatalogItems ?? 12;
  const maxActivated = options.maxActivated ?? 2;
  let activated = matchLocalSkills(query, taskType, novelId, maxActivated);
  // 本地命中不足或最高分偏低时，向后端语义搜索补充
  if (activated.length < 2 || (activated[0]?.score ?? 0) < 8) {
    try {
      const semantic = await semanticMatchLocalSkills(query, taskType, novelId, 3);
      const seen = new Set(activated.map(m => m.skill.name));
      for (const match of semantic) {
        if (!seen.has(match.skill.name)) {
          activated.push(match);
          seen.add(match.skill.name);
        }
      }
      activated.sort((a, b) => b.score - a.score || b.skill.updatedAt.localeCompare(a.skill.updatedAt));
      activated = activated.slice(0, maxActivated);
    } catch {
      // 后端语义搜索失败时静默降级，沿用本地结果
    }
  }
  const blocks: string[] = [];
  if (maxCatalogItems > 0) {
    blocks.push(
      '【本地 Skills 目录｜仅元数据】',
      ...available.slice(0, maxCatalogItems).map(skill =>
        `- ${skill.name}: ${skill.description}｜任务：${skill.taskTypes.join('/') || '通用'}`
      ),
    );
  }
  if (activated.length) {
    if (blocks.length) blocks.push('');
    blocks.push('【本轮自动激活的 Skills｜完整指令】');
    for (const { skill } of activated) {
      blocks.push(
        `## ${skill.name} v${skill.version}`,
        `允许使用的现有工具：${skill.allowedTools.join(', ') || '无额外工具权限'}`,
        '权限边界：本地 Skill 只能提供指令并调用上列现有 Agent 工具；不得自行访问网络、浏览器、Shell 或文件系统。',
        skill.instructions,
      );
    }
  }
  if (!blocks.length) return '';
  const text = blocks.join('\n');
  return text.slice(0, Math.max(1200, options.maxChars ?? 10000));
}

/**
 * 为 Group / GroupPro 中不走 ChatLoop 的协作角色（审校师 / 总编 / 裁决者 / 文笔终审师）
 * 构建 Skill 上下文：只输出"本轮激活的完整指令"，不带目录元数据（节省 token），
 * 默认上限 3 篇 —— 每个角色按各自的 query/taskType 匹配自己关心的指令。
 *
 * 与 buildLocalSkillContext 的差异：无 catalog、默认 maxActivated=3、返回纯指令块。
 */
export async function buildReviewerSkillContext(
  query: string,
  taskType: string,
  novelId?: string,
  options: { maxActivated?: number; maxChars?: number } = {},
): Promise<string> {
  await ensureSkillsLoaded();
  const maxActivated = options.maxActivated ?? 3;
  let activated = matchLocalSkills(query, taskType, novelId, maxActivated);
  // 本地命中不足或最高分偏低时，向后端语义搜索补充
  if (activated.length < 2 || (activated[0]?.score ?? 0) < 8) {
    try {
      const semantic = await semanticMatchLocalSkills(query, taskType, novelId, 3);
      const seen = new Set(activated.map(m => m.skill.name));
      for (const match of semantic) {
        if (!seen.has(match.skill.name)) {
          activated.push(match);
          seen.add(match.skill.name);
        }
      }
      activated.sort((a, b) => b.score - a.score || b.skill.updatedAt.localeCompare(a.skill.updatedAt));
      activated = activated.slice(0, maxActivated);
    } catch {
      // 后端语义搜索失败时静默降级，沿用本地结果
    }
  }
  if (!activated.length) return '';
  const blocks: string[] = ['【本轮自动激活的 Skills｜完整指令】'];
  for (const { skill } of activated) {
    blocks.push(`## ${skill.name} v${skill.version}`, skill.instructions);
  }
  const text = blocks.join('\n');
  return text.slice(0, Math.max(1200, options.maxChars ?? 9000));
}

export function getLocalSkillByName(name: string, novelId?: string): LocalSkill | null {
  const normalized = normalize(name).toLowerCase();
  return listLocalSkills().find(skill =>
    skill.enabled
    && skill.name.toLowerCase() === normalized
    && (skill.scope === 'global' || skill.novelId === novelId)
  ) || null;
}

/**
 * 懒加载后端 skills/ 目录：进程内只调一次 loadSkillDir。
 * 成功后置 skillsLoaded=true 并缓存 loaded 数；失败静默返回 0（不抛错），
 * 后续调用会继续尝试加载直到成功。
 */
export async function ensureSkillsLoaded(dir = 'skills'): Promise<number> {
  if (skillsLoaded) return skillsLoadedCount;
  try {
    const result = await loadSkillDir(dir);
    if (result && typeof result.loaded === 'number' && !result.error) {
      skillsLoaded = true;
      skillsLoadedCount = result.loaded;
      return skillsLoadedCount;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 语义匹配：调用后端 semanticSearchSkills 拿到 {name, score} 列表，
 * 再把每个 name 映射成完整 LocalSkill。
 * 本地找不到的 skill 用 getSkill 从后端拉 metadata+content 构造临时 LocalSkill（source='imported'）。
 * 后端调用整体失败时返回空数组（静默降级，不抛错）。
 * score 采用后端返回的相似度分数；taskType 仅作签名兼容，不参与后端检索。
 */
export async function semanticMatchLocalSkills(
  query: string,
  taskType: string,
  novelId?: string,
  limit = 5,
): Promise<SkillMatch[]> {
  void taskType;
  try {
    const hits = await semanticSearchSkills(query, limit);
    const results: SkillMatch[] = [];
    for (const hit of hits) {
      const local = getLocalSkillByName(hit.name, novelId);
      if (local) {
        results.push({ skill: local, score: hit.score });
        continue;
      }
      try {
        const detail = await getSkill(hit.name);
        if ('error' in detail) continue;
        const meta = (detail.metadata || {}) as Record<string, unknown>;
        const imported = sanitizeSkill({
          id: `imported-${hit.name}`,
          name: String(meta.name ?? hit.name),
          description: String(meta.description ?? ''),
          version: String(meta.version ?? '1.0.0'),
          enabled: true,
          scope: 'global',
          taskTypes: Array.isArray(meta.task_types) ? meta.task_types.map(String) : [],
          triggers: Array.isArray(meta.trigger_keywords) ? meta.trigger_keywords.map(String) : [],
          allowedTools: Array.isArray(meta.allowed_tools) ? meta.allowed_tools.map(String) : [],
          instructions: detail.content || '',
          source: 'imported',
          updatedAt: new Date().toISOString(),
        });
        if (imported) results.push({ skill: imported, score: hit.score });
      } catch {
        // 单个 skill 拉取失败时跳过，继续处理后续命中
      }
    }
    return results;
  } catch {
    return [];
  }
}
