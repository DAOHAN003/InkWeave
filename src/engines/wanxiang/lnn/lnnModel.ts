/**
 * 液态神经网络（LNN / CfC）推理引擎 —— 纯 TS 移植。
 *
 * 公式（对齐 universe_rust/crates/lnn/src/neuron.rs，RK4 定步长）：
 *   dx_i/dt = -x_i/τ_i + tanh(Σ_j W_ij·x_j + Σ_k W_in_ik·I_k + b_i)
 *   隐藏输出 h_i = tanh(x_i + b_i)
 *   输出层线性 y_i = b_out_i + Σ_j W_out_ij · h_j
 * 初始状态 x = 0，dt=0.05, T=1.0（20 步）。cosmic_lnn_export v1 格式。
 */

export interface LnnNeuron {
  tau: number;
  bias: number;
  activation: string;
}

export interface LnnLayer {
  neurons: LnnNeuron[];
  /** 递归权重 [hid][hid] */
  weights: number[][];
  /** 输入权重 [hid][n_inputs] */
  input_weights: number[][];
}

export interface LnnModel {
  format: string;
  format_version: number;
  meta: {
    n_inputs: number;
    n_outputs: number;
    hidden_sizes: number[];
    solver: { dt: number; integration_time: number };
    [k: string]: unknown;
  };
  layers: LnnLayer[];
  output: {
    /** [n_outputs][hid] */
    weights: number[][];
    bias: number[];
  };
}

function act(x: number): number {
  return Math.tanh(x);
}

/** 单步 RK4：给定当前隐藏态 x 与输入 I，返回下一步 x。 */
function rk4Step(
  x: number[],
  I: number[],
  W: number[][],
  Win: number[][],
  tau: number[],
  bias: number[],
  dt: number,
): number[] {
  const n = x.length;
  const f = (xx: number[]): number[] => {
    const dx = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let net = bias[i];
      const Wi = W[i];
      const Wini = Win[i];
      for (let j = 0; j < n; j++) net += Wi[j] * xx[j];
      for (let k = 0; k < I.length; k++) net += Wini[k] * I[k];
      dx[i] = -xx[i] / tau[i] + act(net);
    }
    return dx;
  };
  const k1 = f(x);
  const x2 = x.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = f(x2);
  const x3 = x.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = f(x3);
  const x4 = x.map((v, i) => v + dt * k3[i]);
  const k4 = f(x4);
  return x.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/** 跑一次前向：输入 16 维特征，输出 n_outputs 维。 */
export function runLnnModel(model: LnnModel, input: number[]): number[] {
  const meta = model.meta;
  const lay = model.layers[0];
  const neu = lay.neurons;
  const W = lay.weights;
  const Win = lay.input_weights;
  const Wout = model.output.weights;
  const bout = model.output.bias ?? new Array<number>(meta.n_outputs).fill(0);

  const dt = meta.solver.dt;
  const T = meta.solver.integration_time;
  const hid = neu.length;
  const nOut = meta.n_outputs;

  const tau = neu.map((nn) => nn.tau);
  const bias = neu.map((nn) => nn.bias);

  let x = new Array<number>(hid).fill(0);
  const steps = Math.round(T / dt);
  for (let s = 0; s < steps; s++) {
    x = rk4Step(x, input, W, Win, tau, bias, dt);
  }

  const h = x.map((v, i) => act(v + bias[i]));

  const out: number[] = [];
  for (let i = 0; i < nOut; i++) {
    let acc = bout[i] ?? 0;
    const Wouti = Wout[i] ?? [];
    for (let j = 0; j < hid; j++) acc += (Wouti[j] ?? 0) * h[j];
    out.push(acc);
  }
  return out;
}
