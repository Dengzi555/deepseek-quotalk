# deepseek-quotalk v0.17.2

在 DeepSeek 网页选中一句看不懂的话，就地打开小窗追问。复用已登录的网页会话，无需填写 API Key。

## 功能

- 划词解释、举例和连续追问，回复流式显示。
- 选择仅当前回答、最近 2／4 轮或全部已加载对话作为上下文。
- 首问自动切到回答标签页，请求发出后返回；保持回答页打开，后续不再切页。
- 小窗可拖动、调整大小、收起，支持明暗主题。
- pet-with-you 动画角色与蓝色 DeepSeek 鲸鱼，两种形象分别记住尺寸；鲸鱼不显示动作栏。
- 100 段本地动画，支持回答时思考、手动点播和按 1／3／5／10 分钟间隔随机播放。

## 安装

下载 deepseek-quotalk-0.17.2.zip 并解压。在 Edge 地址栏打开 edge://extensions 或 Chrome 地址栏打开 chrome://extensions，开启开发者模式，加载解压后的 extension 文件夹，再刷新已登录的 DeepSeek 页面。

普通使用不需要 Node.js、Python 或桌宠原项目。首次提问后请保留回答标签页。

## 附件

- deepseek-quotalk-0.17.2.zip：安装包。
- deepseek-quotalk-source-0.17.2.zip：完整源码、文档、测试和发布脚本。
- SHA256SUMS.txt：两个包的 SHA-256 校验值。
- PUBLIC_FILES.txt：源码包公开文件清单。

## 验证与范围

80 项模拟检查和打包完整性检查通过。网页改版、网络与浏览器后台调度可能影响发送和同步；小窗历史刷新后不保留，回复当前以纯文本显示。未宣称所有浏览器均已实测通过。

## 许可与署名

自有代码和文档采用 MIT；动画素材允许开源使用、禁止商用，完整包不能视为全部采用 MIT。

动画原作：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。素材获取与分类参考：[Refining-colors/pet-with-you](https://github.com/Refining-colors/pet-with-you)。本项目与 DeepSeek 官方无隶属关系。详见 [许可说明](../NOTICE.md)。
