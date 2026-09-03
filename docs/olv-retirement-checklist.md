# Open-LLM-VTuber 退役清单

目标目录：

```text
<workspace>\thirdparty\Open-LLM-VTuber
```

本清单用于记录 OLV 退役证据与最终清理结果。

## 已确认可替代

- Avatar 不导入、启动或调用 OLV 的 Python/FastAPI/WebSocket 代码。
- ASR/TTS 已由独立 ModelDeck API 提供；Avatar 不需要 OLV 的 `.venv`、
  PyTorch、ONNX Runtime 或本地 SenseVoice 模型。
- OLV 的 Megumi `runtime` 与 Avatar 的 `assets/models/megumi` 均为 38 个
  文件、3,818,361 字节。2026-09-03 逐文件 SHA-256 比较结果为 0 个缺失、
  0 个哈希差异。
- Live2D 表情、12 个隐藏情绪动作、3 个待机动作、手臂组合和嘴部参数均已
  被 Avatar 使用。

## 已决定丢弃的本地内容

OLV 当前不是干净 checkout。以下 5 个 tracked 文件有未提交修改，合计约
221 行新增、15 行删除：

```text
pyproject.toml
requirements.txt
src/open_llm_vtuber/agent/agents/basic_memory_agent.py
src/open_llm_vtuber/conversations/conversation_utils.py
uv.lock
```

这些改动主要是屏幕图像使用 low detail，以及把视觉输入压缩到最长边 960、
约 900 KiB。该能力现在属于 DSH 的视觉输入/附件边界，不应搬进 Avatar。
用户已于 2026-09-03 决定清理 OLV，因此不另存 patch 或分支。

此外，OLV 的本地 `conf.yaml` 包含旧 Megumi persona prompt。Avatar 不接管
Agent 人设，该配置不会迁入插件，将随旧 checkout 一并删除。

## 磁盘回收预估

2026-09-03 实测 OLV 目录约 2.705 GiB、25,848 个文件。主要占用包括：

- 完整 SenseVoice 模型约 894 MiB；
- int8 SenseVoice 模型约 228 MiB；
- `.venv` 中 PyTorch CPU 库，其中 `dnnl.lib` 约 623 MiB、`torch_cpu.dll`
  约 240 MiB；
- 其余 Python 包、ONNX Runtime、前端 WASM 和源码。

删除 OLV 目录只能回收该目录内的空间。ModelDeck 的 WSL 环境和模型属于
独立服务，不应随 OLV 一起删除。

## 清理结果（2026-09-03）

- 已删除精确目标 `<workspace>\thirdparty\Open-LLM-VTuber`，
  删除后 `Test-Path`/目录存在性检查为 false。
- 被删除 checkout 的 HEAD 为 `9cb4396897a3b1f44c30af73563416cbad31f664`。
- 删除前再次比较 Megumi：源和目标均为 38 个文件、3,818,361 字节，缺失 0、
  SHA-256 差异 0。
- 删除前确认 Avatar 运行时代码无 OLV 绝对路径依赖，也没有进程引用该目录。
- 预计回收约 2.705 GiB。未删除 WSL ModelDeck、全局 Hugging Face/Python
  缓存或其他项目目录。
- 5 个 tracked 文件的未提交实验和本地 `conf.yaml` 不能从被删除的工作树恢复；
  upstream 原始源码和上述 HEAD 仍可重新 clone/checkout。

## 最终验收

- [x] Avatar 类型检查、单元测试和生产构建通过。
- [x] TokensCowork host 重启后加载 Avatar，无浏览器 console error。
- [x] ModelDeck 同源 `/avatar/api/health` 返回 200，ASR/TTS ready。
- [x] 设置页显示按键录音/VAD、阈值、静音时长和首句预生成设置。
- [x] 剧情、语音、桌宠与开发模式仍可进入；语音舞台布局正常。
- [ ] 用户用真实麦克风完成一次 push-to-talk ASR → DSH → TTS 回环。
- [ ] 用户切换到连续对话，校准 VAD 阈值并确认自动恢复聆听。
- [ ] 用户确认逐句表情/动作与音频同步、口型幅度自然。
- [x] 用户决定丢弃 OLV 未提交修改，不保存 patch/分支。
- [x] 用户决定不把 `conf.yaml` 的旧 persona prompt 迁入 Avatar。
- [ ] 复核 Megumi 素材许可/本地备份位置。
- [x] 已得到删除精确目标目录的明确指令。
- [x] 删除目标目录，并验证目录不存在。

尚未完成的真实设备语音与素材许可项目不会阻塞旧运行时退役：前者属于
Avatar 后续验收，后者不改变已经逐文件复制并校验的本地素材。后续方向见
[`TODO.md`](TODO.md)。
