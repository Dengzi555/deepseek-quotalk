# 上传 GitHub 与发布版本

## 仓库介绍可以直接使用

仓库名：deepseek-quotalk

About 描述：

> DeepSeek 网页划词追问小窗，支持上下文范围、流式回答、明暗主题与动画桌宠，无需 API Key。

Topics 可填写：deepseek、browser-extension、chrome-extension、edge-extension、desktop-pet。

项目首页介绍使用根目录 README.md；本次 Release 的完整介绍已写在 [RELEASE_NOTES.md](RELEASE_NOTES.md)，创建 Release 时可直接复制。

## 准备上传目录

先使用本项目生成的 deepseek-quotalk-source-0.16.1.zip。解压后，进入直接包含 README.md、extension、docs、tests、scripts 和 .github 的那一层，把这一层作为仓库根目录。不要把源码 ZIP 本身当成仓库代码上传。

源码包只包含公开发行所需文件。普通用户安装时应下载 deepseek-quotalk-0.16.1.zip，然后加载其中的 extension 文件夹。

## 使用 GitHub Desktop 上传

1. 在自己的 GitHub 账号下创建仓库 deepseek-quotalk。如果已有仓库，直接使用原仓库。
2. 在 GitHub Desktop 中克隆该仓库，打开它对应的本地文件夹。
3. 把上面解压的源码目录内容复制进本地仓库根目录。包括 .github、.gitignore 和 .gitattributes 等文件；不要复制安装包 ZIP 或个人文件。
4. 在 Changes 中检查本次提交，确认扩展脚本、100 个 WebM、文档、测试和许可证齐全。
5. 填写提交说明，例如“Prepare v0.16.1 public release”，提交后推送到 GitHub。
6. 打开仓库首页，确认 README 和文档链接显示正常。

自有代码和文档采用 MIT；动画有单独的非商用约定。保留 LICENSE、NOTICE.md 和动画目录中的来源、原始许可证与署名。项目与 DeepSeek 官方无隶属关系。

## 不要上传本地工作目录中的这些内容

- dist、已有 ZIP：构建结果；ZIP 作为 Release 附件发布。
- .codex、编辑器缓存、日志、抓包、密钥、个人配置、私人截图或录屏。

.gitignore 已排除对应路径。源码包采用白名单打包，不包含以上内容。若私人内容曾经被提交到 Git，新增忽略规则不会清理已有历史，请单独处理。

## 重新生成发行包

在仓库根目录执行：

    node --test tests/*.test.cjs
    python scripts/release.py

开发检查需要 Node.js 22+ 和 Python 3.9+；普通安装不需要它们。脚本只使用 Python 标准库，不下载素材、不安装依赖、不创建仓库，也不上传文件。

输出文件位于 dist：

| 文件 | 用途 |
| --- | --- |
| deepseek-quotalk-0.16.1.zip | 安装包，包含 extension、教程和许可证 |
| deepseek-quotalk-source-0.16.1.zip | 源码包，另含测试、发布脚本、演示与 Issue 模板 |
| SHA256SUMS.txt | 两个 ZIP 的 SHA-256 校验值 |
| PUBLIC_FILES.txt | 源码包公开文件清单 |

文件名中的版本来自 extension/manifest.json。将来发布新版本时，同步修改版本号、CHANGELOG.md 和 RELEASE_NOTES.md，再测试、打包。

## 创建 Release

1. 按 [开发说明](DEVELOPMENT.md) 检查真实网页功能。
2. 确认当前源码已经提交并推送。
3. 在 GitHub 仓库的 Releases 中创建版本，标签填写 v0.16.1，标题填写 deepseek-quotalk v0.16.1。
4. 将 [RELEASE_NOTES.md](RELEASE_NOTES.md) 的内容作为发布说明，记录实际做过的浏览器验证。
5. 附上本次安装包、源码包、SHA256SUMS.txt 和 PUBLIC_FILES.txt，核对附件版本后发布。

不要把模拟检查写成“所有浏览器实测通过”。回答标签页需要保留，小窗历史刷新后不保留，网页与浏览器调度可能影响同步；具体范围在版本说明中已有描述。

动画原作：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。素材获取与分类参考：[Refining-colors/pet-with-you](https://github.com/Refining-colors/pet-with-you)。发布介绍和发行包均须保留署名及非商用素材说明，完整含素材发行包不能宣称全部采用 MIT。
