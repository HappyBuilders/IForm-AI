---
name: iform-ai
description: IForm-AI H5业务系统 - 用于调用现有业务系统接口的智能表单系统。支持参数配置(ytenant_id, pkBo, pkBoins)并展示业务数据。适用于移动端H5页面开发。
---

# IForm-AI H5业务系统

## 概述

IForm-AI是一个基于H5的移动优先业务系统前端，用于连接现有业务系统API，提供参数输入界面和数据展示功能。

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

然后访问：`http://localhost:8080/templates/index.html`

**代理功能说明**：
- 所有API请求自动通过代理转发
- 支持测试/日常/预发/核心1-4等环境
- 自动添加CORS响应头
- 支持 `yht_access_token` 授权头透传

### 方式2：直接打开HTML文件

在浏览器中打开 `assets/templates/index.html` 即可使用。

**注意**：直接打开会遇到跨域问题，详情页无法调用真实接口，只能使用Mock数据。

### 方式3：部署到Web服务器

将 `assets/` 目录部署到与业务系统同域的服务器：

```bash
# 使用Python简单HTTP服务器（无代理功能）
cd assets && python -m http.server 8080

# 或使用Node.js http-server
npx http-server assets -p 8080
```

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
浏览器 → localhost:8080/api/proxy → 代理服务器 → BIP服务器
              ↑                              ↓
         无跨域问题                    服务器间无CORS限制
```

## 快速开始

### 1. 启动代理服务器

```bash
cd E:\CLAUDE_IFORM_AI\IForm-AI
python scripts/proxy-server.py
```

### 2. 访问首页

浏览器打开：`http://localhost:8080/templates/index.html`

### 3. 输入参数

- **表单Id** (pkBo): 业务对象ID
- **单据Id** (pkBoins): 业务实例ID
- **授权方式**: 选择 yht_access_token授权 或 SSO授权
- **所属环境**: 选择测试/日常/预发等

### 4. 查看详情

点击提交后进入详情页，5个页签自动加载数据。

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
