---
name: iform-ai
description: IForm-AI H5业务系统,表单业务 - 用于调用现有业务系统接口的智能分析表单系统。支持各环境参数配置(ytenant_id, pkBo, pkBoins)并展示业务数据，工单问题定位分析。
---

# IForm-AI H5业务系统

## 概述

IForm-AI 是一个基于H5的优先业务系统,基表单业务系统的前端服务，用于连接现有业务系统API，提供排查问题参数输入界面和数据展示及问题定位分析功能。

## 核心功能

1. **参数输入表单**
   - ytenant_id: 租户ID
   - pkBo: 业务对象ID
   - pkBoins: 业务实例ID
   - 授权方式: SSO授权 / yht_access_token授权
   - 所属环境: 测试/日常/预发/核心1-4

2. **API调用**
   - 自动调用业务系统接口
   - 支持超时和重试机制
   - 结果JSON格式化展示
   - **代理服务器解决跨域问题**

3. **用户体验**
   - 响应式设计，适配移动端
   - 加载状态指示
   - Toast消息提示
   - URL参数自动填充
   - LocalStorage本地缓存
   - 多页签详情展示

## 文件结构

```
IForm-AI/
├── SKILL.md                          # 本文件
├── assets/
│   ├── PROJECT_REQUIREMENTS.md      # 需求文档
│   ├── templates/
│   │   ├── index.html               # 首页模板
│   │   └── detail.html              # 详情页模板
│   └── static/
│       ├── config/
│       │   └── detail-config.js     # 接口配置
│       ├── css/
│       │   └── style.css            # 样式文件
│       └── js/
│           ├── app.js               # 首页逻辑
│           └── detail.js            # 详情页逻辑
├── scripts/                          # 服务端脚本
│   ├── start-server.py              # 简单HTTP服务器
│   └── proxy-server.py              # 带代理的HTTP服务器（解决跨域）
└── references/                       # API文档等
```

## 使用方法

### 方式1：使用代理服务器（推荐 - 解决跨域）

启动带代理功能的服务器，自动解决浏览器跨域限制：

```bash
# 在项目根目录执行
python scripts/proxy-server.py
```

启动说明：

1. 服务启动前会自动执行 `python scripts/update-config.py`。
2. `update-config.py` 会自动检测并刷新 `assets/static/config/runtime-config.json` 中的 `yonclaw` 节点。
3. `yonclaw` 配置来源优先级固定为：**环境变量 > 本机 profile 配置文件 `openclaw.json` > 现有 `runtime-config.json` > 默认值**。
4. `gatewayUrl` 必须做规范化处理：
   - 若已是完整的 `/v1/chat/completions` 地址，则直接保留；
   - 若只拿到基础地址（如 `http://127.0.0.1:29179`）或 `/v1`，则自动补全为 `/v1/chat/completions`；
   - 若值为空，则继续按优先级回退。
5. **禁止**把本地 YonClaw Control UI 页面或 `/v1/config`、`/v1/status` 之类控制台探测地址当成最终 `gatewayUrl` 配置来源。
6. 若环境变量、本机 profile 配置文件和现有运行时配置都不可用，才允许回退到默认值继续启动。

如需手动更新配置，也可以先单独执行：


```bash
# 在项目根目录执行
python scripts/update-config.py
python scripts/proxy-server.py
```


然后访问：`http://localhost:18080/templates/index.html`

**代理功能说明**：
- 所有API请求自动通过代理转发
- 支持测试/日常/预发/核心1-4等环境
- 自动添加CORS响应头
- 支持 `yht_access_token` 授权头透传

## API接口规范

### 真实接口（详情页调用）

| 页签 | 接口路径 | 说明 |
|------|---------|------|
| 单据数据信息 | `/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData` | 获取单据主数据 |
| 表单配置信息 | `/yonbip-ec-iform/iform_ctr/rt_ctr/{pk_temp}/billVue.json` | 获取表单配置 |
| 流程审批信息 | `/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson` | 获取流程审批数据 |
| 业务日志 | Mock数据 | 本期使用Mock |
| Jira问题分析 | Mock数据 | 本期使用Mock |

### 请求头

```javascript
{
    'yht_access_token': 'your-token-here'  // 授权令牌
}
```

### 响应格式

```json
{
    "code": 200,
    "message": "success",
    "data": {
        // 业务数据
    }
}
```

## 环境域名配置

代理服务器支持以下环境：

| 环境 | 域名 |
|------|------|
| test | https://bip-test.yonyoucloud.com |
| daily | https://bip-daily.yonyoucloud.com |
| pre | https://bip-pre.yonyoucloud.com |
| c1 | https://c1.yonyoucloud.com |
| c2 | https://c2.yonyoucloud.com |
| c3 | https://c3.yonyoucloud.com |
| c4 | https://c4.yonyoucloud.com |

## 跨域问题解决方案

### 问题描述
浏览器直接通过 `fetch` 调用用友BIP接口会触发CORS同源策略限制。

### 解决方案对比

| 方案 | 适用场景 | 操作 |
|------|---------|------|
| **代理服务器** | 本地开发调试 | 运行 `python scripts/proxy-server.py` |
| 同源部署 | 正式环境 | 部署到BIP服务器静态目录 |
| 禁用安全策略 | 临时测试 | 启动特殊Chrome（不推荐） |

### 代理服务器原理
```
浏览器 → localhost:18080/api/proxy → 代理服务器 → BIP服务器
              ↑                               ↓
         无跨域问题                    服务器间无CORS限制
```

## 快速开始

### 1. 启动代理服务器

```bash
# 在当前项目根目录执行
python scripts/proxy-server.py
```

### 2. 访问首页

浏览器打开：`http://localhost:18080/templates/index.html`

### 3. 输入参数

- **表单Id** (pkBo): 业务对象ID
- **单据Id** (pkBoins): 业务实例ID
- **授权方式**: 选择 yht_access_token授权 或 SSO授权
- **所属环境**: 选择测试/日常/预发等

### 4. 查看详情

点击提交后进入详情页，5个页签自动加载数据。

## 直接对话问答能力（无需启动服务）

除了启动H5系统外，本技能还支持直接对话问答！你可以直接在YonClaw对话中问我表单设计相关问题。

### 能力说明

- **无需启动H5服务** - 直接对话即可使用
- **按快速索引调度参考文档** - 优先读取 `references/QUICK_INDEX.md`，再按需加载命中文档分片
- **专业表单设计专家** - 理解表单业务，能从文档中找到相似场景
- **问题诊断与解决方案** - 结合问题描述给出具体解决方案

### 使用方式

直接在对话中问我，例如：

> "如何设置累计发票已冲销金额的校验规则？等于0时禁止下一步"
> "表单设计中，如何实现提交前校验？"
> "对公付款申请单中，如何配置字段的必填校验？"

### references 文件夹

参考文档放置位置：
```
skill根目录/references/  （任意层级、任意子目录）
```

支持的文件：
- 所有 `.md` 格式的文档
- 任意层级的子目录都可作为关键词索引入口

示例：
```
references/
├── QUICK_INDEX.md
├── TROUBLESHOOTING_PLAYBOOK.md
├── forms/
│   └── 对公付款申请单/
│       └── 提交校验.md
├── troubleshooting/
│   └── 审批流/
│       └── 节点不流转.md
└── readme.md
```

使用规则：

1. **优先读取 `references/QUICK_INDEX.md`，不要一上来递归扫描整个 `references/`。**
2. 将 `QUICK_INDEX.md` 视为“自然语言问题 → 文档路径”的第一入口。
3. 若 `QUICK_INDEX.md` 已命中问题，直接读取其中推荐的 1~3 篇文档，不再做全目录遍历。
4. 只有当 `QUICK_INDEX.md` 证据不足时，才退回到目录级索引：
   - `references/forms/`: 表单操作说明文档
   - `references/troubleshooting/`: 问题排查文档
5. 再根据里层目录名、文件名提取关键词，筛选最相关的少量文档。
6. 对命中文档按内容分片，只加载与当前问题最相关的片段。
7. 已读取过的索引和文档片段优先复用缓存，避免重复加载。
8. 在 Windows 环境下，如遇中文路径输出乱码，优先使用稳定的 UTF-8 方式读取少量目标路径，不要因为编码问题反复全库探测。
9. **能基于现有少量证据回答时，优先直接回答，不要为了“更完整”继续扩读。**
10. **禁止为了补强推断去读取边缘相关文档；若参考资料没有直接说明，就明确写“参考依据不足”。**

分析流程：

1. 先从用户问题提取业务词、异常词、模块词、表单名。
2. 先读 `references/QUICK_INDEX.md`，按关键词命中高频问题分类。
3. 如果用户是在问“为什么异常 / 为什么不生效 / 帮我排查”，紧接着优先读 `references/TROUBLESHOOTING_PLAYBOOK.md`，按固定排查模板走，不要每次重新设计排查路径。
4. 直接读取索引或手册里推荐的 1~3 篇文档。
5. 若命中文档已足够回答，就停止扩展。
6. 若证据不足，再扩大到相邻分类目录，不允许直接全库扫描。
7. 若用户同时提供 `pkBo / pkBoins / 环境`，优先结合 H5 页面/接口真实数据再回看命中文档。

### 场景分析极速路径（强约束）

当任务明确是“场景分析 / 诊断 / 原因分析 / 功能说明 / 方案建议”，且调用方已明确要求**忽略业务数据、临时文件中的各页签 JSON、以及任何单据/审批/日志上下文**时，必须优先走下面这条极速路径：

1. **只基于问题描述 + references/说明文档分析，不读取业务数据，不要求补业务数据。**
2. **默认只读 3 份文档：**
   - `references/QUICK_INDEX.md`
   - `references/TROUBLESHOOTING_PLAYBOOK.md`（仅当问题属于“异常/不生效/排查/诊断”时读取）
   - 索引命中的 1 篇核心文档
3. 若第 3 步仍不足，再额外补 **1 篇** 最相关文档；**总读取上限默认 4 篇**。
4. 达到 4 篇后仍无直接证据时，**停止扩读**，在答案中明确写出：
   - 当前高概率判断
   - 已使用的参考依据
   - 缺失的关键参考依据
5. **不要因为字段名、业务对象名、表单名看起来相关，就自动扩读“公式/交互/子表/权限”等相邻文档。** 只有当 `QUICK_INDEX.md` 或 `TROUBLESHOOTING_PLAYBOOK.md` 明确推荐时，才允许继续读。
6. **禁止使用全库搜索、递归扫描或大范围 grep/rg 作为默认路径。** 只有当索引文件缺失、损坏或无法命中时，才允许退回到目录级筛选。
7. 输出优先给出：
   - 场景理解
   - 参考依据
   - 功能使用建议
   - 配置或操作方案
   - 最终结论
8. 若参考资料未直接说明某个机制（例如提示语优先级、公式取值时机、版本生效规则），必须明确说“**现有参考资料没有足够证据直接证明该点**”，不要把经验判断包装成文档结论。

---

## 自定义扩展

### 添加新参数

1. 在 `index.html` 中添加新的表单字段
2. 在 `app.js` 的 `getFormData()` 中添加新字段
3. 在 `validateForm()` 中添加验证逻辑

### 修改样式

编辑 `style.css`，系统使用CSS变量和现代布局技术，易于定制。

### 添加新功能

参考 `app.js` 中的模块化结构，在IIFE中添加新功能模块。

### 配置新环境

编辑运行时配置文件：

- `assets/static/config/runtime-config.json`
- `assets/static/config/runtime-config.js`

示例：

```json
{
  "environments": {
    "test": {
      "label": "测试",
      "baseUrl": "https://bip-test.yonyoucloud.com"
    },
    "newenv": {
      "label": "新环境",
      "baseUrl": "https://example.yonyoucloud.com"
    }
  },
  "jira": {
    "enabled": false,
    "baseUrl": ""
  }
}
```

如需启用 Jira 代理，请先在目标平台完成网络域名注册，再通过运行时配置注入 `jira.baseUrl`；默认配置不包含任何非白名单真实域名。

## 技术栈

- **前端**: 原生HTML5 + CSS3 + ES6+
- **样式**: 现代CSS (Flexbox, Grid, 自定义属性)
- **无依赖**: 零第三方库，轻量高效

## 浏览器兼容性

- Chrome 60+
- Firefox 60+
- Safari 12+
- Edge 79+
- iOS Safari 12+
- Chrome for Android 60+
