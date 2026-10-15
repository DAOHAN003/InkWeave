"""真实区分探针：用 feature.rs 的 16 维特征 + RK4 真公式，验证三个 LNN 模型
能否区分「人写」与「AI 写」正文。特征提取严格对齐 universe_rust/crates/novel_style/src/feature.rs。
"""
import json, os, math

BASE = r'E:/宇宙模拟整合版/universe_rust/exported_models'
FILES = {
    'ai_score': 'model_novel_ai_score.json',
    'tension_guard': 'model_novel_tension_guard.json',
    'style_modulator': 'model_novel_style_modulator.json',
}

# ── 严格对齐 feature.rs 的词表与逻辑 ────────────────────────────
CONNECTIVES = ["但是","然而","因此","所以","然后","此外","同时","总之","首先","其次",
               "最后","最终","尽管","虽然","而且","并且","不过","从而","进而","综上","再者"]
TRANSITIONS = ["可是","不过","却","但","偏偏","反而","倒也"]
STACKED_ADJ = ["非常","十分","极其","无比","格外","异常","特别","极为","相当","深深",
               "缓缓","渐渐","轻轻","默默","如此","这般","那样","十分地","深深地"]
POSITIVE = ["笑","喜","乐","爱","暖","美","明亮","高兴","温暖","感动","幸福","希望",
            "温柔","欢快","美好"]
NEGATIVE = ["哭","痛","恨","冷","暗","恐惧","悲伤","孤独","绝望","愤怒","疲惫","压抑",
            "颤抖","心碎","痛苦","冰冷"]

def extract_features(text):
    feats = [0.0]*16
    if not text.strip():
        return feats
    paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
    n_para = max(1, len(paragraphs))
    sentences = []
    for p in paragraphs:
        cur = ''
        for ch in p:
            cur += ch
            if ch in '。！？…；!':
                if cur.strip():
                    sentences.append(cur.strip())
                cur = ''
        if cur.strip():
            sentences.append(cur.strip())
    n_sent = max(1, len(sentences))
    lens = []
    conn = trans = stack = ell = excl = 0
    diag = pos = neg = num = 0
    parallel = 0
    prev_start = None
    full = ''.join(paragraphs)
    for s in sentences:
        st = s.strip()
        lens.append(len(st))
        for w in CONNECTIVES:
            if w in st: conn += 1
        for w in TRANSITIONS:
            if w in st: trans += 1
        for w in STACKED_ADJ:
            if w in st: stack += 1
        if '…' in st or '——' in st or '—' in st: ell += 1
        for c in st:
            if c in '！？!': excl += 1
            if c.isascii() and c.isdigit(): num += 1
        start = ''.join([c for c in st if not c.isspace()][:2])
        if start and prev_start is not None and prev_start == start:
            parallel += 1
        prev_start = start
        for w in POSITIVE:
            if w in st: pos += 1
        for w in NEGATIVE:
            if w in st: neg += 1
    # 对话字符数
    for p in paragraphs:
        for i, ch in enumerate(p):
            if ch in '“「"':
                rest = list(p[i:])
                d = next((k for k, c in enumerate(rest) if c in '”」"'), None)
                if d is not None:
                    diag += d
    mean_len = sum(lens)/len(lens) if lens else 0.0
    std_len = 0.0
    if len(lens) >= 2:
        var = sum((l-mean_len)**2 for l in lens)/len(lens)
        std_len = math.sqrt(var)
    short_frac = sum(1 for l in lens if l < 8)/n_sent
    long_frac = sum(1 for l in lens if l > 32)/n_sent
    chars = [c for c in full if not c.isspace()]
    seen = set(chars)
    char_total = max(1, len(chars))
    ttr = len(seen)/char_total
    repeat_bigram = 0.0
    if len(chars) >= 4:
        pairs = {}
        total = 0
        for a, b in zip(chars, chars[1:]):
            k = a+b
            pairs[k] = pairs.get(k, 0)+1
            total += 1
        repeat_bigram = 1.0 - len(pairs)/max(1, total)
    emotion = abs(pos-neg)/max(1.0, n_sent)
    feats[0] = mean_len/50.0
    feats[1] = std_len/20.0
    feats[2] = short_frac
    feats[3] = long_frac
    feats[4] = conn/n_sent
    feats[5] = trans/n_sent
    feats[6] = stack/n_sent
    feats[7] = ttr
    feats[8] = repeat_bigram
    feats[9] = diag/char_total
    feats[10] = emotion
    feats[11] = ell/n_sent
    feats[12] = parallel/max(1.0, n_sent)
    feats[13] = num/char_total
    feats[14] = 0.0
    if n_para > 1:
        pl = [len(p) for p in paragraphs]
        pm = sum(pl)/n_para
        var = sum((l-pm)**2 for l in pl)/n_para
        feats[14] = math.sqrt(var)/max(1.0, pm)
    feats[15] = excl/n_sent
    feats = [min(f, 1.5) for f in feats]
    return feats

def act(x): return math.tanh(x)

def rk4_step(x, I, W, Win, tau, bias, dt):
    n = len(x)
    def f(xx):
        dx = [0.0]*n
        for i in range(n):
            net = bias[i]
            for j in range(n): net += W[i][j]*xx[j]
            for k in range(len(I)): net += Win[i][k]*I[k]
            dx[i] = -xx[i]/tau[i] + act(net)
        return dx
    k1 = f(x)
    x2 = [x[i]+0.5*dt*k1[i] for i in range(n)]
    k2 = f(x2)
    x3 = [x[i]+0.5*dt*k2[i] for i in range(n)]
    k3 = f(x3)
    x4 = [x[i]+dt*k3[i] for i in range(n)]
    k4 = f(x4)
    return [x[i]+(dt/6)*(k1[i]+2*k2[i]+2*k3[i]+k4[i]) for i in range(n)]

def forward(d, x):
    meta = d['meta']; lay = d['layers'][0]; neu = lay['neurons']
    W = lay['weights']; Win = lay['input_weights']; Wout = d['output']['weights']
    bout = d['output'].get('bias', [0.0]*meta['n_outputs'])
    dt = meta['solver']['dt']; T = meta['solver']['integration_time']
    hid = len(neu); n_out = meta['n_outputs']
    tau = [n['tau'] for n in neu]; bias = [n['bias'] for n in neu]
    xv = [0.0]*hid
    for _ in range(int(round(T/dt))):
        xv = rk4_step(xv, x, W, Win, tau, bias, dt)
    h = [act(xv[i]+bias[i]) for i in range(hid)]
    return [bout[i]+sum(Wout[i][j]*h[j] for j in range(hid)) for i in range(n_out)]

MODELS = {k: json.load(open(os.path.join(BASE, v), encoding='utf-8')) for k, v in FILES.items()}

# ── 测试样本：人写 vs AI 写（贴合 feature.rs 自带测试的样本形态）──
HUMAN = [
    "她没说话。\n过了很久。\n“你走吧。”她轻声说。\n窗外的雨还在下。……\n他忽然笑了。\n“傻子。”\n风把灯吹灭了。",
    "我回头看了一眼。\n巷子空空的。\n“别跟着我。”\n脚步声停了。\n……其实我有点怕。",
]
AI = [
    "然而，这个决定最终导致了极为复杂的后果，因此我们不得不重新审视整个问题。而且，与此同时，另一个重要的因素也开始逐渐显现，并且深刻地改变了整个格局。总之，尽管面临诸多困难，我们依然必须坚定地朝着正确的方向前进。",
    "首先，需要明确的是，这一现象本质上反映了某种深层次的结构性矛盾。其次，从发展的角度来看，相关的变量之间存在着极其密切的关联。最后，基于上述分析，我们可以得出一个相当清晰的结论。",
]

NAMES = ["mean_sent_len","std_sent_len","short_frac","long_frac","connective","transition",
         "stacked_adj","ttr","repeat_bigram","dialogue","emotion","ellipsis","parallel",
         "num","para_std","exclaim"]

def avg_feats(samples):
    fs = [extract_features(s) for s in samples]
    return [sum(f[i] for f in fs)/len(fs) for i in range(16)]

print("="*70)
print("特征层分离（人写 vs AI写 平均 16 维）")
h_avg = avg_feats(HUMAN); a_avg = avg_feats(AI)
print("%-14s %8s %8s %8s" % ("feature","human","ai","Δ(ai-h)"))
for i in range(16):
    print("%-14s %8.3f %8.3f %8.3f" % (NAMES[i], h_avg[i], a_avg[i], a_avg[i]-h_avg[i]))

print("\n" + "="*70)
print("模型层分离（每个样本跑前向，ai_score 越高=越像 AI）")
for mname, d in MODELS.items():
    print("\n--- %s (out=%d) ---" % (mname, d['meta']['n_outputs']))
    h_scores = [forward(d, extract_features(s)) for s in HUMAN]
    a_scores = [forward(d, extract_features(s)) for s in AI]
    hm = [sum(o[i] for o in h_scores)/len(h_scores) for i in range(d['meta']['n_outputs'])]
    am = [sum(o[i] for o in a_scores)/len(a_scores) for i in range(d['meta']['n_outputs'])]
    print("  HUMAN 输出: %s" % [round(v,3) for v in hm])
    print("  AI    输出: %s" % [round(v,3) for v in am])
    gap = [am[i]-hm[i] for i in range(d['meta']['n_outputs'])]
    print("  GAP (ai-human): %s" % [round(g,3) for g in gap])
    if mname == 'ai_score':
        verdict = "✓ ai_score 能区分 AI 写（AI样本分显著更高）" if gap[0] > 0.05 else (
                  "✗ ai_score 未能区分（或方向相反）")
        print("  判定:", verdict)
