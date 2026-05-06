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
2. `update-config.py` 会优先从本机 YonClaw Gateway 同步当前智能体配置，并更新 `assets/static/config/runtime-config.json` 中的 `yonclaw` 节点。
3. 如果 Gateway 暂时不可用，则保留当前 `runtime-config.json` 配置继续启动。

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
- **按索引调度参考文档** - 先根据 `references` 目录结构和关键词入口定位，再按需加载命中文档分片
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
├── forms/
│   └── 对公付款申请单/
│       └── 提交校验.md
├── troubleshooting/
│   └── 审批流/
│       └── 节点不流转.md
└── readme.md
```

使用规则：

1. 不要一次性扫描整个 `references`。
2. 将 `references/` 目录结构本身视为“问题分类索引”与“关键词入口”。
3. 优先根据一级目录定位大类：
   - `references/forms/`: 表单操作说明文档
   - `references/troubleshooting/`: 问题排查文档
4. 再根据里层每一级目录名、文件名提取关键词，筛选最相关的少量文档。
5. 对命中文档按内容分片，只加载与当前问题最相关的片段。
6. 已读取过的索引和文档片段优先复用缓存，避免重复加载。

分析流程：

1. 先看目录索引，不全量读文档。
2. 从用户问题中提取业务词、异常词、模块词、表单名。
3. 用这些关键词去匹配目录名和文件名。
4. 仅在命中后读取对应文档内容，并优先读取相关分片。
5. 若证据不足，再逐步扩大到相邻目录，不允许直接全库扫描。

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
