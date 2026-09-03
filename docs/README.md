# 文档索引

| 文档                                                             | 面向            | 内容                                                 |
| ---------------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| [../AGENTS.md](../AGENTS.md)                                     | AI / 接手开发者 | 编码约束与易错点。**改代码前先看这个**               |
| [deployment.md](deployment.md)                                   | 部署者          | Docker、Vercel 部署方案，含弹幕服务配置              |
| [release.md](release.md)                                         | 维护者          | 分支模型、版本号规则、发布与打 tag 的完整流程        |
| [performance-baseline.md](performance-baseline.md)               | 做性能优化时    | 基线采集方法与固定场景，保证优化前后可比             |
| [messages-tracking-decisions.md](messages-tracking-decisions.md) | 动消息/追更时   | 该模块被否决的方案、被数据推翻的判断、故意不修的边界 |

部署快速上手看 [deployment.md](deployment.md)，环境变量样例看 [.env.example](../.env.example)。

各文档职责不重叠：`AGENTS.md` 记**约束**，`deployment.md` 记**部署**，`messages-tracking-decisions.md` 记**决策依据**，`release.md` 记**流程**，`performance-baseline.md` 记**方法**。实现细节看代码，改动历史看 git log。
