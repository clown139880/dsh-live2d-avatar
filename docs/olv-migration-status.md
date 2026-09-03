# Open-LLM-VTuber 迁移状态

结论：**没有、也不应该把 OLV 的全部内容原样迁入 Avatar。** 这不是一次
Python 服务端搬家，而是把 OLV 中仍有产品价值的角色表现与语音交互拆出来，
分别落到 DSH、Avatar 和 ModelDeck 的新边界中。OLV 的 LLM/Agent/会话服务端
已经被架空，不属于 Avatar 的待迁代码。

最终目录删除前的资产哈希、未提交改动和人工验收项见
[`olv-retirement-checklist.md`](olv-retirement-checklist.md)。
退役审计中保留下来的产品方向已经转为可执行的
[`TODO.md`](TODO.md)，不再以保留旧仓库作为需求备忘。

## 当前边界

| 能力 | 新归属 | 状态 |
| --- | --- | --- |
| 会话、历史、记忆、Agent、工具、模型选择 | DSH | 替代 OLV，不迁代码 |
| ASR/TTS 模型加载与推理 | ModelDeck | 已替代并通过 LAN API 验证 |
| Live2D 渲染、舞台、桌宠、语音浏览器 UX | Avatar | 已迁/重写 |
| OLV WebSocket 会话编排服务 | 无 | 架构上删除 |

## 已完成

- Cubism 2 Megumi 加载、缩放、定位和独立剧情/语音构图。
- 6 个表情、12 个被隐藏的情绪动作、3 个有效待机动作；动作内置的左右手
  部件组合保持原样，不做错误的自由拼装。
- LLM 显式 Live2D 指令：system prompt 注入、流式解析、隐藏控制数据、表情
  和动作执行。
- Galgame 式独立对话舞台、原生 DSH composer、主题适配。
- 桌宠模式、拖动、持久位置和角色点击反馈。
- 开发台：全部动作、表情、参数、构图和思考候选的直接测试。
- 思考/工具状态的对话框反馈，以及当前实验性的思考表演。
- ModelDeck host 代理：健康、能力、音色、ASR、TTS、Bearer token 隔离、
  `X-Request-ID`、`X-Title`、取消和有限重试。
- 浏览器 Push-to-talk：WebM/Opus 录音、SenseVoice 转写、通过 DSH 原生
  `inputActions` 提交。
- 回复语音：隐藏指令清理、按完整句切分、GPT-SoVITS WAV 生成、内存播放
  队列、停止和新回合取消，不写磁盘缓存。
- DSH session-scope 真正打断：开始讲话时同时取消当前回合、TTS 请求和播放，
  不影响其他会话；连续模式播放期间也提供“打断并说话”。
- 浏览器 VAD 连续对话：一次手势授权后自动收句、识别、等待回复、播报并恢复
  聆听；阈值与静音时长可配置，不引入本地 VAD 模型。
- 逐句表演时间轴：每个 TTS 片段保留自己的 Live2D 指令，音频真正开始时才
  切换表情和动作。
- Web Audio 音量口型：播放期间逐帧驱动 `PARAM_MOUTH_OPEN_Y`，结束后移除
  临时覆盖，不污染开发台参数。
- 首段逗号预生成：足够长的第一段可以提前提交 TTS，后续仍按完整句处理。

## 由 DSH/ModelDeck 替代，不应迁移

- OLV 的 LLM provider、Agent 工厂、persona 会话实例和历史管理。
- OLV 的 FastAPI/WebSocket 客户端协议、连接组和服务端会话任务。
- OLV 内置的 SenseVoice、Whisper、GPT-SoVITS 等 Python 推理依赖。
- OLV 的 ASR/TTS provider 大全。Avatar 只依赖稳定的 ModelDeck API；增加
  模型应优先扩展 ModelDeck 的能力目录。
- OLV 客户端自己的聊天记录、模型选择和配置系统。

## 审计后保留为 TODO 的方向

- 桌宠成为绑定会话的轻量客户端：快捷输入、麦克风、打断、会话切换与状态提醒。
- DSH 触发的主动说话、任务完成和审批提醒；Avatar 只负责角色投影。
- 内心旁白与朗读文本分离、触摸反馈、点击穿透和桌面交互增强。
- 复用 DSH 附件/工具的截图、屏幕和摄像头入口。
- 可测试的 TTS 文本投影规则，以及可选角色包、多角色舞台和翻译边界。

完整优先级和验收方向见 [`TODO.md`](TODO.md)。

## 退役前边界判断

| 能力 | 当前情况 | 建议优先级 |
| --- | --- | --- |
| 无耳机语音打断/回声抑制 | 手动打断已完成并使用浏览器 AEC；播放中自动监听仍可能把扬声器误判为人声，因此没有冒险默认开启 | 可选增强，不阻塞 OLV 退役 |
| VAD/免按键连续对话 | 已完成浏览器能量 VAD；真实麦克风环境仍需用户校准阈值 | 待设备验收 |
| 精确 TTS 表演对齐 | 已完成逐句指令队列和播放起点触发 | 已完成 |
| 口型同步 | 已完成 Web Audio RMS 驱动 | 待视觉验收 |
| 更低首句延迟 | 已完成首段逗号预生成；ModelDeck 暂不提供流式 WAV 时不做伪流式解码 | 已完成当前 API 上限 |
| 内心想法/动作与可朗读文本分离 | 动作用隐藏指令分离；DSH 内部 reasoning 不属于可朗读正文，也不由 Avatar 接管 | 由 DSH 边界解决 |
| 主动说话 | 应由 DSH Agent/自动化发起会话回合，Avatar 只投影视听表现 | 不迁 OLV 编排 |
| TTS 翻译 | 应由 LLM 直接输出目标语言，或未来作为 ModelDeck 无状态能力 | 不迁 OLV provider |
| 摄像头/屏幕视觉输入 | 可由 DSH 工具体系承担，但 Avatar 没有专用入口 | 低 |
| 多客户端群聊/广播 | 未迁；与当前单角色 DSH 插件目标不一致 | 不计划 |
| OLV 的全部模型/provider 选择 UI | 未迁；由 ModelDeck capabilities 和 DSH 配置替代 | 不计划 |

## 退役决定（2026-09-03）

用户已决定退役 OLV。旧 checkout 中 5 个 tracked 文件的视觉输入压缩实验与
`conf.yaml` persona 不另存 patch、不迁入 Avatar；其可取的产品方向已经写入
[`TODO.md`](TODO.md)。删除的是旧仓库及其目录内环境和模型，不包含 WSL 中的
ModelDeck、全局缓存或其他项目资源。

清理已完成：`<workspace>\thirdparty\Open-LLM-VTuber` 已删除，
删除前最后一次 Megumi 哈希复核仍为 0 个差异。Avatar 后续不再以 OLV checkout
作为代码、资产或需求来源。

## 语音验收记录（2026-09-02）

- ModelDeck `/health`：ASR 与 TTS 均为 `ready`。
- 发现 `sensevoice-small`、`gpt-sovits-v2pro`、`megumi_stable`。
- 直连 TTS 生成 234,284 字节 WAV，并成功由 SenseVoice 回转写。
- 通过 Avatar 同源代理 TTS 生成 147,244 字节 WAV，回转写结果为：
  `语音代理测试成功。`
- 插件设置和语音模式控件已在 TokensCowork 中加载。
- 尚需用户在真实麦克风上完成一次 Push-to-talk 交互验收。
