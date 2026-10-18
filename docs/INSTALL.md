# 安装、更新与移除

## 准备

- 使用桌面版 Edge 或 Chrome，能够打开并登录 `https://chat.deepseek.com/`。
- 下载仓库 Code → Download ZIP，或维护者在 Releases 中提供的 `deepseek-quotalk-版本号.zip`。
- 解压到长期保留的位置。安装包内包含 `extension/` 和文档；源码包还包含测试与开发脚本。
- 安装不需要运行命令，不需要安装桌宠原项目，也不需要填写 API Key。

## Edge

1. 新开标签，在地址栏输入 `edge://extensions` 并回车。这是浏览器内置页面，不是 DeepSeek 对话里要发送的文字。
2. 在扩展管理页面找到“开发人员模式”开关，通常在左侧；侧栏折叠时先打开左侧菜单。
3. 打开开关后，点击“加载解压缩的扩展”。
4. 在目录选择器里进入解压后的 `extension/` 文件夹，确认这一层直接有 `manifest.json`，点击“选择文件夹”。不要选择 ZIP、项目最外层或 `assets/`。
5. 登录 DeepSeek，刷新已打开的阅读页。可在地址栏旁的扩展菜单中固定本扩展图标，方便恢复隐藏的小窗。

浏览器不同版本的中文按钮可能略有差别，可对照 [Edge 官方侧载说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。

## Chrome

地址栏输入 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择同一个 `extension/` 目录，再刷新 DeepSeek 页面。参见 [Chrome 官方说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)。

## 第一次试用

1. 在 DeepSeek 原对话里找到一条已有回答。
2. 选中至少两个字符，点击选区附近的“追问”。
3. 输入问题，按 Enter；Shift + Enter 换行。
4. 扩展会在当前浏览器窗口里创建回答标签页，仅首次提问时自动切过去，确认网页请求发出后返回阅读页；后续问题复用此页且不再切换。关闭回答页后，下次重新创建时会再切一次。
5. 回答会同步到原阅读页的小窗，可手动切回查看。回答页若要求登录或验证，先完成后再从小窗重新提问。

## 更新

1. 先复制需要保存的小窗消息和草稿。
2. 用新文件更新原来的安装目录，或在扩展管理页移除旧扩展后重新加载新目录。尽量更新原目录，减少偏好重置。
3. 在扩展管理页点击该扩展的重新加载按钮。
4. 刷新 DeepSeek 阅读页和回答页，让新脚本生效。新建回答标签页时仅首问切过去，请求发出后自动返回；已完成初始化的回答页保持复用。

开发者加载模式不会从 GitHub 自动更新。刷新页面会清空页面内的小窗历史、草稿和拖动位置。

## 退出、移除与文件夹

- 右键“退出”只是隐藏桌宠和小窗，框选文字再点追问可恢复；点扩展图标也可恢复。
- 真正卸载需进入浏览器扩展管理页，选择“移除”。DeepSeek 网站中的实际会话不会因此删除。
- 加载后不要移动或删除安装目录。若已经移动，重新从新位置加载 `extension/`。

其他问题见 [常见问题](TROUBLESHOOTING.md)。
