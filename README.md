# dsh-sidebar-human-browser

Human-shaped browser control for DeepSeek Harness. Drives **the built-in sidebar browser** of DSH Desktop — the `<webview>` you can see — with input that looks like a person did it.

No debug port. No CDP. No external network. Everything runs in the app window.

```
human_open → human_snapshot → human_click / human_type / human_scroll → human_text
```

---

## 为什么做这个 / Why

The existing `dsh-sidebar-browser-cdp` is a good driver: it attaches to the sidebar `<webview>`, has 17 tools, and its clicks are real `sendInputEvent` calls (so `event.isTrusted === true`). What it does **not** do is behave like a human, and what it leaks on the environment side is enough to be filtered before behaviour even matters. Measured on DSH Desktop 0.2.1-rc.2:

| Leak | Measured value | Why it matters |
|---|---|---|
| UA | `…Chrome/152… Electron/44.7.0` + `@deepseek-ai/dsh-desktop/0.2.1-rc.2` | one regex |
| UA-CH brands | `[Not?A_Brand 24, Chromium 152]` — **no `Google Chrome`** | contradicts the UA string |
| Click | `mouseDown` → `mouseUp` in ~0 ms | page can time the press |
| Typing | whole string via `insertText` in one tick | zero inter-key intervals |
| Snapshot | tags the DOM with `data-dsh-idx="…"` | `querySelectorAll` sees it |
| Scroll | one 600 px jump | no wheel ticks, no inertia |

This plugin fixes the four it can fix inside the app window, and reports the timings so you can verify it did.

## 改进内容 / What is different

### 1. Pointer: Fitts + Bezier + dwell

`human_click` does not teleport the cursor to the target:

- **Movement time** follows Fitts' law, `T = 100 + 150·log₂(D/W + 1)` ms, ±15 % jitter.
- **Path** is a quadratic Bezier with a perpendicular bow (`±18 %` of the distance) and per-sample noise that shrinks near the target; sampled every **8–16 ms** like a 60–120 Hz device.
- **15 %** of moves overshoot by a few px and correct back.
- **Hover** 90–380 ms before pressing; **press dwell** 55–260 ms (log-normal, median 110 ms); settle 60–260 ms after release.
- Every call returns `hold=…ms path=…ms (N pts)` so the behaviour is measured, not assumed.

### 2. Keyboard: one key at a time

`human_type` replaces one-shot `insertText` with a keystroke schedule:

- per-character `keyDown` → dwell **38–115 ms** → `char` → `keyUp`;
- inter-key gap **log-normal, median ~105 ms** (clamped 45–420 ms), longer after spaces, longest after `.?!,;:`;
- **1.5 % typo rate**, corrected with a real `Backspace` (humans do this constantly — a perfect string is itself a signal);
- CJK characters go through `insertText` per character with the same gaps.

### 3. Scrolling: inertial ticks

`human_scroll` splits one gesture into **4–16 wheel events** with geometric decay (`0.72–0.84`) at 14–46 ms intervals, then a 180–620 ms settle. `top`/`bottom` use smooth `scrollTo` plus a reading pause.

### 4. Snapshot: no DOM breadcrumbs

The upstream snapshot writes `data-dsh-idx` attributes into the page. Any script can read them. Here the element registry lives in **page memory** (`Map` keyed by an incrementing id), so `document.documentElement.outerHTML` is byte-identical to what a person's browser would produce.

### 5. Fingerprint consistency

On `dom-ready` a shim aligns the identity fields that otherwise contradict each other:

- `navigator.userAgent`, `appVersion`, `vendor`;
- `navigator.userAgentData.brands` — now `[Not A(Brand 8, Chromium 152, Google Chrome 152]`, matching the UA;
- `getHighEntropyValues()` patched to answer consistently;
- `navigator.webdriver = false` kept.

Configurable in `cordis.patch.yml` (`userAgent` / `platform` / `version` / `fingerprint`).

### 6. Observable by construction

The engine (`lib/human.js`) is pure and deterministic: pass a `seed` and the same path, gaps and dwells come back. Nine unit tests assert the distributions (Fitts median, dwell band, gap positivity, decay sum, drift bounds), so "it feels human" is a number, not a vibe.

---

## 安装 / Install

发布在 npm：**https://www.npmjs.com/package/dsh-sidebar-human-browser**

```
DSH Desktop → Plugins → Add plugin → dsh-sidebar-human-browser → Install → Enable now → 新会话
```

或命令行：

```sh
cd ~/.dsh/profiles/desktop
pnpm add dsh-sidebar-human-browser
# 再把 "dsh-sidebar-human-browser" 加进该 package.json 的 dsh.profile.bundles
```

安装后需要重启一次 DSH Desktop（插件在启动时加载）。

The plugin needs the sidebar browser guest to exist — `human_open` creates the tab.

## 工具 / Tools

| Tool | What it does |
|---|---|
| `human_open` | open a sidebar Browser tab and load a URL |
| `human_tabs` | list drivable tabs |
| `human_snapshot` | title, URL, focus state, numbered interactive elements (no DOM mutation) |
| `human_text` | visible page text |
| `human_navigate` | go to a URL and wait for the load |
| `human_click` | humanised click; returns measured hold/path timings |
| `human_type` | humanised typing; returns median key gap |
| `human_scroll` | inertial wheel gesture |
| `human_eval` | evaluate JS (least human-looking tool — prefer snapshot/text) |

## 真机实测 / Measured on device

同一测试页、同一 seed（42），与上游 `dsh-sidebar-browser-cdp` 0.3.0 对比：

| 指标 | 上游 | 本插件 | 人类基准 |
|---|---|---|---|
| 点击按下时长 | 0.5 ms | **152.6 ms** | 60–220 ms |
| 点击移动次数 | 2 | **7** | 20–40 |
| 输入 keydown | **0** | **18 / 18 字符** | = 字符数 |
| 按键间隔 | 无事件 | 中位 **217 ms** | 50–150 ms |
| 滚动位移 | 600 px | 599 px | 连续 |
| `isTrusted` | true | true | true |

滚动受 Electron webview 限制，详见 [docs/upstream-measurements.md](docs/upstream-measurements.md)。

## 行为数据 / Measured behaviour

`npm test` (deterministic seeds):

```
ok 1 rng is deterministic for a seed
ok 2 fittsDuration follows T = a + b*log2(D/W+1) within jitter
ok 3 mousePath ends on target and never jumps more than a few px
ok 4 clickDwell stays inside the human band and centres near 110ms
ok 5 typeSchedule: every gap positive, long text gets typos, CJK marked as ime
ok 6 keyDwell is inside 38-115ms
ok 7 scrollSequence decays and covers the requested distance
ok 8 readingPause clamps between 0.5s and 6s
ok 9 idleDrift moves no more than a couple of px per step
```

Example from a real run (seed fixed): `hold=118ms path=612ms (17 pts)`.

## 诚实的限制 / Honest limits

- **Injection timing.** The shim runs at `dom-ready`, not `document-start`. Fingerprint scripts that read `navigator.userAgent` while parsing `<head>` see the real Electron value. Fixing this needs a preload script, i.e. a change in the app, not a plugin.
- **Viewport.** The sidebar is ~600 px wide. A 600 px browser is itself unusual. Opening the target in a full-window tab is the physical fix; no JS shim makes a narrow window look normal without contradicting layout.
- **IME.** `Input.imeSetComposition` needs CDP. CJK text is therefore inserted per character with human gaps, but the page sees no `compositionstart/update/end`. Chinese-heavy sites can notice.
- **Focus.** If the sidebar guest is not focused, key events may not land. `human_click`/`human_type` call `webview.focus()` first, but a window that is not frontmost still reports `hasFocus() === false`.
- **This is not a bypass toolkit.** It reduces *behavioural* signal. It does not change TLS/JA3, IP reputation, account history, or the fact that the Chromium build is Electron's.

## 与上游的关系 / Relation to upstream

Independent implementation, MIT, no code copied. The bridge pattern (long-poll between host tools and a client half in the app window) follows `dsh-sidebar-browser-cdp` by [alesha-pro](https://github.com/alesha-pro/dsh-sidebar-browser) — credit for showing that the sidebar `<webview>` can be driven without a debug port. Both plugins can be installed side by side; they use different route prefixes and tool names.

## License

MIT © 2026 JimmyWangJimmy
