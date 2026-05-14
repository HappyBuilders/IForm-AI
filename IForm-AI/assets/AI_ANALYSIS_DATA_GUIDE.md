# AI 智能分析原始数据说明

本文档用于指导智能体读取详情页临时目录中的原始 JSON 文件。执行 AI 智能分析时，调用方只会在 prompt 中提供相对文件引用清单，不会把大体量 JSON 直接拼入请求参数。请先读取文件清单中的数据文件，再结合本文档理解字段含义和页签关联。

## 文件清单约定

临时文件引用相对于当前 skill 根目录，通常位于 `.tmp/analysis/{sessionId}/`，常见文件如下：

- `compactSnapshot.json`：数据分析摘要快照，来源于页面对各页签数据的轻量归纳，包含字段映射、当前值、日志变更摘要、权限摘要和来源摘要。数据分析场景应优先读取该文件。
- `formConfig.json`：表单配置信息页签，来源于 `billVue.json`。
- `document.json`：单据数据信息页签，来源于 `getFormData`。
- `approval.json`：流程审批信息页签，来源于 `loadDataJson`。
- `businessLog.json`：业务日志页签，来源于页面当前加载的业务日志数据。
- `jiraIssueTable.json`：Jira 问题分析页签，来源于 `/rest/issueNav/1/issueTable`。

如果某个文件不存在，说明对应页签未加载成功、未触发请求或该能力当前没有可用数据。分析时应明确指出缺失文件，而不是臆造数据。

## 数据分析摘要：compactSnapshot.json

`compactSnapshot.json` 是数据分析场景优先使用的轻量摘要文件，用于在不读取大体量原始 JSON 的情况下快速定位问题。常见字段如下：

- `meta`：摘要生成信息，包括 `sessionId`、`analysisType`、`generatedAt`。
- `fieldMap`：主表字段映射，通常包含字段名称、字段 ID、字段编码、控件类型。
- `currentValues`：当前单据主表字段值摘要。
- `changeTimeline`：业务日志变更时间线摘要，包含操作时间、操作类型、接口、`formData字段` 和 `head字段`。
- `permissionSummary`：字段权限摘要。
- `processSummary`：流程状态、当前任务、发起人、流程实例等摘要。
- `sourceSummaries`：各页签归一化摘要，通常包含 `formConfig`、`document`、`approval`、`businessLog`。

分析建议：

- 数据分析问题应先读取 `analysisContext.compactSnapshotRef.fileRef` 指向的 `compactSnapshot.json`。
- 如果该摘要已能支撑结论，不要继续读取原始页签 JSON 或 references。
- 只有摘要字段缺失、被截断或无法确认操作人/字段含义/原始值时，再读取 `analysisContext.files` 中对应的原始 JSON 文件。

## 表单配置数据：formConfig.json

`formConfig.json` 是动态表单设计配置，用于解释单据数据中的动态字段 ID。页面主要使用以下字段：

- `form.title`：表单标题。
- `pk_temp`：表单版本 ID。通常与单据数据 `document.head.pk_temp` 对应。
- `pk_procdef`：流程定义 ID。可与单据数据 `document.head.pk_procdef`、审批数据中的流程定义信息互相校验。
- `formComponents[]`：表单控件配置列表，是解析字段含义的核心数组。
- `formComponents[].fieldId`：控件字段 ID。单据数据 `head` 和子表行中的动态 key 通常用该值作为字段名。
- `formComponents[].title`：控件展示名称。页面用它把动态字段 ID 翻译成业务字段名。
- `formComponents[].columncode` 或 `columnCode`：字段编码。
- `formComponents[].componentKey`：控件类型，例如输入框、选择、人员、子表、表格布局等。
- `formComponents[].required`：是否必填。
- `formComponents[].visible`：是否可见。
- `formComponents[].invisible`：是否隐藏。
- `formComponents[].children` 或类似嵌套结构：子控件。页面会递归解析 TableLayout 和子表中的控件层级。
- `canCopy`、`canSavePDF`、`canShare`、`canWebPrint`、`isMultiBPM`：表单功能开关。

分析建议：

- 遇到单据字段 ID 不可读时，优先在 `formComponents[]` 中按 `fieldId` 找到控件标题、类型和字段编码。
- TableLayout 通常只表示布局层级，不一定是业务字段；页面统计主表字段数量时会排除纯布局行。
- 子表字段通常也来自 `formComponents[]` 的嵌套结构，需要保留父子层级判断字段所属子表。

## 单据数据：document.json

`document.json` 是当前单据实例的业务数据。接口响应可能存在外层包装，页面会从 `data` 字段解析出真实单据结构。重点字段如下：

- `data`：如果是字符串，通常是包含真实单据数据的 JSON 字符串，需要再次 JSON 解析。
- `head`：主表字段数据。字段 key 常为动态控件 `fieldId`，需要结合 `formConfig.json` 翻译字段名。
- `head.{fieldId}.value`：字段值。
- `head.{fieldId}.name`：字段展示名称或枚举/引用名称。
- `head.pk_temp`：表单版本 ID，用于反查 `billVue.json`。
- `head.pk_procdef`：流程定义 ID。
- `head.pk_procdefins`：流程实例 ID，用于查询审批数据。
- `head.ytenant_id`：租户 ID。页面会从单据中补齐请求参数。
- `head.status`：单据状态。
- `head.version`：单据版本。
- `body.bodys[]`：子表数据行。每行中的 key 同样通常是动态控件 `fieldId`。
- `processauthinfo`：流程节点字段权限。页面会结合表单配置将 `fieldid` 映射成控件名称。
- `formInfo`：单据关联的表单基础信息。
- `allSubDatas`：子表或关联数据集合。
- `ts`、`modifydate`：单据时间和最后修改时间。

分析建议：

- 先用 `formConfig.json` 建立 `fieldId -> 控件标题/类型/编码` 映射，再解释 `document.json` 的 `head` 与 `body.bodys[]`。
- 如果用户问题涉及字段展示、字段值错误、子表行异常，应同时查看 `formComponents[]` 与 `document.head/body`。
- 如果用户问题涉及流程触发或审批状态，应重点提取 `pk_procdef`、`pk_procdefins`、`status` 并关联 `approval.json`。

## 审批数据：approval.json

`approval.json` 是流程审批接口 `loadDataJson` 返回的原始数据。页面会把它解析为流程状态、审批环节和审批记录。重点字段如下：

- `instanceInfo`：流程实例主体。如果不存在，接口根对象可能就是流程实例主体。
- `instanceInfo.name`：流程标题。
- `instanceInfo.processDefinitionName`：流程模型名称。
- `instanceInfo.state`：流程状态。
- `instanceInfo.startTime`、`endTime`：流程开始和结束时间。
- `instanceInfo.startParticipant` 或 `startParticipantName`：发起人。
- `instanceInfo.historicActivityInstances[]`：流程环节历史。
- `historicActivityInstances[].activityId`：环节 ID。
- `historicActivityInstances[].activityName`：环节名称。
- `instanceInfo.historicTasks[]`：审批任务历史。
- `historicTasks[].name`：任务或节点名称。
- `historicTasks[].assigneeParticipant`、`username`、`assignee`：处理人。
- `historicTasks[].startTime`、`endTime`：任务开始和完成时间。
- `historicTasks[].durationInMillis`：任务耗时。
- `historicTasks[].taskDefinitionKey`：任务定义 Key。
- `historicTasks[].finished`：是否完成。
- `historicTasks[].dueDate`：当前或历史任务到期时间。
- `message`、`code`、`status`：当接口返回业务提示或异常结构时，页面会展示这些字段。

分析建议：

- 用 `document.json` 中的 `pk_procdef`、`pk_procdefins` 与审批实例信息做一致性校验。
- 如果问题涉及审批未触发、节点停滞、处理人异常、字段权限，应同时查看 `document.processauthinfo`、`approval.instanceInfo.historicTasks` 和 `historicActivityInstances`。

## 业务日志数据：businessLog.json

`businessLog.json` 是页面用于 AI 分析的业务日志数据。当前实现可能是模拟数据或后续接入的真实日志。常见含义如下：

- 接口调用链路、模块、操作名称、耗时、异常信息、请求时间等。
- 当用户问题涉及接口失败、超时、数据同步、流程触发异常时，应结合业务日志判断是否存在服务端异常线索。

分析建议：

- 如果日志数据为空或明显为 mock，应在结论中说明日志证据不足。
- 不要用日志推断不存在的字段或服务端行为。

## Jira 列表数据：jiraIssueTable.json

`jiraIssueTable.json` 来源于 `/rest/issueNav/1/issueTable`，用于 Jira 问题分析页签的列表和相似场景候选工单。重点字段如下：

- `issueTable` 或 `data`：有些返回结构会包一层，页面会归一化到 issueTable。
- `issueTable.table[]`：Jira 工单列表。
- `table[].key`：Jira 工单号。
- `table[].id`：Jira issueId。
- `table[].summary`：工单标题摘要。页面用当前工单 summary 与候选工单 summary 做相似场景匹配。
- `table[].status`：工单状态。
- `table[].type.name`：工单类型。
- `issueTable.total`：列表总数。

分析建议：

- 当前 Jira 页签会根据用户输入的 Jira 工单号在 `table[]` 中匹配当前工单。
- 相似场景工单解析主要依据当前工单 `summary` 和候选工单 `summary`，不要把列表命中等同于真实根因关联。
- 如果需要当前工单详情字段，应确认是否有额外详情文件或页面上下文；仅凭 `jiraIssueTable.json` 通常只有列表级摘要信息。

## 页签关联关系

1. `document.json -> formConfig.json`
   - `document.head.pk_temp` 指向表单版本。
   - `formConfig.pk_temp` 或接口路径中的 `pk_temp` 应与其对应。
   - `document.head` 和 `document.body.bodys[]` 的动态字段 ID 需要通过 `formConfig.formComponents[].fieldId` 翻译。

2. `document.json -> approval.json`
   - `document.head.pk_procdef` 是流程定义 ID。
   - `document.head.pk_procdefins` 是流程实例 ID。
   - `approval.json` 的流程实例、任务和环节应与这两个字段对应。

3. `document.json + formConfig.json -> 字段权限`
   - `document.processauthinfo` 给出流程节点字段权限。
   - 权限项中的 `fieldid` 需要通过 `formConfig.formComponents[]` 找到控件名称和类型。

4. `jiraIssueTable.json -> AI 问题描述`
   - 当前 Jira 工单的 `summary` 可作为问题摘要默认值。
   - 用户输入的问题描述优先级高于自动带入的 Jira 标题。

5. `businessLog.json -> 其它页签`
   - 日志用于解释接口错误、超时、调用链异常。
   - 如果日志与单据、审批或 Jira 数据不一致，应明确列出冲突点。

## 分析输出要求

分析时请遵循以下原则：

- 优先读取文件清单中的原始 JSON 文件，不要要求调用方补充已存在的大 JSON 内容。
- 所有结论必须能回溯到具体文件和字段。
- 如果字段缺失、文件缺失或结构与本文档描述不一致，应在“待确认项”中明确说明。
- 不要编造不存在的字段、工单、流程节点或接口返回。
- 对动态字段先通过 `formConfig.json` 映射，再解释 `document.json` 中的值。
