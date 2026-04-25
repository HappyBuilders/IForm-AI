# 需求修改记录

## 2026-04-22 详情页 JSON 展示优化

### 背景

系统详情页右侧接口 JSON 结果原先采用通用卡片递归渲染。该方式适合调试和快速查看原始结构，但视觉上更像通用 JSON 查看器，不够符合正式业务系统的数据呈现方式。

### 修改内容

将系统详情页右侧 JSON 自动渲染改为“表格式 + 树形明细”的混合展示。

### 展示规则

1. 顶层标量字段进入“基础信息”二维表格。
2. 对象、数组和嵌套结构进入“树形明细”区域。
3. 扁平对象数组优先渲染为明细表格，便于横向对比每一行数据。
4. 空值统一显示为占位符，空对象和空数组保留空态提示。
5. 移动端保留横向滚动，避免复杂表格挤压变形。

### 涉及文件

1. `assets/static/js/detail.js`
2. `assets/static/css/style.css`

### 目标

提升详情页右侧数据区的业务系统质感、字段可读性和复杂 JSON 结构的层级可理解性。

## 2026-04-22 详情页新增诊断类页签

### 修改内容

在系统详情页原有 4 个页签基础上，新增 2 个页签：

1. 业务日志
2. Jira问题分析

### 展示规则

1. 两个新增页签与原有页签保持一致的数据加载、错误隔离、空态和自动渲染规则。
2. 业务日志用于展示接口调用、业务操作、异常堆栈、链路追踪和日志统计等信息。
3. Jira问题分析用于展示关联 Jira、影响范围、处理建议和排查结论等信息。
4. 新增页签数据同样使用“基础信息表格 + 树形明细”的混合展示方式。

### 涉及文件

1. `assets/templates/detail.html`
2. `assets/static/config/detail-config.js`
3. `assets/static/js/detail.js`

## 2026-04-22 详情页表单配置页签合并

### 修改内容

将详情页原有“表单版本信息”和“表单模型信息”两个页签合并为一个页签，名称为“表单配置信息”。

### 展示规则

1. 页面上只展示一个“表单配置信息”页签。
2. 该页签内部仍分别加载表单版本接口和表单模型接口。
3. 两类结果在同一页签中合并展示，按“表单版本信息”和“表单模型信息”两个结构节点组织。
4. 若其中一个接口加载失败，不影响另一个接口的数据显示，失败部分展示错误信息。

### 涉及文件

1. `assets/templates/detail.html`
2. `assets/static/config/detail-config.js`
3. `assets/static/js/detail.js`

## 2026-04-22 授权 Token 参数名修正

### 修改内容

将首页和详情页中原先写作 `yht_token` / `yhtToken` 的实际授权入参修正为 `yht_access_token`。

### 兼容规则

1. 首页表单字段名改为 `yht_access_token`。
2. 首页跳转详情页时，URL Query 传递 `yht_access_token`。
3. 详情页读取、摘要展示和接口透传统一使用 `yht_access_token`。
4. 为兼容历史缓存和旧链接，前端仍可读取旧字段 `yhtToken` 和旧授权方式值 `yht_token`，但会规范化为新的 `yht_access_token` 逻辑。

### 涉及文件

1. `assets/templates/index.html`
2. `assets/static/js/app.js`
3. `assets/static/js/detail.js`

## 2026-04-22 详情页真实业务数据接入

### 修改内容

将详情页中以下 3 个页签从本地 mock 数据改为按技术方案接入真实业务系统数据：

1. 表单配置信息
2. 单据数据信息
3. 流程审批信息

业务日志和 Jira 问题分析本期仍保留 mock 数据，不修改当前展示结构和交互。

### 实现规则

1. 单据数据信息作为共享依赖源，优先请求 `getFormData` 接口。
2. 表单配置信息依赖单据接口返回的 `head.pk_temp`，再请求 `billVue.json`。
3. 流程审批信息依赖单据接口返回的 `head.pk_procdef` 和 `head.pk_procdefins`，再请求 `loadDataJson`。
4. 单据接口返回的 `data` 字段为 JSON 字符串，前端需先做二次解析后再渲染。
5. 表单配置接口返回内容虽然为 JSON 文本，但响应头可能为 `application/octet-stream`，前端需兼容文本解析。
6. 单据数据信息渲染时优先结合表单配置里的字段标题和组件类型，避免只显示动态 fieldId。
7. 真实接口请求头统一使用 `yht_access_token`，不再要求 `x-xsrf-token`。

### 涉及文件

1. `assets/static/js/detail.js`
2. `assets/static/config/detail-config.js`
3. `assets/templates/detail.html`

## 2026-04-22 详情页真实联调结论补充

### 联调范围

使用测试环境参数对以下真实接口进行了联调校验：

1. `getFormData`
2. `billVue.json`
3. `loadDataJson`

### 联调结论

1. `getFormData` 接口可正常返回业务数据。
2. `billVue.json` 可正常返回表单配置内容，但响应头实际为 `application/octet-stream;charset=UTF-8`，前端已兼容该场景。
3. `loadDataJson` 的 `processDefinitionId` 和 `processInstanceId` 已按方案从 `getFormData` 返回结果中提取并透传。
4. 当前联调所使用的这笔测试单据在审批接口返回业务提示：`当前表单已经被删除，请刷新后重试！`，该结果属于后端业务态返回，不是前端参数拼装错误。
5. 前端已补充审批接口业务错误态展示逻辑，当接口未返回审批明细而是返回 `code/status/message` 时，页面直接展示业务提示。

### 跨域限制说明

1. 当前页面若从 `file://` 或其他非业务域名直接访问测试环境接口，会触发浏览器 CORS 预检。
2. 由于目标服务端预检响应头 `Access-Control-Allow-Headers` 未放行 `yht_access_token`，浏览器会报错并拦截真实请求。
3. 若要从浏览器直接联调真实接口，后端需显式放行 `yht_access_token` 请求头；否则需通过同域部署或服务端代理方式访问。

### 涉及文件

1. `assets/static/js/detail.js`
2. `assets/智能业务表单系统详情页数据获取技术方案.md`
## 2026-04-22 详情页联调与展示修正

### 变更背景

围绕详情页联调、代理转发、字段权限展示、树形交互和环境切换问题，补充修正前端展示与本地代理适配逻辑，保证测试环境与核心环境都能按统一入口访问。

### 本次变更

1. 修正 `loadDataJson` 请求格式，改为 `params` JSON 字符串 + `_` + `_ts` 形式，保持与目标接口一致。
2. 修正 `billVue.json` 重复请求问题，为单据、表单配置、审批数据增加并发 Promise 复用，避免同一轮加载重复发送请求。
3. 单据页“基础信息”补充 `单据版本`，取值来源为 `head.version`。
4. 表单配置页“基础信息”中原“模型主键”改为 `表单版本id（pk_temp）`。
5. 单据页字段 ID、字段权限分组名、树形节点 key 等展示改为保留原始内容，不再自动按 camelCase 或下划线拆分空格。
6. 流程审批页签移除原始大对象明细展示，避免与单据页重复展示主表/子表内容。
7. 单据接口返回后，如果首页未传 `ytenant_id`，则自动从 `getFormData.head.ytenant_id` 回填到当前参数与本地缓存。
8. 树形展示区域支持点击展开/收起，并补充折叠状态下内容区显式隐藏样式。
9. 单据页“字段权限”调整到最上方展示。
10. 字段权限分组补充中文说明：
    - `fillIn` 展示为 `fillIn（发起页权限）`
    - `approveUser...` 根据 `loadDataJson.instanceInfo.historicActivityInstances` 中的 `activityId/activityName` 匹配审批环节名称
11. 字段权限每条记录补充 `控件名称`，通过表单配置中的字段元数据解析对应控件标题。
12. 本地 favicon 缺失问题通过页面内联 favicon 处理，避免浏览器默认请求 `/favicon.ico` 产生 404 噪音。
13. 本地代理请求固定走 `localhost:18080`，避免误命中其他运行在 `8080` 的本地服务。
14. 兼容核心环境编码映射，前端代理自动将：
    - `core1 -> c1`
    - `core2 -> c2`
    - `core3 -> c3`
    - `core4 -> c4`

### 涉及文件

1. `assets/static/js/detail.js`
2. `assets/static/css/style.css`
3. `assets/templates/index.html`
4. `assets/templates/detail.html`

### 备注

本次未修改上一级目录中的 `scripts/proxy-server.py` 环境枚举，仅在前端代理参数构造阶段做了兼容映射，保证现有本地代理服务可直接继续使用。

## 2026-04-23 错误提示与联调记录补充

### 变更背景

针对接口鉴权失效后的页面提示可读性，以及外部 Jira 接口联调结果，需要补充前端错误文案和联调记录，便于后续排查与交接。

### 本次变更

1. 当接口返回 `HTTP 401: Unauthorized` 时，前端统一改为提示：
   `yht_access_token 授权失效，请重新授权！`
2. 调整错误提示块排版：
   - `数据加载失败` 作为标题
   - 具体错误内容作为正文说明
   - 优化两段文字的间距、字号、颜色和换行表现，避免提示内容挤在一起
3. 对外部 Jira 接口联调进行了验证：
   - 请求地址：`https://gfjira.yyrd.com/secure/AjaxIssueEditActionu0021default.jspa`
   - 实际返回为登录页 HTML，而不是业务 Ajax 数据
   - 说明当前提供的 `Cookie` / `yht_access_token` 组合未被目标站点识别为有效登录态

### 涉及文件

1. `assets/static/js/detail.js`
2. `assets/static/css/style.css`

### 联调结论

当前 Jira 接口联调结果为“HTTP 200 + 登录页 HTML”，并非接口成功返回业务内容。后续若继续联调，需要优先确认目标站点登录态、Cookie 有效性，以及是否存在重复 `JSESSIONID` / `atlassian.xsrf.token` 造成的会话覆盖问题。

## 2026-04-24 单据页基础信息补充流程版本与流程实例 ID

### 变更背景

详情页“单据数据信息”页签依赖 `getFormData` 接口返回的 `head` 主表数据进行展示，但当前“基础信息”区域尚未直接呈现流程版本和流程实例 ID。这两个字段属于联调、排查和业务核对时的关键信息，需要在基础信息中明确展示。

### 本次变更

1. 单据页“基础信息”新增 `流程版本` 字段。
2. `流程版本` 取值来源为 `head.pk_procdef`，当其值满足 `xxx:1:xxx` 这类结构时，解析两个 `:` 中间的片段作为流程版本。
3. 单据页“基础信息”新增 `流程实例ID` 字段，取值来源为 `head.pk_procdefins`。
4. `pk_procdef` 和 `pk_procdefins` 取值兼容 `value`、`pk`、`name` 三种字段形式，避免因接口返回结构差异导致页面丢值。
5. 原有“流程字段”区域的流程定义 ID 和流程实例 ID 展示逻辑保持不变，本次补充的重点是将关键信息同步呈现到“基础信息”。

### 涉及文件

1. `assets/static/js/detail.js`

## 2026-04-24 首页参数配置页与本地代理解析能力补充

### 变更背景

当前系统首页仅支持基础参数录入，无法直接从业务单据链接中自动提取表单 Id 与单据 Id；同时本地联调时，前端参数录入、授权方式切换、代理转发入口和页面视觉层次也需要统一整理，以便降低联调门槛并提升桌面端使用效率。

### 本次变更

1. 首页参数页补充“表单参数设置方式”，支持两种模式：
   - 手动录入 `pkBo + pkBoins`
   - 输入业务单据链接 URL 自动解析
2. 当选择“单据链接 URL”模式时，前端通过本地解析接口自动提取 `formId` 和 `formInstanceId`，并回填为 `pkBo` 与 `pkBoins`。
3. 首页授权参数统一规范为 `yht_access_token`，并保留 SSO 授权模式；前端提交、跳转详情页、参数存储均使用统一字段名。
4. 当使用 URL 解析模式时，限制为 `yht_access_token` 授权，避免在 SSO 模式下发起不受支持的解析流程。
5. 首页参数录入区域补充表单模式切换、授权方式切换、本地缓存恢复和 URL 参数回填逻辑，保证再次进入页面时可快速复用上次配置。
6. 本地代理服务新增 `/api/resolve-form-params` 接口，用于携带 `yht_access_token` 请求业务单据链接，跟踪 302 跳转并解析目标地址中的 `formId` 与 `formInstanceId`。
7. 本地代理服务新增环境别名兼容，支持将 `core1/core2/core3/core4` 归一化映射到 `c1/c2/c3/c4`。
8. 本地代理服务端口固定为 `18080`，避免与其他常见本地服务端口冲突。
9. 首页增加页面内联 favicon，避免浏览器对 `/favicon.ico` 的默认请求产生无意义 404 噪音。
10. 首页与整体样式进行桌面化重构，强化双栏信息结构、玻璃态卡片、分组表单、授权区块和操作按钮的可读性与层次感。

### 涉及文件

1. `assets/templates/index.html`
2. `assets/static/js/app.js`
3. `assets/static/css/style.css`
4. `scripts/proxy-server.py`

### 备注

本次归纳基于当前工作区可见文件与最近变更内容整理，适合作为需求记录与交接说明；由于当前目录不是 Git 仓库，本节不代表严格的逐行 diff 结果。

## 2026-04-24 首页单据链接解析请求端口修正

### 变更背景

首页“单据链接 URL”解析能力接入后，前端默认基于 `window.location.origin` 发起 `/api/resolve-form-params` 请求。当页面通过 `http://localhost:8080/templates/index.html` 打开时，请求会被发送到 `localhost:8080`，而解析接口实际由本地代理服务 `scripts/proxy-server.py` 提供，端口为 `18080`，从而导致接口返回 `404 File not found`。

### 定位结论

1. 当前 `404` 的直接原因是解析请求发到了静态服务器 `8080`，不是因为“单据链接 URL 自身带了域名”。
2. 本地代理的 `/api/resolve-form-params` 已支持接收完整业务 URL，并直接以该 URL 发起请求，不会在服务端对传入链接再次拼接环境域名。
3. 服务端当前会校验传入 URL 是否与所选环境域名匹配；若 URL 域名与环境不一致，会返回业务错误，而不是 404。

### 本次变更

1. 首页单据链接解析请求改为与详情页代理请求保持一致：
   - 本地访问 `localhost / 127.0.0.1` 时，固定走 `http://<host>:18080/api/resolve-form-params`
   - 非本地环境时，继续走当前站点同源地址
2. 保持“传入完整业务 URL 直接解析”的处理方式不变，不对用户输入链接做额外域名拼接。

### 涉及文件

1. `assets/static/js/app.js`

## 2026-04-24 首页默认方式与详情展示补充

### 变更背景

在首页参数配置和详情页联调过程中，进一步明确了默认使用方式以及两处展示细节：

1. 首页首次打开时，应默认展示“单据链接 URL”参数方式，而不是手动录入 `pkBo + pkBoins`。
2. 首页默认授权方式应切换为 `yht_access_token`，与“单据链接 URL”解析链路保持一致。
3. 详情页“流程审批信息”中的时间字段需要从 ISO 时区时间串格式化为更适合阅读的本地展示格式。
4. 详情页“表单配置信息”中的主表字段和子表明细，需要补充展示控件对应的 `columncode`。

### 本次变更

1. 首页默认表单参数配置方式调整为 `单据链接 URL`。
2. 首页默认授权方式调整为 `yht_access_token`。
3. 上述默认值需同时作用于：
   - 首次打开页面
   - 表单重置后
   - 本地缓存缺省回填时
4. “流程审批信息”页签中，字段名或属性语义上属于时间/日期类，且值格式满足 `2026-04-14T15:30:27.518+08:00` 这类 ISO 带时区字符串时，前端展示前统一格式化为 `YYYY-MM-DD HH:mm:ss`。
5. 该时间格式化仅作用于“流程审批信息”页签展示，不影响其他页签原有字段显示逻辑。
6. “表单配置信息”页签中：
   - 主表字段表格新增 `columncode` 列
   - 子表配置中的子字段明细表格新增 `columncode` 列
7. `columncode` 的取值优先读取控件配置中的 `columncode`，兼容 `columnCode`；无值时展示 `-`。

### 涉及文件

1. `assets/static/js/app.js`
2. `assets/static/js/detail.js`
