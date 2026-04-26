# IForm-AI H5 页面需求文档

## 1. 项目目标

在当前工作空间中建设一个 H5 业务系统页面，包含：

1. 首页参数录入页
2. 提交后跳转的详情多页签页面
3. 基于配置文件维护的接口地址与环境域名配置

页面整体要求保持统一的蓝色渐变玻璃风格，适配移动端与桌面端。

---

## 2. 首页需求

首页文件：

- `templates/index.html`
- `static/js/app.js`
- `static/css/style.css`

### 2.1 首页定位

首页用于录入调用业务系统所需参数，录入后进入详情页。

### 2.2 首页参数

首页需要包含以下参数：

1. `租户 ID`
   - 字段名：`ytenant_id`
   - 类型：文本输入
   - 非必填

2. `表单Id`
   - 字段名：`pkBo`
   - 类型：文本输入
   - 必填

3. `单据Id`
   - 字段名：`pkBoins`
   - 类型：文本输入
   - 必填

4. `授权方式`
   - 字段名：`authType`
   - 类型：下拉选择
   - 必填

5. `所属环境`
   - 字段名：`environment`
   - 类型：下拉选择
   - 必填
   - 位置：表单最下方

### 2.3 授权方式

首页新增一级参数 `授权方式`，用于控制后续调用业务系统接口时的授权入参。

授权方式选项如下：

1. `sso授权`
2. `yht_token授权`

### 2.4 授权方式联动字段

#### 2.4.1 选择 `sso授权` 时

需要展示一组 SSO 授权参数：

1. `SSO 链接`
   - 字段名：`ssoUrl`
   - 必填

2. `密钥`
   - 字段名：`secretKey`
   - 必填

3. `链接密码`
   - 字段名：`linkPassword`
   - 非必填

说明：

1. 这三个字段是一组
2. 该组参数用于后续通过 SSO 认证业务系统授权

#### 2.4.2 选择 `yht_token授权` 时

隐藏 SSO 参数组，改为展示：

1. `yht_token`
   - 字段名：`yhtToken`
   - 必填

说明：

1. 该参数用于后续通过 `yht_token` 方式调用业务系统接口时作为授权入参

### 2.5 所属环境选项

下拉选项如下：

1. 测试
2. 日常
3. 预发
4. 核心1
5. 核心2
6. 核心3
7. 核心4
8. 商开
9. 海外

默认选中：

- `测试`

### 2.6 首页交互

1. 页面加载时支持从 `localStorage` 回填参数
2. 参数变更时自动保存到 `localStorage`
3. 提交时进行前端校验
4. 校验通过后跳转到详情页
5. 参数通过 URL Query 传递到详情页
6. 重置时清空本地缓存并恢复默认环境和默认授权方式
7. 授权方式切换时动态显示对应参数组

### 2.7 首页校验规则

1. `租户 ID` 非必填
2. `表单Id` 必填
3. `单据Id` 必填
4. `所属环境` 必填
5. `授权方式` 必填
6. 选择 `sso授权` 时：
   - `ssoUrl` 必填
   - `secretKey` 必填
   - `linkPassword` 非必填
   - `ssoUrl` 必须为合法 `http/https` URL
7. 选择 `yht_token授权` 时：
   - `yhtToken` 必填
8. 校验失败时给出中文提示

---

## 3. 首页样式需求

### 3.1 整体风格

1. 背景使用蓝色主题渐变
2. 卡片使用玻璃拟态风格
3. 页面整体居中
4. 尽量避免整页滚动条

### 3.2 当前样式约束

1. 输入区域高度需要适当压缩
2. 标题区、卡片内边距、输入框高度、按钮高度均已做轻量压缩
3. 下拉框本体需保持圆角、边框与输入框一致
4. 授权参数组需要使用独立分组容器进行视觉区分

### 3.3 样式说明

浏览器原生 `select` 展开后的面板样式无法完全通过 CSS 控制，尤其是圆角。当前只统一控制下拉框本体样式；如果后续要求展开层完全自定义，需要改为自定义下拉组件。

---

## 4. 详情页需求

详情页文件：

- `templates/detail.html`
- `static/js/detail.js`
- `static/css/style.css`

### 4.1 详情页定位

首页提交后进入详情页，根据传入参数调用业务系统接口并渲染数据。

### 4.2 详情页视觉要求

1. 保持与首页相同的蓝色渐变背景
2. 保持与首页相同的玻璃卡片风格
3. 使用宽版容器展示更多信息

### 4.3 详情页内容结构

详情页包括：

1. 顶部返回首页入口
2. 请求状态展示
3. 参数摘要区域
4. 多页签内容区域

### 4.4 参数摘要展示

详情页参数摘要需要展示：

1. 所属环境
2. 环境域名
3. 租户 ID
4. 表单Id
5. 单据Id
6. 授权方式
7. 若为 `sso授权`：
   - SSO 链接
   - 密钥
   - 链接密码
8. 若为 `yht_token授权`：
   - yht_token

说明：

1. 密钥、链接密码、`yht_token` 需要脱敏显示
2. 参数摘要文案需与首页一致

### 4.5 详情页页签

详情页包含以下页签：

1. 表单配置信息
2. 单据数据信息
3. 流程审批信息
4. 业务日志
5. Jira问题分析

### 4.6 页签渲染要求

1. 每个页签独立加载对应接口
2. 每个页签单独展示数据
3. 页签之间互不阻塞
4. 某个页签失败不影响其他页签渲染
5. 支持对象、数组、嵌套结构的自动渲染
6. 支持空态、加载态、错误态

### 4.7 详情页交互

1. 进入详情页后自动加载数据
2. 顶部提供“重新加载”按钮
3. 支持切换页签查看不同数据内容
4. 缺少首页参数时要提示返回首页重新提交

### 4.8 授权参数传递要求

详情页在调用业务系统接口时，需要将首页传入的授权参数继续作为请求参数带给后端：

1. 若为 `sso授权`：
   - 传递 `ssoUrl`
   - 传递 `secretKey`
   - 传递 `linkPassword`

2. 若为 `yht_access_token 授权`：
   - 传递 `yht_access_token`

---

## 5. 接口配置需求

### 5.1 配置文件位置

详情页接口配置文件：

- `static/config/detail-config.js`

### 5.2 配置方式

所有页签接口地址必须通过配置文件维护，不允许写死在页面脚本中。

### 5.3 当前配置结构

配置内容包括：

1. 请求超时时间
2. 本地存储 key
3. 环境域名配置
4. 各页签接口路径配置

参考结构：

```js
window.IFormDetailConfig = {
    requestTimeout: 30000,
    storageKey: 'iform_ai_params',
    environments: {
        test: { label: '测试', baseUrl: 'https://bip-test.yonyoucloud.com' }
    },
    tabs: {
        formConfig: {
            title: '表单配置信息',
            paths: {
                version: '/api/business/form-version',
                model: '/api/business/form-model'
            }
        },
        document: { title: '单据数据信息', path: '/api/business/document-data' },
        approval: { title: '流程审批信息', path: '/api/business/process-approval' },
        businessLog: { title: '业务日志', path: '/api/business/business-log' },
        jiraAnalysis: { title: 'Jira问题分析', path: '/api/business/jira-analysis' }
    }
};
```

---

## 6. 环境域名需求

业务系统请求地址需要按以下规则拼接：

`环境域名 + 页签接口 path`

### 6.1 已配置环境域名

1. 测试
   - `https://bip-test.yonyoucloud.com`

2. 日常
   - `https://bip-daily.yonyoucloud.com`

3. 预发
   - `https://bip-pre.yonyoucloud.com`

4. 核心1
   - `https://c1.yonyoucloud.com`

5. 核心2
   - `https://c2.yonyoucloud.com`

6. 核心3
   - `https://c3.yonyoucloud.com`

7. 核心4
   - `https://c4.yonyoucloud.com`

### 6.2 未配置环境域名

以下环境目前仅保留选项，域名待补充：

1. 商开
2. 海外

### 6.3 未配置环境的处理方式

当用户选择了未配置域名的环境时：

1. 详情页需明确提示当前环境缺少域名配置
2. 不发起真实接口请求
3. 页面状态显示为错误态

---

## 7. 数据获取与回退策略

### 7.1 真实请求

详情页通过配置文件读取：

1. 环境域名
2. 页签接口路径

拼接后发起真实请求。

### 7.2 本地预览回退

在以下场景允许使用 mock 数据：

1. 页面通过 `file://` 直接打开
2. 请求因本地预览环境导致无法访问

### 7.3 mock 数据作用

1. 方便本地预览页面效果
2. 在未接入真实接口时完成布局联调
3. 不作为正式线上逻辑依赖

---

## 8. 参数命名约束

前端展示文案与实际传参键名分离：

1. 展示名称：`表单Id`
   - 实际字段：`pkBo`

2. 展示名称：`单据Id`
   - 实际字段：`pkBoins`

要求：

1. 首页展示名称使用新文案
2. 详情页参数摘要使用新文案
3. URL Query 与接口请求参数名保持原字段不变

---

## 9. 当前工程文件清单

核心文件包括：

1. `templates/index.html`
2. `templates/detail.html`
3. `static/js/app.js`
4. `static/js/detail.js`
5. `static/config/detail-config.js`
6. `static/css/style.css`
7. `PROJECT_REQUIREMENTS.md`

---

## 10. 后续待补充内容

后续继续开发时优先补充：

1. 商开环境域名
2. 海外环境域名
3. 4 个页签的真实接口路径
4. 真实接口返回 JSON 结构说明
5. 各页签的字段映射规则
6. 是否需要将原生下拉升级为完全自定义下拉组件
7. 是否需要在详情页中按授权方式对请求头或请求体做进一步区分

---

## 11. 后续开发建议

1. 后续任何接口地址变更，优先修改 `static/config/detail-config.js`
2. 后续任何页面字段文案变更，同时检查首页和详情页摘要
3. 若后续出现浏览器兼容性需求，优先检查原生 `select`、`backdrop-filter`、`100dvh`
4. 若页签展示字段越来越复杂，建议后续按页签拆分独立渲染器模块
5. 若授权逻辑继续扩展，建议后续将不同授权方式抽成独立授权策略模块
---

## 12. Current Effective Requirement Updates On 2026-04-22

### 12.1 Auth Parameter

1. The active token parameter name is `yht_access_token`.
2. Homepage input, URL Query, detail summary display, and real API request headers all use `yht_access_token`.
3. Legacy `yhtToken` and `authType=yht_token` are only retained for compatibility and must be normalized to `yht_access_token`.

### 12.2 Detail Tabs

1. `表单配置信息`
2. `单据数据信息`
3. `流程审批信息`
4. `业务日志`
5. `Jira问题分析`

`表单版本信息` and `表单模型信息` have been merged into `表单配置信息`.

### 12.3 Real Data Scope

1. `表单配置信息`, `单据数据信息`, and `流程审批信息` are connected to real business APIs.
2. `业务日志` and `Jira问题分析` still use mock data in the current phase.

### 12.4 Request Dependency

1. Request `getFormData` first as the shared source.
2. Parse the `data` field from `getFormData` as a JSON string payload.
3. Request `billVue.json` with `head.pk_temp`.
4. Request `loadDataJson` with `head.pk_procdef` and `head.pk_procdefins`.
5. Document rendering should combine form config field definitions to map dynamic field ids to readable titles.

### 12.5 Active API Paths

1. `单据数据信息`: `/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData`
2. `表单配置信息`: `/yonbip-ec-iform/iform_ctr/rt_ctr/{pk_temp}/billVue.json`
3. `流程审批信息`: `/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson`

### 12.6 Headers And CORS

1. Real requests use header `yht_access_token`.
2. `x-xsrf-token` is not required in the current phase.
3. Browser direct requests from `file://` or other non-business origins may trigger CORS preflight.
4. If the target server does not allow `yht_access_token` in `Access-Control-Allow-Headers`, browser direct integration will fail.
5. Stable integration should use same-origin deployment or a server-side proxy when cross-origin headers are not opened.

## 13. Current Effective Requirement Updates On 2026-04-24

### 13.1 Homepage Default Mode

1. Homepage default form parameter mode is `单据链接 URL`.
2. Homepage default auth mode is `yht_access_token`.
3. The default pair above must apply on first load, after reset, and when local cache does not provide an explicit value.

### 13.2 Approval Time Rendering

1. In `流程审批信息`, date-time fields that semantically represent time/date and whose values match ISO strings such as `2026-04-14T15:30:27.518+08:00` must be formatted before rendering.
2. The display format is `YYYY-MM-DD HH:mm:ss`.
3. This formatting rule only applies to approval-tab presentation and does not change the original backend payload.

### 13.3 Form Config Columncode

1. In `表单配置信息`, the `主表字段` table must include a `columncode` column.
2. In `表单配置信息`, each sub-table `子字段明细` table must include a `columncode` column.
3. `columncode` should read from component config `columncode`, and should also accept `columnCode` as a compatibility alias.

## 14. Current Effective Requirement Updates On 2026-04-26

### 14.1 Form Config TableLayout Hierarchy

1. In `表单配置信息`, `主表字段` and each sub-table `子字段明细` must preserve `TableLayout` rows instead of flattening all child controls into one level.
2. `TableLayout` is used to express table ownership and hierarchy only, and must not be counted in control totals.
3. Controls rendered under a `TableLayout` must display their所属表格 information so users can identify which table a control belongs to.
4. Table rows append the `表格` marker after the table name; normal controls do not display a separate `控件` marker.
5. Control count copy is standardized as `N个控件`.

### 14.2 Form Config Collapse Behavior

1. The `主表字段` section must support collapse and expand without changing the current table-style rendering.
2. Each sub-table `子字段明细` section must support collapse and expand without changing the current table-style rendering.
3. Each `TableLayout` row must support collapse and expand of its descendant rows so large hierarchies can be browsed progressively.
4. The `主表字段` section toggle entry should be placed before the title on the left side.

### 14.3 Environment Switch And URL Resolve Consistency

1. When the homepage environment changes, the client must clear environment-bound inputs and derived values, including `yht_access_token`, `billUrl`, `pkBo`, and `pkBoins`.
2. In URL resolve mode, the homepage must validate that the business URL matches the selected environment before sending `/api/resolve-form-params`.
3. `/api/resolve-form-params` must support multi-hop redirect parsing and should attempt to extract `formId` and `formInstanceId` from query, fragment, or response text.
4. If the redirect chain lands on a login or auth-failure page, the proxy should return a clear error indicating that the current environment's `yht_access_token` may be invalid or expired.

### 14.4 Form Config Key Property Display

1. In `表单配置信息`, the `表单属性` section must display these fields as the key property set: `canCopy`, `canSavePDF`, `canShare`, `canWebPrint`, and `isMultiBPM`.
2. The labels must be rendered respectively as `允许复制提交`, `可另存为PDF`, `可分享`, `可网页打印`, and `是否是多流程`.
3. `BPMTabView` must not be displayed in the `表单属性` section.
4. Boolean-like values in this section must accept `boolean`, `"true"/"false"`, and `1/0` style payloads before rendering to `是/否`.
5. Missing values in this section must render as `-`.

### 14.5 Approval Activity Summary Display

1. In `流程审批信息`, a tree-detail node named `流程环节信息` must be rendered from `loadDataJson.instanceInfo.historicActivityInstances`.
2. Each activity item in `流程环节信息` must display only `activityId` and `activityName`, labeled as `环节Id` and `环节名称`.
3. `流程环节信息` must be displayed before `审批记录` in the approval-tab tree details.
4. The old `流程轨迹` presentation should not be rendered once `流程环节信息` is used as the activity summary.
5. `historicActivityInstances` must preserve backend order and must not be deduplicated on the client, even when multiple entries share the same activity id or activity name.

### 14.6 Jira Analysis Effective Scope

1. `Jira问题分析` is no longer treated as mock-only content in the current phase; it is connected through a dedicated local proxy to the Jira system.
2. The Jira system base target is fixed and does not follow the selected homepage environment.
3. Jira requests must not use `yht_access_token`; they must use a Jira session `Cookie`.
4. The browser client must send Jira auth through `x-jira-cookie` to the local proxy, and the proxy must convert it to the real `Cookie` header before forwarding.
5. The proxy endpoints are:
   - `POST /api/jira/issue-table`
   - `GET /api/jira/issue-detail`

### 14.7 Jira Analysis Input And Storage Rules

1. The homepage must provide an optional `Jira工单号` input and carry it to the detail page.
2. `Jira系统Cookie` must only be entered and maintained inside the `Jira问题分析` tab.
3. `Jira系统Cookie` must not be written into the detail-page URL query.
4. `Jira系统Cookie` must not be shown in the top summary area.
5. `Jira系统Cookie` should be stored only in `sessionStorage` for the current browser session.

### 14.8 Jira Analysis Loading Strategy

1. `Jira问题分析` must not block the initial rendering of `表单配置信息`, `单据数据信息`, `流程审批信息`, and `业务日志`.
2. The detail page should load the core tabs first and then load the Jira tab asynchronously.
3. Missing Jira cookie, missing Jira issue key, or Jira auth failure must only affect the Jira tab itself.

### 14.9 Jira Analysis UI Structure

1. The `Jira问题分析` tab should render these sections in order:
   - `当前工单基础信息`
   - `工单详细内容`
   - `相似场景工单列表`
   - `智能分析预留`
   - `近期工单列表`
   - `原始返回数据`
2. The old `当前工单概述` block must not be rendered.
3. The old `关联工单列表` label must be replaced with `近期工单列表`.
4. `相似场景工单列表` is a reserved independent area for future skill / agent / LLM results and must not reuse the recent-issue list payload.
5. `近期工单列表` must be displayed below `智能分析预留`.

### 14.10 Jira Field Parsing Rules

1. `当前工单基础信息` must not display `查询结果总数`.
2. `当前工单基础信息` must additionally surface:
   - `剩余处理时长`
   - `SOP单据号`
   - `外部系统编号`
3. The old `当前工单详细字段` label must be replaced with `工单详细内容`.
4. `到期日` should be rendered as `YYYY-MM-DD HH:mm` when time exists, otherwise `YYYY-MM-DD`.
5. `解决方案` must be extracted only from the field whose `label` is exactly `解决方案`.
6. The client must not fall back to `AI处理结果`, `处理方案`, `建议措施`, or other nearby labels when `解决方案` is absent.

### 14.11 Jira Recent Issue Detail Interaction

1. Each row in `近期工单列表` must provide a `查看详情` action.
2. Clicking `查看详情` must load that row's Jira detail payload through the same detail proxy endpoint.
3. The recent-issue detail area must include the parsed `解决方案` field.
4. After rendering the recent-issue detail area, the page must auto-scroll to that area so users do not need to manually search for it in a long page.
