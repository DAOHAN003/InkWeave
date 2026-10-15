"""校验 universe_rust 导出的 cosmic_lnn_export 小说 LNN 模型（正确 RK4 真公式）。

真公式（源码 crates/lnn/src/neuron.rs + model_exporter.rs 确认）：
  dx_i/dt = -x_i/tau_i + tanh( sum_j W_ij*x_j + sum_k W_in_ik*I_k + b_i )
  隐藏输出 hidden_i = tanh(x_i + b_i)
  输出 y_i = b_out_i + sum_j W_out_ij * hidden_j        # W_out 形状 [n_out, hid]
  初始 state=0；定步长 RK4，dt=0.05，T=1.0（20 步）；输出层线性（勿漏 output.bias）。
注意：非 CfC 形式 dx/dt=(1/tau)(tanh-x)，那会差 tau 因子导致幅度错。
"""
import json, os, math, random

BASE = r'E:/宇宙模拟整合版/universe_rust/exported_models'
FILES = [
    'model_novel_tension_guard.json',
    'model_novel_ai_score.json',
    'model_novel_style_modulator.json',
]

def act(x):
    return math.tanh(x)

def rk4_step(x, I, W, Win, tau, bias, dt):
    n = len(x)
    def f(xx):
        dx = [0.0] * n
        for i in range(n):
            net = bias[i]
            for j in range(n):
                net += W[i][j] * xx[j]
            for k in range(len(I)):
                net += Win[i][k] * I[k]
            dx[i] = -xx[i] / tau[i] + act(net)
        return dx
    k1 = f(x)
    x2 = [x[i] + 0.5 * dt * k1[i] for i in range(n)]
    k2 = f(x2)
    x3 = [x[i] + 0.5 * dt * k2[i] for i in range(n)]
    k3 = f(x3)
    x4 = [x[i] + dt * k3[i] for i in range(n)]
    k4 = f(x4)
    return [x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(n)]

def forward(d, x):
    meta = d['meta']
    lay = d['layers'][0]
    neu = lay['neurons']
    W = lay['weights']
    Win = lay['input_weights']
    Wout = d['output']['weights']
    bout = d['output'].get('bias', [0.0] * meta['n_outputs'])
    dt = meta['solver']['dt']
    T = meta['solver']['integration_time']
    hid = len(neu)
    n_out = meta['n_outputs']
    tau = [n['tau'] for n in neu]
    bias = [n['bias'] for n in neu]
    xv = [0.0] * hid
    steps = int(round(T / dt))
    for _ in range(steps):
        xv = rk4_step(xv, x, W, Win, tau, bias, dt)
    h = [act(xv[i] + bias[i]) for i in range(hid)]
    return [bout[i] + sum(Wout[i][j] * h[j] for j in range(hid)) for i in range(n_out)]

def check(name):
    d = json.load(open(os.path.join(BASE, name), encoding='utf-8'))
    n_in = d['meta']['n_inputs']
    n_out = d['meta']['n_outputs']
    print('=' * 64)
    print(name, '(scenario=%s, out=%d)' % (d['meta']['scenario'], n_out))
    print('  output.bias present:', 'bias' in d['output'])
    random.seed(7)
    outs = [forward(d, [random.uniform(-1, 1) for _ in range(n_in)]) for _ in range(40)]
    flat = [o[i] for o in outs for i in range(n_out)]
    mean = sum(flat) / len(flat)
    var = sum((f - mean) ** 2 for f in flat) / len(flat)
    ranges = [(min(o[i] for o in outs), max(o[i] for o in outs)) for i in range(n_out)]
    print('  随机40次 输出总方差=%.4f' % var)
    print('  各输出维范围:', ['%.2f~%.2f' % (a, b) for a, b in ranges])
    base = [0.0] * n_in
    sweep = []
    for v in [-2, -1, 0, 1, 2]:
        x = list(base)
        x[0] = v
        sweep.append(forward(d, x))
    tot = abs(sweep[-1][0] - sweep[0][0])
    print('  扫x0:-2->2 output[0] 总移=%.3f' % tot)
    dist = len(set(round(o[0], 3) for o in outs))
    print('  区分度 output[0] 去重 %d/40' % dist)
    print('  判断:', 'LIVE (RK4真公式) ✓' if (var > 1e-4 and tot > 1e-3) else 'DEAD ✗')

if __name__ == '__main__':
    for f in FILES:
        check(f)
