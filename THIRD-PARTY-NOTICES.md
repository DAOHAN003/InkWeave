# 第三方开源声明（Third-Party Notices）

墨织 InkWeave（以下简称"本软件"）在构建和运行时使用了以下第三方开源组件。本软件对这些项目的作者与社区表示感谢。

每个组件的版权归其各自的版权持有人所有，并按其各自的许可证条款授权使用。下面列出本软件分发产物中包含的主要运行时依赖；完整的依赖树及其传递依赖的许可证，以各自仓库及 `node_modules` / `Cargo` 中随附的许可证文件为准。

---

## 运行时依赖（Runtime Dependencies）

| 组件 | 版本 | 许可证 | 版权 |
| --- | --- | --- | --- |
| [Ant Design Icons](https://github.com/ant-design/ant-design-icons) | 6.2.5 | MIT | © 2018-present Ant UED, https://xtech.antfin.com/ |
| [Tauri](https://github.com/tauri-apps/tauri)（含 `@tauri-apps/api`） | 1.x / 1.6.0 | Apache-2.0 OR MIT | © 2017 - Present Tauri Apps Contributors |
| [React](https://github.com/facebook/react) | 18.3.1 | MIT | © Facebook, Inc. and its affiliates |
| [React DOM](https://github.com/facebook/react) | 18.3.1 | MIT | © Facebook, Inc. and its affiliates |
| [ReactFlow](https://github.com/xyflow/xyflow) | 11.11.4 | MIT | © 2019-2023 webkid GmbH |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT OR GPL-3.0-or-later（本项目按 MIT 使用） | © 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso |
| [CodeMirror 6](https://github.com/codemirror/dev)（`@codemirror/*`、`@uiw/react-codemirror`、`@replit/codemirror-vim`） | 6.x | MIT | © 2018 Marijn Haverbeke |
| [cmdk](https://github.com/pacocoursey/cmdk) | 1.1.1 | MIT | © 2022 Paco Coursey |

> Tauri 采用 Apache-2.0 与 MIT 双许可，使用者可任选其一。本软件在 MIT 条款下使用其前端 API 包，在 Apache-2.0 条款下使用其桌面端运行时；两份许可证全文均附于下方。

## 构建期依赖（Build-time / Dev Dependencies）

以下组件仅在开发与构建阶段使用，通常不随最终安装包分发，一并致谢：Vite、TypeScript、Tailwind CSS、PostCSS、Autoprefixer、`@vitejs/plugin-react`、`@playwright/test`、`@tauri-apps/cli`、`@types/react`、`@types/react-dom`。这些组件均以其各自仓库声明的许可证（多为 MIT，TypeScript 为 Apache-2.0）授权。

---

## Rust 运行时与构建期依赖（crates.io registry，共 24 个包）

本段由 `src-tauri/Cargo.lock` 与本地 cargo registry 自动生成，按许可证分组。
其中 `281` 个为已知精确许可证，`182` 个为**当前平台专用依赖**（Linux GTK / macOS CoreFoundation 等），
本机（Windows）未下载其源码故无法从本地 registry 读取许可字段；
**权威完整清单**可在联网环境用下列命令重新生成（社区标准做法）：

```bash
cargo install cargo-license
cargo license --json > THIRD-PARTY-RUST.json      # 机器可读
cargo license > THIRD-PARTY-RUST.txt               # 人读
```

### 许可证分组（23 种，已识别 281 个包）

| 许可证 | 包数 | 说明 |
| --- | ---: | --- |
| `MIT OR Apache-2.0` | 140 | 宽松许可，Apache-2.0 项目可合规使用 |
| `MIT` | 53 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Apache-2.0 OR MIT` | 31 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Unicode-3.0` | 18 | 宽松 |
| `MIT/Apache-2.0` | 11 | 宽松许可，Apache-2.0 项目可合规使用 |
| `MPL-2.0` | 5 | 文件级 copyleft：使用不传染，改动 MPL 文件需公开该文件改动 |
| `Unlicense OR MIT` | 4 | 宽松许可，Apache-2.0 项目可合规使用 |
| `BSD-3-Clause` | 2 | 宽松许可，Apache-2.0 项目可合规使用 |
| `MIT OR Apache-2.0 OR Zlib` | 2 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Unlicense/MIT` | 2 | 宽松许可，Apache-2.0 项目可合规使用 |
| `0BSD OR MIT OR Apache-2.0` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `BSD-3-Clause AND MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `BSD-3-Clause/MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Apache-2.0 AND MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `CC0-1.0 OR MIT-0 OR Apache-2.0` | 1 | 任选其一，三者均宽松 |
| `(Apache-2.0 OR MIT) AND BSD-3-Clause` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Apache-2.0 / MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Zlib` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `MIT OR Zlib OR Apache-2.0` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Apache-2.0` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `Zlib OR Apache-2.0 OR MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |
| `BSD-2-Clause OR Apache-2.0 OR MIT` | 1 | 宽松许可，Apache-2.0 项目可合规使用 |

<details><summary>展开：已识别许可的 281 个包明细（点击展开）</summary>

**`MIT OR Apache-2.0`**（140）：

> `anyhow 1.0.104`、`base64 0.22.1`、`bitflags 2.13.1`、`block-buffer 0.10.4`、`camino 1.2.6`、`cargo-platform 0.1.9`、`cc 1.4.0`、`cfg-if 1.0.4`、`chrono 0.4.45`、`cookie 0.18.2`、`cpufeatures 0.2.17`、`crc32fast 1.5.0`、`crossbeam 0.8.4`、`crossbeam-channel 0.5.16`、`crossbeam-deque 0.8.7`、`crossbeam-epoch 0.9.20`、`crossbeam-queue 0.3.13`、`crossbeam-utils 0.8.22`、`crypto-common 0.1.7`、`deranged 0.5.8`、`digest 0.10.7`、`dirs 6.0.0`、`dirs-sys 0.5.0`、`displaydoc 0.2.7`、`dtoa 1.0.11`、`dyn-clone 1.0.20`、`either 1.17.0`、`erased-serde 0.4.10`、`fdeflate 0.3.7`、`find-msvc-tools 0.1.9`、`flate2 1.1.9`、`form_urlencoded 1.2.2`、`getrandom 0.2.17`、`getrandom 0.3.4`、`getrandom 0.4.3`、`glob 0.3.4`、`hashbrown 0.12.3`、`hashbrown 0.14.5`、`hashbrown 0.17.1`、`heck 0.5.0`、`hex 0.4.3`、`html5ever 0.38.0`、`http 1.5.0`、`idna 1.1.0`、`itoa 1.0.18`、`jsonptr 0.6.3`、`keyboard-types 0.7.0`、`lazy_static 1.5.0`、`libc 0.2.189`、`lock_api 0.4.14`、`log 0.4.33`、`markup5ever 0.38.0`、`mime 0.3.17`、`num-conv 0.2.2`、`num-traits 0.2.19`、`once_cell 1.21.4`、`parking_lot 0.12.5`、`parking_lot_core 0.9.12`、`percent-encoding 2.3.2`、`png 0.17.16`、`powerfmt 0.2.0`、`ppv-lite86 0.2.21`、`proc-macro2 1.0.107`、`quote 1.0.47`、`rand 0.8.7`、`rand_chacha 0.3.1`、`rand_core 0.6.4`、`rand_distr 0.4.3`、`rayon 1.12.0`、`rayon-core 1.13.0`、`ref-cast 1.0.26`、`ref-cast-impl 1.0.26`、`regex 1.13.1`、`regex-automata 0.4.16`、`regex-syntax 0.8.11`、`rustc_version 0.4.1`、`scopeguard 1.2.0`、`semver 1.0.28`、`serde 1.0.229`、`serde-untagged 0.1.9`、`serde_core 1.0.229`、`serde_derive 1.0.229`、`serde_derive_internals 0.29.1`、`serde_json 1.0.151`、`serde_repr 0.1.21`、`serde_spanned 0.6.9`、`serde_spanned 1.1.1`、`serde_with 3.21.0`、`serde_with_macros 3.21.0`、`serialize-to-javascript 0.1.2`、`serialize-to-javascript-impl 0.1.2`、`servo_arc 0.4.3`、`sha2 0.10.9`、`shlex 2.0.1`、`smallvec 1.15.2`、`socket2 0.6.5`、`softbuffer 0.4.8`、`stable_deref_trait 1.2.1`、`string_cache 0.9.0`、`string_cache_codegen 0.6.1`、`syn 2.0.119`、`syn 3.0.3`、`tendril 0.5.1`、`thiserror 1.0.69`、`thiserror 2.0.20`、`thiserror-impl 1.0.69`、`thiserror-impl 2.0.20`、`time 0.3.54`、`time-core 0.1.9`、`time-macros 0.2.32`、`toml 0.8.2`、`toml_datetime 0.6.3`、`toml_edit 0.20.2`、`tray-icon 0.24.2`、`typeid 1.0.3`、`typenum 1.20.1`、`unicode-segmentation 1.13.3`、`url 2.5.8`、`web_atoms 0.2.6`、`windows 0.61.3`、`windows-collections 0.2.0`、`windows-core 0.61.2`、`windows-future 0.2.1`、`windows-implement 0.60.2`、`windows-interface 0.59.3`、`windows-link 0.1.3`、`windows-link 0.2.1`、`windows-numerics 0.2.0`、`windows-result 0.3.4`、`windows-strings 0.4.2`、`windows-sys 0.52.0`、`windows-sys 0.59.0`、`windows-sys 0.60.2`、`windows-sys 0.61.2`、`windows-targets 0.52.6`、`windows-targets 0.53.5`、`windows-threading 0.1.0`、`windows-version 0.1.7`、`windows_x86_64_msvc 0.52.6`、`windows_x86_64_msvc 0.53.1`

**`MIT`**（53）：

> `bytes 1.12.1`、`cargo_metadata 0.19.2`、`cfb 0.7.3`、`darling 0.23.0`、`darling_core 0.23.0`、`darling_macro 0.23.0`、`dashmap 5.5.3`、`derive_more 2.1.1`、`derive_more-impl 2.1.1`、`dom_query 0.27.0`、`embed-resource 3.0.11`、`generic-array 0.14.7`、`ico 0.5.0`、`infer 0.19.0`、`libm 0.2.16`、`mio 1.2.3`、`new_debug_unreachable 1.0.6`、`open 5.4.4`、`os_pipe 1.2.3`、`phf 0.13.1`、`phf_codegen 0.13.1`、`phf_generator 0.13.1`、`phf_macros 0.13.1`、`phf_shared 0.13.1`、`plist 1.10.0`、`precomputed-hash 0.1.1`、`quick-xml 0.41.0`、`rfd 0.16.0`、`schemars 0.8.22`、`schemars 0.9.0`、`schemars 1.2.2`、`schemars_derive 0.8.22`、`shared_child 1.1.1`、`simd-adler32 0.3.10`、`strsim 0.11.1`、`synstructure 0.13.2`、`tauri-winres 0.3.6`、`tokio 1.53.1`、`tokio-macros 2.7.2`、`tracing 0.1.44`、`tracing-attributes 0.1.31`、`tracing-core 0.1.36`、`urlpattern 0.3.0`、`vswhom 0.1.0`、`vswhom-sys 0.1.3`、`webview2-com 0.38.2`、`webview2-com-macros 0.8.1`、`webview2-com-sys 0.38.2`、`winnow 0.5.40`、`winnow 0.7.15`、`winnow 1.0.4`、`winreg 0.55.0`、`zmij 1.0.23`

**`Apache-2.0 OR MIT`**（31）：

> `autocfg 1.5.1`、`bit-set 0.8.0`、`bit-vec 0.8.0`、`cargo_toml 0.22.3`、`ctor 0.8.0`、`ctor-proc-macro 0.0.7`、`dtor 0.3.0`、`dtor-proc-macro 0.0.6`、`equivalent 1.0.2`、`fastrand 2.5.0`、`idna_adapter 1.2.2`、`indexmap 1.9.3`、`indexmap 2.14.0`、`muda 0.19.3`、`pin-project-lite 0.2.17`、`rustc-hash 2.1.3`、`tauri 2.11.6`、`tauri-build 2.6.3`、`tauri-codegen 2.6.3`、`tauri-macros 2.6.3`、`tauri-plugin 2.6.3`、`tauri-plugin-dialog 2.7.3`、`tauri-plugin-fs 2.5.2`、`tauri-plugin-shell 2.3.6`、`tauri-runtime 2.11.3`、`tauri-runtime-wry 2.11.4`、`tauri-utils 2.9.3`、`utf8_iter 1.0.4`、`uuid 1.24.0`、`window-vibrancy 0.6.0`、`wry 0.55.1`

**`Unicode-3.0`**（18）：

> `icu_collections 2.2.0`、`icu_locale_core 2.2.0`、`icu_normalizer 2.2.0`、`icu_normalizer_data 2.2.0`、`icu_properties 2.2.0`、`icu_properties_data 2.2.0`、`icu_provider 2.2.0`、`litemap 0.8.2`、`potential_utf 0.1.5`、`tinystr 0.8.3`、`writeable 0.6.3`、`yoke 0.8.3`、`yoke-derive 0.8.2`、`zerofrom 0.1.8`、`zerofrom-derive 0.1.7`、`zerotrie 0.2.4`、`zerovec 0.11.6`、`zerovec-derive 0.11.3`

**`MIT/Apache-2.0`**（11）：

> `bitflags 1.3.2`、`bs58 0.5.1`、`ident_case 1.0.1`、`json-patch 3.0.1`、`siphasher 1.0.3`、`unic-char-property 0.9.0`、`unic-char-range 0.9.0`、`unic-common 0.9.0`、`unic-ucd-ident 0.9.0`、`unic-ucd-version 0.9.0`、`version_check 0.9.5`

**`MPL-2.0`**（5）：

> `cssparser 0.36.0`、`cssparser-macros 0.6.1`、`dtoa-short 0.3.5`、`option-ext 0.2.0`、`selectors 0.36.1`

**`Unlicense OR MIT`**（4）：

> `aho-corasick 1.1.4`、`byteorder 1.5.0`、`memchr 2.8.3`、`winapi-util 0.1.11`

**`BSD-3-Clause`**（2）：

> `alloc-no-stdlib 2.0.4`、`alloc-stdlib 0.2.4`

**`MIT OR Apache-2.0 OR Zlib`**（2）：

> `raw-window-handle 0.6.2`、`tinyvec_macros 0.1.1`

**`Unlicense/MIT`**（2）：

> `same-file 1.0.6`、`walkdir 2.5.0`

**`0BSD OR MIT OR Apache-2.0`**（1）：

> `adler2 2.0.1`

**`BSD-3-Clause AND MIT`**（1）：

> `brotli 8.0.4`

**`BSD-3-Clause/MIT`**（1）：

> `brotli-decompressor 5.0.3`

**`Apache-2.0 AND MIT`**（1）：

> `dpi 0.1.2`

**`CC0-1.0 OR MIT-0 OR Apache-2.0`**（1）：

> `dunce 1.0.5`

**`(Apache-2.0 OR MIT) AND BSD-3-Clause`**（1）：

> `encoding_rs 0.8.35`

**`Apache-2.0 / MIT`**（1）：

> `fnv 1.0.7`

**`Zlib`**（1）：

> `foldhash 0.2.0`

**`MIT OR Zlib OR Apache-2.0`**（1）：

> `miniz_oxide 0.8.9`

**`Apache-2.0`**（1）：

> `tao 0.35.3`

**`Zlib OR Apache-2.0 OR MIT`**（1）：

> `tinyvec 1.12.0`

**`(MIT OR Apache-2.0) AND Unicode-3.0`**（1）：

> `unicode-ident 1.0.24`

**`BSD-2-Clause OR Apache-2.0 OR MIT`**（1）：

> `zerocopy 0.8.55`

</details>

<details><summary>展开：当前平台未下载源码的 182 个跨平台专用依赖（点击展开）</summary>

> `android_system_properties 0.1.5`、`atk 0.18.2`、`atk-sys 0.18.2`、`atomic-waker 1.1.2`、`base64 0.21.7`、`base64 0.23.1`、`block2 0.6.2`、`bumpalo 3.20.3`、`bytemuck 1.25.2`、`cairo-rs 0.18.5`、`cairo-sys-rs 0.18.2`、`cesu8 1.1.0`、`cfg-expr 0.15.8`、`combine 4.6.7`、`core-foundation 0.10.1`、`core-foundation-sys 0.8.7`、`core-graphics 0.25.0`、`core-graphics-types 0.2.0`、`dbus 0.9.12`、`dispatch2 0.3.1`、`dlopen2 0.8.2`、`dlopen2_derive 0.4.3`、`embed_plist 1.2.2`、`errno 0.3.14`、`field-offset 0.3.6`、`foreign-types 0.5.0`、`foreign-types-macros 0.2.4`、`foreign-types-shared 0.3.1`、`futures-channel 0.3.33`、`futures-core 0.3.33`、`futures-executor 0.3.33`、`futures-io 0.3.33`、`futures-macro 0.3.33`、`futures-sink 0.3.34`、`futures-task 0.3.33`、`futures-util 0.3.33`、`gdk 0.18.2`、`gdk-pixbuf 0.18.5`、`gdk-pixbuf-sys 0.18.0`、`gdk-sys 0.18.2`、`gdkwayland-sys 0.18.2`、`gdkx11 0.18.2`、`gdkx11-sys 0.18.2`、`gio 0.18.4`、`gio-sys 0.18.1`、`glib 0.18.5`、`glib-macros 0.18.5`、`glib-sys 0.18.1`、`gobject-sys 0.18.0`、`gtk 0.18.2`、`gtk-sys 0.18.2`、`gtk3-macros 0.18.2`、`heck 0.4.1`、`http-body 1.1.0`、`http-body-util 0.1.5`、`httparse 1.10.1`、`hyper 1.11.1`、`hyper-util 0.1.20`、`iana-time-zone 0.1.65`、`iana-time-zone-haiku 0.1.2`、`ipnet 2.12.2`、`is-docker 0.2.0`、`is-wsl 0.4.0`、`javascriptcore-rs 1.1.2`、`javascriptcore-rs-sys 1.1.1`、`jni 0.21.1`、`jni-sys 0.3.1`、`jni-sys 0.4.1`、`jni-sys-macros 0.4.1`、`js-sys 0.3.103`、`libappindicator 0.9.0`、`libappindicator-sys 0.9.0`、`libdbus-sys 0.2.7`、`libloading 0.7.4`、`libredox 0.1.18`、`memoffset 0.9.1`、`ndk 0.9.0`、`ndk-sys 0.6.0+11769913`、`num_enum 0.7.6`、`num_enum_derive 0.7.6`、`objc2 0.6.4`、`objc2-app-kit 0.3.2`、`objc2-cloud-kit 0.3.2`、`objc2-core-data 0.3.2`、`objc2-core-foundation 0.3.2`、`objc2-core-graphics 0.3.2`、`objc2-core-image 0.3.2`、`objc2-core-location 0.3.2`、`objc2-core-text 0.3.2`、`objc2-encode 4.1.0`、`objc2-exception-helper 0.1.1`、`objc2-foundation 0.3.2`、`objc2-io-surface 0.3.2`、`objc2-quartz-core 0.3.2`、`objc2-ui-kit 0.3.2`、`objc2-user-notifications 0.3.2`、`objc2-web-kit 0.3.2`、`pango 0.18.3`、`pango-sys 0.18.0`、`pkg-config 0.3.33`、`png 0.18.1`、`proc-macro-crate 1.3.1`、`proc-macro-crate 2.0.2`、`proc-macro-error 1.0.4`、`proc-macro-error-attr 1.0.4`、`r-efi 5.3.0`、`r-efi 6.0.0`、`redox_syscall 0.5.18`、`redox_users 0.5.3`、`reqwest 0.13.5`、`rustversion 1.0.23`、`sigchld 0.2.5`、`signal-hook 0.4.4`、`signal-hook-registry 1.4.8`、`slab 0.4.12`、`soup3 0.5.0`、`soup3-sys 0.5.0`、`swift-rs 1.0.8`、`syn 1.0.109`、`sync_wrapper 1.0.2`、`system-deps 6.2.2`、`tao-macros 0.1.4`、`target-lexicon 0.12.16`、`tokio-util 0.7.19`、`toml 0.9.12+spec-1.1.0`、`toml 1.1.6+spec-1.1.0`、`toml_datetime 0.7.5+spec-1.1.0`、`toml_datetime 1.1.1+spec-1.1.0`、`toml_edit 0.19.15`、`toml_parser 1.1.3+spec-1.1.0`、`toml_writer 1.1.2+spec-1.1.0`、`tower 0.5.3`、`tower-http 0.6.11`、`tower-layer 0.3.3`、`tower-service 0.3.3`、`try-lock 0.2.5`、`version-compare 0.2.1`、`want 0.3.1`、`wasi 0.11.1+wasi-snapshot-preview1`、`wasip2 1.0.4+wasi-0.2.12`、`wasm-bindgen 0.2.126`、`wasm-bindgen-futures 0.4.76`、`wasm-bindgen-macro 0.2.126`、`wasm-bindgen-macro-support 0.2.126`、`wasm-bindgen-shared 0.2.126`、`wasm-streams 0.5.0`、`web-sys 0.3.103`、`webkit2gtk 2.0.2`、`webkit2gtk-sys 2.0.2`、`winapi 0.3.9`、`winapi-i686-pc-windows-gnu 0.4.0`、`winapi-x86_64-pc-windows-gnu 0.4.0`、`windows-core 0.62.2`、`windows-result 0.4.1`、`windows-strings 0.5.1`、`windows-sys 0.45.0`、`windows-targets 0.42.2`、`windows_aarch64_gnullvm 0.42.2`、`windows_aarch64_gnullvm 0.52.6`、`windows_aarch64_gnullvm 0.53.1`、`windows_aarch64_msvc 0.42.2`、`windows_aarch64_msvc 0.52.6`、`windows_aarch64_msvc 0.53.1`、`windows_i686_gnu 0.42.2`、`windows_i686_gnu 0.52.6`、`windows_i686_gnu 0.53.1`、`windows_i686_gnullvm 0.52.6`、`windows_i686_gnullvm 0.53.1`、`windows_i686_msvc 0.42.2`、`windows_i686_msvc 0.52.6`、`windows_i686_msvc 0.53.1`、`windows_x86_64_gnu 0.42.2`、`windows_x86_64_gnu 0.52.6`、`windows_x86_64_gnu 0.53.1`、`windows_x86_64_gnullvm 0.42.2`、`windows_x86_64_gnullvm 0.52.6`、`windows_x86_64_gnullvm 0.53.1`、`windows_x86_64_msvc 0.42.2`、`wit-bindgen 0.57.1`、`x11 2.21.0`、`x11-dl 2.21.0`、`zerocopy-derive 0.8.55`

</details>
---

## 许可证全文

### MIT License

适用于：Ant Design Icons、React、React DOM、ReactFlow、JSZip、CodeMirror 6、cmdk，以及 Tauri（在 MIT 条款下使用时）。各组件的版权声明见上表。

```
MIT License

Copyright (c) <各组件对应的版权持有人，见上表>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

适用于：Tauri（在 Apache-2.0 条款下使用时），© 2017 - Present Tauri Apps Contributors。

Apache License 2.0 的完整文本与本软件自身采用的协议相同，见仓库根目录的 [LICENSE](LICENSE) 文件。其要点包括：保留版权与许可证声明、在 `NOTICE` 文件存在时予以保留、对修改文件作出标注，并附带专利授权条款。完整条款以 https://www.apache.org/licenses/LICENSE-2.0 为准。

---

如发现本声明存在遗漏或不准确之处，欢迎通过仓库 Issue 反馈，我们会及时补充与更正。
