# Changelog

## 0.1.0 — 2026-10-22

首个版本。目标：把「能点」变成「像人点」。

### 行为层
- `human_click`：Fitts 定律时长（100 + 150·log2(D/W+1)，±15% 抖动）、二次贝塞尔轨迹（垂直弓高 ±18%、噪声随接近目标衰减）、8–16ms 采样、15% 过冲修正、悬停 90–380ms、按下驻留 55–260ms（对数正态中位数 110ms）。
- `human_type`：逐字符 keyDown/char/keyUp，驻留 38–115ms，间隔对数正态（中位数 ~105ms），空格与句末加权停顿，1.5% 错字 + 真实 Backspace 修正，中文按字符 insertText。
- `human_scroll`：4–16 个 wheel tick 几何衰减（0.72–0.84），间隔 14–46ms，收尾停顿 180–620ms。
- 每次调用返回实测时序（hold/path/medianGap），可自检。

### 环境层
- `dom-ready` 注入指纹补丁：UA、appVersion、vendor、UA-CH brands（补齐 Google Chrome）、`getHighEntropyValues` 一致性、webdriver=false。
- 可在 `cordis.patch.yml` 配置 userAgent / platform / version / fingerprint 开关。

### 结构
- 元素快照不再写 DOM 属性：注册表放在页面内存的 Map 里，`outerHTML` 保持干净。
- 引擎 `lib/human.js` 为纯函数 + 可播种 RNG；`scripts/build.mjs` 把引擎内联进客户端脚本，保持单一来源。
- 9 个单元测试断言分布而非感觉。

### 已知限制
- 注入时机在 `dom-ready`，无法覆盖 `document-start`（需 App 侧 preload）。
- 侧栏约 600px 宽，视口本身即异常；建议全窗口打开目标站。
- 无 IME 组合事件（需要 CDP 的 `Input.imeSetComposition`）。
- 未触及网络层（TLS/JA3、IP）与账号层。
