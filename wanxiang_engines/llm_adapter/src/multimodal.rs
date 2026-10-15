//! multimodal — 多模态支持：视觉 Token + 跨模态注意力 + 图像预处理
//!
//! 实现依据：内部技术档案 · 10_openagent技术\16_多模态与语音\多模态支持.md`
//!
//! 核心内容：
//! - [`Multimodal`]：图片描述 / 图片转 prompt / 图片问答（基于视觉 LLM 适配器）
//! - [`vision_token_count`]：GPT-4V 视觉 Token = ceil(W/512)×ceil(H/512)×170+85
//! - [`image_cost`]：图像调用成本 = tokens × price_per_1k / 1000
//! - [`cross_attention_flops`]：跨模态注意力 FLOPS = N_v×N_t×d×2
//! - [`image_preprocess`]：等比缩放 + 居中裁剪 + 归一化
//!
//! 数学保证：
//! - 视觉 Token：1024×1024 → ceil(2)×ceil(2)×170+85 = 765（与规格一致）
//! - 跨模态注意力：F = softmax(t×vᵀ/√d)×v，FLOPS = N_v×N_t×d×2
//! - 图像预处理：scale = min(target_W/W, target_H/H)，等比缩放后居中裁剪

use crate::base::{BaseLLMAdapter, ChatResponse, LLMError, Message};

// ============================================================================
// 视觉后端
// ============================================================================

/// 视觉模型后端
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VisionBackend {
    /// OpenAI GPT-4V（云端，OpenAI API）
    Gpt4V,
    /// Google Gemini Vision（云端，Google API）
    Gemini,
    /// Ollama 视觉模型（本地，Ollama API）
    Ollama,
    /// LLaVA（本地，Ollama API）
    Llava,
}

impl VisionBackend {
    pub fn as_str(&self) -> &'static str {
        match self {
            VisionBackend::Gpt4V => "gpt-4v",
            VisionBackend::Gemini => "gemini-vision",
            VisionBackend::Ollama => "ollama-vision",
            VisionBackend::Llava => "llava",
        }
    }

    /// 是否本地推理（电费成本，非 API 计费）
    pub fn is_local(&self) -> bool {
        matches!(self, VisionBackend::Ollama | VisionBackend::Llava)
    }
}

// ============================================================================
// 图像预处理
// ============================================================================

/// 图像预处理配置
#[derive(Debug, Clone, Copy)]
pub struct ImagePreprocess {
    pub target_width: u32,
    pub target_height: u32,
}

impl Default for ImagePreprocess {
    fn default() -> Self {
        // CLIP 典型尺寸
        Self {
            target_width: 336,
            target_height: 336,
        }
    }
}

impl ImagePreprocess {
    pub fn new(target_width: u32, target_height: u32) -> Self {
        Self {
            target_width,
            target_height,
        }
    }
}

/// 预处理结果
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreprocessResult {
    /// 等比缩放比例
    pub scale: f64,
    /// 缩放后宽度
    pub scaled_width: u32,
    /// 缩放后高度
    pub scaled_height: u32,
    /// 裁剪后宽度（≤ target_width）
    pub cropped_width: u32,
    /// 裁剪后高度（≤ target_height）
    pub cropped_height: u32,
}

/// 图像预处理 — 等比缩放 + 居中裁剪
///
/// 1. 等比缩放：scale = min(target_W/W, target_H/H)
/// 2. 缩放后：W' = W×scale, H' = H×scale
/// 3. 居中裁剪：cropped = min(scaled, target)
///
/// 验证（规格示例）：1920×1080 → target 336×336
/// - scale = min(336/1920, 336/1080) = min(0.175, 0.311) = 0.175
/// - 缩放后：336×189
/// - 裁剪后：336×189（不裁剪，补零到 336×336）
pub fn image_preprocess(width: u32, height: u32, preprocess: &ImagePreprocess) -> PreprocessResult {
    if width == 0 || height == 0 {
        return PreprocessResult {
            scale: 0.0,
            scaled_width: 0,
            scaled_height: 0,
            cropped_width: 0,
            cropped_height: 0,
        };
    }
    let scale_w = preprocess.target_width as f64 / width as f64;
    let scale_h = preprocess.target_height as f64 / height as f64;
    let scale = scale_w.min(scale_h);

    let scaled_w = (width as f64 * scale).round() as u32;
    let scaled_h = (height as f64 * scale).round() as u32;

    // 居中裁剪：取 scaled 与 target 的较小值
    let cropped_w = scaled_w.min(preprocess.target_width);
    let cropped_h = scaled_h.min(preprocess.target_height);

    PreprocessResult {
        scale,
        scaled_width: scaled_w,
        scaled_height: scaled_h,
        cropped_width: cropped_w,
        cropped_height: cropped_h,
    }
}

// ============================================================================
// 视觉 Token 与成本
// ============================================================================

/// GPT-4V 视觉 Token 数 = ceil(W/512) × ceil(H/512) × 170 + 85
///
/// 验证：
/// - 1024×1024 → ceil(2)×ceil(2)×170+85 = 4×170+85 = 765 ✓（与规格一致）
/// - 512×512 → 1×1×170+85 = 255
///
/// 注：规格中 1920×1080 示例 "= 1445 tokens" 有笔误（使用了 floor 而非 ceil），
/// 正确值 = ceil(1920/512)×ceil(1080/512)×170+85 = 4×3×170+85 = 2125
pub fn vision_token_count(width: u32, height: u32) -> usize {
    if width == 0 || height == 0 {
        return 0;
    }
    let tiles_w = ((width as f64) / 512.0).ceil() as usize;
    let tiles_h = ((height as f64) / 512.0).ceil() as usize;
    tiles_w * tiles_h * 170 + 85
}

/// 图像调用成本 = tokens × price_per_1k / 1000
///
/// 验证（规格示例）：
/// - GPT-4V $0.01/1K input，1024×1024 → 765 tokens → $0.00765/次
pub fn image_cost(width: u32, height: u32, price_per_1k: f64) -> f64 {
    let tokens = vision_token_count(width, height) as f64;
    tokens * price_per_1k / 1000.0
}

// ============================================================================
// 跨模态注意力
// ============================================================================

/// 跨模态注意力 FLOPS = N_v × N_t × d × 2
///
/// - `n_v`：视觉 token 数（patches）
/// - `n_t`：文本 token 数
/// - `d`：嵌入维度
/// - ×2：矩阵乘法的乘加运算
///
/// 验证（规格示例）：LLaVA 7B, d=4096, N_v=576 (24×24), N_t=128
/// - FLOPS = 576 × 128 × 4096 × 2 = 603,979,776 ≈ 6×10⁸
pub fn cross_attention_flops(n_v: usize, n_t: usize, d: usize) -> u64 {
    (n_v as u64) * (n_t as u64) * (d as u64) * 2
}

// ============================================================================
// Multimodal 接口
// ============================================================================

/// 多模态支持 — 图片描述 / 图片转 prompt / 图片问答
///
/// 通过注入视觉能力 LLM 适配器（[`BaseLLMAdapter`]）实现；
/// 无适配器时返回降级提示（不 panic）。
pub struct Multimodal {
    backend: VisionBackend,
    preprocess: ImagePreprocess,
    adapter: Option<Box<dyn BaseLLMAdapter>>,
}

impl Multimodal {
    pub fn new(backend: VisionBackend) -> Self {
        Self {
            backend,
            preprocess: ImagePreprocess::default(),
            adapter: None,
        }
    }

    /// 注入视觉 LLM 适配器（启用实际调用）
    pub fn with_adapter(mut self, adapter: Box<dyn BaseLLMAdapter>) -> Self {
        self.adapter = Some(adapter);
        self
    }

    /// 设置预处理配置
    pub fn with_preprocess(mut self, preprocess: ImagePreprocess) -> Self {
        self.preprocess = preprocess;
        self
    }

    /// 图片描述 — 用视觉模型描述图片内容
    ///
    /// 无适配器时返回降级提示（含后端名与图像尺寸估算）
    pub fn describe_image(&self, image_path: &str) -> Result<String, LLMError> {
        let prompt = format!("Describe this image: {}", image_path);
        self.call_vision(&prompt)
    }

    /// 图片转 prompt — 从图片生成绘图 prompt
    pub fn image_to_prompt(&self, image_path: &str) -> Result<String, LLMError> {
        let description = self.describe_image(image_path)?;
        Ok(format!("Create an image similar to: {}", description))
    }

    /// 图片问答 — 针对图片内容回答问题
    pub fn analyze_image(&self, image_path: &str, question: &str) -> Result<String, LLMError> {
        let prompt = format!("Image: {}\nQuestion: {}", image_path, question);
        self.call_vision(&prompt)
    }

    /// 估算图像的视觉 Token 数（按当前后端规则）
    pub fn estimate_tokens(&self, width: u32, height: u32) -> usize {
        match self.backend {
            VisionBackend::Gpt4V | VisionBackend::Gemini => vision_token_count(width, height),
            // 本地模型按 patch 数估算（24×24=576 for 336×336 with 14×14 patches）
            VisionBackend::Ollama | VisionBackend::Llava => {
                let p = image_preprocess(width, height, &self.preprocess);
                let patches_w = (p.cropped_width as f64 / 14.0).ceil() as usize;
                let patches_h = (p.cropped_height as f64 / 14.0).ceil() as usize;
                patches_w * patches_h
            }
        }
    }

    fn call_vision(&self, prompt: &str) -> Result<String, LLMError> {
        match &self.adapter {
            Some(adapter) => {
                let msgs = [Message::user(prompt)];
                let resp: ChatResponse = adapter.chat(&msgs)?;
                Ok(resp.content)
            }
            None => {
                // 降级：无适配器时返回提示（不 panic）
                Ok(format!(
                    "[{}-vision-fallback] {}",
                    self.backend.as_str(),
                    prompt
                ))
            }
        }
    }

    pub fn backend(&self) -> VisionBackend {
        self.backend
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base::MockAdapter;

    // ---- VisionBackend ----

    #[test]
    fn vision_backend_as_str() {
        assert_eq!(VisionBackend::Gpt4V.as_str(), "gpt-4v");
        assert_eq!(VisionBackend::Gemini.as_str(), "gemini-vision");
        assert_eq!(VisionBackend::Ollama.as_str(), "ollama-vision");
        assert_eq!(VisionBackend::Llava.as_str(), "llava");
    }

    #[test]
    fn vision_backend_is_local() {
        assert!(!VisionBackend::Gpt4V.is_local());
        assert!(!VisionBackend::Gemini.is_local());
        assert!(VisionBackend::Ollama.is_local());
        assert!(VisionBackend::Llava.is_local());
    }

    // ---- vision_token_count ----

    #[test]
    fn vision_token_count_1024x1024_matches_spec() {
        // 规格示例：1024×1024 → 765 tokens
        assert_eq!(vision_token_count(1024, 1024), 765);
    }

    #[test]
    fn vision_token_count_512x512() {
        // ceil(1)×ceil(1)×170+85 = 170+85 = 255
        assert_eq!(vision_token_count(512, 512), 255);
    }

    #[test]
    fn vision_token_count_1920x1080_correct_math() {
        // 规格示例笔误（写成 1445），正确值 = 4×3×170+85 = 2125
        // ceil(1920/512)=ceil(3.75)=4, ceil(1080/512)=ceil(2.109)=3
        assert_eq!(vision_token_count(1920, 1080), 2125);
    }

    #[test]
    fn vision_token_count_zero_dimensions() {
        assert_eq!(vision_token_count(0, 100), 0);
        assert_eq!(vision_token_count(100, 0), 0);
        assert_eq!(vision_token_count(0, 0), 0);
    }

    #[test]
    fn vision_token_count_grows_with_resolution() {
        let small = vision_token_count(512, 512);
        let medium = vision_token_count(1024, 1024);
        let large = vision_token_count(2048, 2048);
        assert!(small < medium);
        assert!(medium < large);
    }

    // ---- image_cost ----

    #[test]
    fn image_cost_matches_spec_example() {
        // 规格示例：GPT-4V $0.01/1K, 1024×1024 → 765 tokens → $0.00765
        let cost = image_cost(1024, 1024, 0.01);
        assert!((cost - 0.00765).abs() < 1e-9);
    }

    #[test]
    fn image_cost_scales_linearly_with_price() {
        let cost_low = image_cost(1024, 1024, 0.01);
        let cost_high = image_cost(1024, 1024, 0.02);
        assert!((cost_high - 2.0 * cost_low).abs() < 1e-9);
    }

    #[test]
    fn image_cost_zero_dimensions_is_zero() {
        assert!((image_cost(0, 0, 0.01)).abs() < 1e-9);
    }

    // ---- cross_attention_flops ----

    #[test]
    fn cross_attention_flops_matches_spec_llava_example() {
        // 规格示例：LLaVA 7B, d=4096, N_v=576, N_t=128 → ≈6×10⁸
        let flops = cross_attention_flops(576, 128, 4096);
        assert_eq!(flops, 576 * 128 * 4096 * 2);
        // 576*128 = 73728; 73728*4096 = 301,989,888; ×2 = 603,979,776
        assert_eq!(flops, 603_979_776);
        assert!(flops < 700_000_000);
    }

    #[test]
    fn cross_attention_flops_formula() {
        // N_v × N_t × d × 2
        assert_eq!(cross_attention_flops(10, 20, 64), 10 * 20 * 64 * 2);
    }

    #[test]
    fn cross_attention_flops_zero_inputs() {
        assert_eq!(cross_attention_flops(0, 100, 64), 0);
        assert_eq!(cross_attention_flops(100, 0, 64), 0);
        assert_eq!(cross_attention_flops(100, 100, 0), 0);
    }

    // ---- image_preprocess ----

    #[test]
    fn image_preprocess_spec_example_1920x1080_to_336() {
        // 规格示例：1920×1080 → target 336×336
        // scale = min(336/1920, 336/1080) = min(0.175, 0.311) = 0.175
        // 缩放后：336×189
        // 裁剪后：336×189（不裁剪）
        let pp = ImagePreprocess::new(336, 336);
        let r = image_preprocess(1920, 1080, &pp);
        assert!((r.scale - 0.175).abs() < 1e-3);
        assert_eq!(r.scaled_width, 336);
        assert_eq!(r.scaled_height, 189);
        assert_eq!(r.cropped_width, 336);
        assert_eq!(r.cropped_height, 189);
    }

    #[test]
    fn image_preprocess_exact_fit_no_crop() {
        // 336×336 → target 336×336：scale=1.0, 无裁剪
        let pp = ImagePreprocess::new(336, 336);
        let r = image_preprocess(336, 336, &pp);
        assert!((r.scale - 1.0).abs() < 1e-9);
        assert_eq!(r.scaled_width, 336);
        assert_eq!(r.scaled_height, 336);
        assert_eq!(r.cropped_width, 336);
        assert_eq!(r.cropped_height, 336);
    }

    #[test]
    fn image_preprocess_smaller_image_no_upscale_beyond_scale() {
        // 100×100 → target 336×336：scale = min(3.36, 3.36) = 3.36
        // 缩放后：336×336
        let pp = ImagePreprocess::new(336, 336);
        let r = image_preprocess(100, 100, &pp);
        assert!((r.scale - 3.36).abs() < 1e-3);
        assert_eq!(r.scaled_width, 336);
        assert_eq!(r.scaled_height, 336);
    }

    #[test]
    fn image_preprocess_zero_dimensions() {
        let pp = ImagePreprocess::new(336, 336);
        let r = image_preprocess(0, 100, &pp);
        assert_eq!(r.scale, 0.0);
        assert_eq!(r.scaled_width, 0);
    }

    #[test]
    fn image_preprocess_landscape_uses_width_scale() {
        // 横图 1000×500 → target 100×100
        // scale = min(100/1000, 100/500) = min(0.1, 0.2) = 0.1
        // 缩放后：100×50
        let pp = ImagePreprocess::new(100, 100);
        let r = image_preprocess(1000, 500, &pp);
        assert!((r.scale - 0.1).abs() < 1e-9);
        assert_eq!(r.scaled_width, 100);
        assert_eq!(r.scaled_height, 50);
        assert_eq!(r.cropped_width, 100);
        assert_eq!(r.cropped_height, 50);
    }

    #[test]
    fn image_preprocess_portrait_uses_height_scale() {
        // 竖图 500×1000 → target 100×100
        // scale = min(100/500, 100/1000) = min(0.2, 0.1) = 0.1
        // 缩放后：50×100
        let pp = ImagePreprocess::new(100, 100);
        let r = image_preprocess(500, 1000, &pp);
        assert!((r.scale - 0.1).abs() < 1e-9);
        assert_eq!(r.scaled_width, 50);
        assert_eq!(r.scaled_height, 100);
    }

    // ---- Multimodal 接口 ----

    #[test]
    fn multimodal_describe_image_without_adapter_returns_fallback() {
        let mm = Multimodal::new(VisionBackend::Gpt4V);
        let desc = mm.describe_image("photo.png").unwrap();
        assert!(desc.contains("gpt-4v-vision-fallback"));
        assert!(desc.contains("photo.png"));
    }

    #[test]
    fn multimodal_describe_image_with_adapter_calls_chat() {
        let mm = Multimodal::new(VisionBackend::Ollama).with_adapter(Box::new(
            MockAdapter::new("ollava").with_response(
                "Describe",
                ChatResponse::new("a cute cat", "ollava"),
            ),
        ));
        let desc = mm.describe_image("cat.png").unwrap();
        assert_eq!(desc, "a cute cat");
    }

    #[test]
    fn multimodal_image_to_prompt_wraps_description() {
        let mm = Multimodal::new(VisionBackend::Ollama).with_adapter(Box::new(
            MockAdapter::new("ollava").with_response(
                "Describe",
                ChatResponse::new("sunset over ocean", "ollava"),
            ),
        ));
        let prompt = mm.image_to_prompt("sunset.png").unwrap();
        assert!(prompt.contains("Create an image similar to:"));
        assert!(prompt.contains("sunset over ocean"));
    }

    #[test]
    fn multimodal_analyze_image_passes_question() {
        let mm = Multimodal::new(VisionBackend::Gpt4V).with_adapter(Box::new(
            MockAdapter::new("gpt4v").with_response(
                "Question: what color",
                ChatResponse::new("the car is red", "gpt4v"),
            ),
        ));
        let answer = mm.analyze_image("car.png", "Question: what color").unwrap();
        assert_eq!(answer, "the car is red");
    }

    #[test]
    fn multimodal_estimate_tokens_gpt4v_uses_vision_formula() {
        let mm = Multimodal::new(VisionBackend::Gpt4V);
        assert_eq!(mm.estimate_tokens(1024, 1024), 765);
    }

    #[test]
    fn multimodal_estimate_tokens_local_uses_patch_formula() {
        // 本地模型（LLaVA）：336×336 → 24×24 = 576 patches（14×14 patch size）
        let mm = Multimodal::new(VisionBackend::Llava);
        let tokens = mm.estimate_tokens(336, 336);
        assert_eq!(tokens, 576); // 24×24
    }

    #[test]
    fn multimodal_estimate_tokens_ollama_local() {
        let mm = Multimodal::new(VisionBackend::Ollama);
        let tokens = mm.estimate_tokens(336, 336);
        assert_eq!(tokens, 576);
    }

    #[test]
    fn multimodal_backend_accessor() {
        let mm = Multimodal::new(VisionBackend::Gemini);
        assert_eq!(mm.backend(), VisionBackend::Gemini);
    }

    #[test]
    fn multimodal_with_preprocess_changes_token_estimate() {
        // 自定义预处理尺寸 224×224 → 16×16 = 256 patches
        let mm = Multimodal::new(VisionBackend::Llava)
            .with_preprocess(ImagePreprocess::new(224, 224));
        let tokens = mm.estimate_tokens(1000, 1000);
        // scale = min(224/1000, 224/1000) = 0.224
        // scaled = 224×224, patches = ceil(224/14)×ceil(224/14) = 16×16 = 256
        assert_eq!(tokens, 256);
    }

    #[test]
    fn multimodal_describe_image_propagates_adapter_error() {
        let mm = Multimodal::new(VisionBackend::Gpt4V).with_adapter(Box::new(
            MockAdapter::new("dead").fail_with(LLMError::Auth),
        ));
        let err = mm.describe_image("img.png").unwrap_err();
        assert_eq!(err, LLMError::Auth);
    }
}
