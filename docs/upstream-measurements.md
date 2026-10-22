# 上游插件行为实测（dsh-sidebar-browser-cdp 0.3.0）

测试环境：DSH Desktop 0.2.1-rc.2 / macOS / 侧栏 viewport 576×657
方法：本地测试页注册事件监听，记录 `event.isTrusted`、`performance.now()` 差值、事件计数。

## 结果

| 动作 | 页面侧观测 | 人类基准 |
|---|---|---|
| 单击按钮 | `mousemove` × **2**，`mousedown→mouseup` = **0.5 ms**，`isTrusted: true` | 20–40 次 move，按下 60–220 ms |
| 输入 17 字符 | `keydown` × **0**，输入框值直接出现 | 17 次 keydown，间隔 50–150 ms |
| 滚动 600 px | `wheel` × **0**，`scrollY` 直接 0→600 | 5–15 次 wheel tick，衰减间隔 14–46 ms |

原始输出：

```json
{"click":{"dwellMs":0.5,"moves":2,"trusted":true},"keydowns":0,"value":"human like typing"}
{"wheelEvents":0,"scrollY":600}
```

## 为什么这会被判定为自动化

1. **输入**：`insertText` 直接改 DOM 值，页面收不到任何键盘事件。任何监听 `keydown`/`beforeinput` 的脚本都能立刻识别。
2. **点击**：`isTrusted` 为真（这是它做对的地方），但按下与抬起间隔 0.5 ms、只发 2 次移动——时间特征本身即特征。
3. **滚动**：零 `wheel` 事件却发生位移，只能来自脚本。

## 本插件对应实现

| 项 | 本插件 | 实测值 |
|---|---|---|
| 点击驻留 | 对数正态，中位数 110 ms | `dwell=124ms`（seed 20261022） |
| 指针轨迹 | 贝塞尔 + 噪声，8–16 ms 采样 | `29 点 / 560 ms` |
| 输入 | 逐字符 keydown，log-normal 间隔 | `medianGap=156ms` |
| 滚动 | 4–16 个衰减 wheel tick | `10 ticks` |

复现：

```sh
npm test            # 9 项分布断言
node -e "import('./lib/human.js').then(H=>{const r=H.rng(20261022);console.log(H.clickDwell(r))})"
```

---

## 本插件实测（同一测试页，seed=42）

| 指标 | 上游 0.3.0 | 本插件 0.1.0 | 人类基准 |
|---|---|---|---|
| 点击：mousedown→mouseup | 0.5 ms | **152.6 ms** | 60–220 ms |
| 点击：mousemove 次数 | 2 | **7** | 20–40（视距离） |
| 输入：keydown 次数 | **0** | **18**（18 字符） | = 字符数 |
| 输入：按键间隔 | —（无事件） | 147–315 ms，中位 217 ms | 50–150 ms |
| 滚动：wheel 事件 | 0 | 0（见下方限制） | 5–15 |
| 滚动：实际位移 | 600 px（脚本） | **599 px** | 连续位移 |
| `isTrusted` | true | true | true |

### 滚动限制（环境所致，非代码）

在 DSH Desktop 0.2.1-rc.2 的侧栏 `<webview>` 里，`sendInputEvent({ type: 'mouseWheel' })` 有两种表现，二者不可兼得：

1. 只传 `deltaY` → 页面收到 `wheel` 事件（实测 10 次），但**不产生默认滚动**（`scrollY` 保持 0）
2. 补上 `wheelTicksY` + `hasPreciseScrollingDeltas` → 合成器消费事件，页面收不到 DOM `wheel`，仍不滚动

因此本插件采用「先发拟人 wheel 序列，检测到未位移时改用平滑脚本滚动」的兜底，并在返回值里标记 `fallback: true`。要做到「既产生 DOM wheel 事件又真实滚动」，需要 Electron 侧支持或走 CDP `Input.dispatchMouseEvent`。

