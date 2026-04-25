/**
 * IForm-AI H5 Business System
 * Detail Page Script
 */

(function() {
    'use strict';

    const DEFAULT_CONFIG = {
        requestTimeout: 30000,
        storageKey: 'iform_ai_params',
        environments: {},
        tabs: {
            formConfig: { title: '表单配置信息', formConfigPathTemplate: '/yonbip-ec-iform/iform_ctr/rt_ctr/{pk_temp}/billVue.json' },
            document: { title: '单据数据信息', path: '/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData' },
            approval: { title: '流程审批信息', path: '/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson' },
            businessLog: { title: '业务日志', path: '/api/business/business-log' },
            jiraAnalysis: { title: 'Jira问题分析', path: '/api/business/jira-analysis' }
        }
    };

    const CONFIG = mergeConfig(window.IFormDetailConfig || {});
    const TAB_KEYS = ['formConfig', 'document', 'approval', 'businessLog', 'jiraAnalysis'];

    const elements = {
        summaryGrid: document.getElementById('summaryGrid'),
        reloadBtn: document.getElementById('reloadBtn'),
        status: document.getElementById('requestStatus'),
        toast: document.getElementById('toast'),
        toastMessage: document.querySelector('.toast-message'),
        tabButtons: Array.from(document.querySelectorAll('.tab-button')),
        tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
        panels: {
            formConfig: document.getElementById('panel-formConfig'),
            document: document.getElementById('panel-document'),
            approval: document.getElementById('panel-approval'),
            businessLog: document.getElementById('panel-businessLog'),
            jiraAnalysis: document.getElementById('panel-jiraAnalysis')
        }
    };

    function init() {
        bindEvents();

        const params = getRequestParams();
        if (!params) {
            renderMissingParams();
            return;
        }

        renderSummary(params);
        loadAllTabs(params);
    }

    function bindEvents() {
        elements.reloadBtn.addEventListener('click', () => {
            const params = getRequestParams();
            if (params) {
                loadAllTabs(params, true);
            }
        });

        elements.tabButtons.forEach((button) => {
            button.addEventListener('click', () => activateTab(button.dataset.tab));
        });

        elements.tabPanels.forEach((panel) => {
            panel.addEventListener('click', handleTreeToggle);
        });
    }

    function getRequestParams() {
        const url = new URL(window.location.href);
        const params = {
            environment: url.searchParams.get('environment') || '',
            authType: normalizeAuthType(url.searchParams.get('authType') || ''),
            formParamMode: url.searchParams.get('formParamMode') || '',
            billUrl: url.searchParams.get('billUrl') || '',
            ytenant_id: url.searchParams.get('ytenant_id') || '',
            pkBo: url.searchParams.get('pkBo') || '',
            pkBoins: url.searchParams.get('pkBoins') || '',
            ssoUrl: url.searchParams.get('ssoUrl') || '',
            secretKey: url.searchParams.get('secretKey') || '',
            linkPassword: url.searchParams.get('linkPassword') || '',
            yht_access_token: url.searchParams.get('yht_access_token') || url.searchParams.get('yhtToken') || ''
        };

        const hasRequired =
            params.environment &&
            params.authType &&
            params.pkBo &&
            params.pkBoins &&
            ((params.authType === 'sso' && params.ssoUrl && params.secretKey) ||
                (isTokenAuth(params.authType) && params.yht_access_token));

        if (hasRequired) {
            saveParamsToStorage(params);
            return params;
        }

        const saved = localStorage.getItem(CONFIG.storageKey);
        if (!saved) {
            return null;
        }

        try {
            return JSON.parse(saved);
        } catch (error) {
            console.error('Failed to parse cached params:', error);
            return null;
        }
    }

    async function loadAllTabs(params, silent) {
        const environmentConfig = CONFIG.environments[params.environment];
        if (!environmentConfig || !environmentConfig.baseUrl) {
            setStatus('环境未配置', 'is-error');
            const error = new Error('当前环境缺少域名配置，请补充配置文件');
            TAB_KEYS.forEach((tabKey) => {
                elements.panels[tabKey].innerHTML = renderErrorBlock(error);
            });
            showToast('当前环境缺少域名配置', 'error');
            return;
        }

        setStatus('加载中', 'is-loading');
        fillLoadingState();

        const runtimeContext = { shared: {} };
        const results = await Promise.allSettled(
            TAB_KEYS.map((tabKey) => requestTabData(tabKey, params, environmentConfig.baseUrl, runtimeContext))
        );

        let successCount = 0;
        results.forEach((result, index) => {
            const tabKey = TAB_KEYS[index];
            if (result.status === 'fulfilled') {
                elements.panels[tabKey].innerHTML = renderBusinessValue(result.value);
                successCount += 1;
            } else {
                elements.panels[tabKey].innerHTML = renderErrorBlock(result.reason);
            }
        });

        if (successCount === TAB_KEYS.length) {
            setStatus('加载完成', 'is-success');
            if (!silent) {
                showToast('详情数据加载成功', 'success');
            }
            return;
        }

        if (successCount > 0) {
            setStatus('部分成功', 'is-loading');
            showToast('部分页签加载失败，请检查配置或接口', 'error');
            return;
        }

        setStatus('加载失败', 'is-error');
        showToast('详情数据加载失败，请检查配置或接口', 'error');
    }

    async function requestTabData(tabKey, params, baseUrl, runtimeContext) {
        switch (tabKey) {
            case 'document':
                return requestDocumentData(params, baseUrl, runtimeContext);
            case 'formConfig':
                return requestFormConfigData(params, baseUrl, runtimeContext);
            case 'approval':
                return requestApprovalData(params, baseUrl, runtimeContext);
            case 'businessLog':
            case 'jiraAnalysis':
                return buildMockTabData(tabKey, params);
            default:
                throw new Error('未知页签: ' + tabKey);
        }
    }

    async function requestDocumentData(params, baseUrl, runtimeContext) {
        const parsed = await ensureDocumentParsed(params, baseUrl, runtimeContext);

        if (!runtimeContext.shared.formConfigParsed) {
            try {
                await ensureFormConfigParsed(params, baseUrl, runtimeContext);
            } catch (error) {
                console.warn('Failed to preload form config for document rendering:', error);
            }
        }

        let approvalRaw = null;
        try {
            approvalRaw = await ensureApprovalParsed(params, baseUrl, runtimeContext);
        } catch (error) {
            console.warn('Failed to preload approval data for process auth rendering:', error);
        }

        return buildDocumentRenderData(parsed, runtimeContext.shared.formConfigParsed, approvalRaw);
    }

    async function ensureDocumentParsed(params, baseUrl, runtimeContext) {
        if (runtimeContext.shared.documentParsed) {
            return runtimeContext.shared.documentParsed;
        }

        if (!runtimeContext.shared.documentPromise) {
            runtimeContext.shared.documentPromise = (async () => {
                const rawResponse = await requestJson(
                    buildRequestUrl(CONFIG.tabs.document.path, baseUrl, {
                        pk_bo: params.pkBo,
                        pk_boins: params.pkBoins,
                        _ts: Date.now(),
                        _: Date.now() - 1
                    }),
                    params,
                    'document'
                );

                const normalized = normalizeTabResponse('document', rawResponse, params);
                const parsed = parseDocumentPayload(normalized);
                fillTenantIdFromDocument(params, parsed);
                runtimeContext.shared.documentRaw = normalized;
                runtimeContext.shared.documentParsed = parsed;
                return parsed;
            })().catch((error) => {
                runtimeContext.shared.documentPromise = null;
                throw error;
            });
        }

        return runtimeContext.shared.documentPromise;
    }

    async function requestFormConfigData(params, baseUrl, runtimeContext) {
        const documentParsed = await ensureDocumentParsed(params, baseUrl, runtimeContext);
        const normalized = await ensureFormConfigParsed(params, baseUrl, runtimeContext);
        return buildFormConfigRenderData(normalized, documentParsed);
    }

    async function ensureFormConfigParsed(params, baseUrl, runtimeContext) {
        if (runtimeContext.shared.formConfigParsed) {
            return runtimeContext.shared.formConfigParsed;
        }

        if (runtimeContext.shared.formConfigPromise) {
            return runtimeContext.shared.formConfigPromise;
        }

        runtimeContext.shared.formConfigPromise = (async () => {
            const documentParsed = await ensureDocumentParsed(params, baseUrl, runtimeContext);
        const pkTemp = getNestedFieldValue(documentParsed, ['head', 'pk_temp', 'value']) ||
            getNestedFieldValue(documentParsed, ['head', 'pk_temp', 'pk']) ||
            getNestedFieldValue(documentParsed, ['head', 'pk_temp', 'name']);

        if (!pkTemp) {
            throw new Error('单据数据中缺少 pk_temp，无法获取表单配置');
        }

        const path = (CONFIG.tabs.formConfig.formConfigPathTemplate || '').replace('{pk_temp}', encodeURIComponent(pkTemp));
        const rawResponse = await requestJson(
            buildRequestUrl(path, baseUrl, { _ts: Date.now() }),
            params,
            'formConfig'
        );

        const normalized = normalizeTabResponse('formConfig', rawResponse, params);
        runtimeContext.shared.formConfigParsed = normalized;
        runtimeContext.shared.fieldMap = buildFieldMap(normalized);
            return normalized;
        })().catch((error) => {
            runtimeContext.shared.formConfigPromise = null;
            throw error;
        });

        return runtimeContext.shared.formConfigPromise;
    }

    async function requestApprovalData(params, baseUrl, runtimeContext) {
        const normalized = await ensureApprovalParsed(params, baseUrl, runtimeContext);
        return buildApprovalRenderData(normalized);
    }

    async function ensureApprovalParsed(params, baseUrl, runtimeContext) {
        if (runtimeContext.shared.approvalRaw) {
            return runtimeContext.shared.approvalRaw;
        }

        if (runtimeContext.shared.approvalPromise) {
            return runtimeContext.shared.approvalPromise;
        }

        runtimeContext.shared.approvalPromise = (async () => {
        const documentParsed = await ensureDocumentParsed(params, baseUrl, runtimeContext);
        const processDefinitionId = getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'value']) ||
            getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'pk']);
        const processInstanceId = getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'value']) ||
            getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'pk']);

        if (!processDefinitionId || !processInstanceId) {
            throw new Error('单据数据中缺少流程实例参数，无法获取流程审批信息');
        }

        const timestamp = Date.now();
        const rawResponse = await requestJson(
            buildRequestUrl(CONFIG.tabs.approval.path, baseUrl, {
                _: timestamp,
                params: JSON.stringify({
                    pk_bo: params.pkBo,
                    pk_boins: params.pkBoins,
                    processDefinitionId: processDefinitionId,
                    processInstanceId: processInstanceId
                }),
                _ts: timestamp + 1
            }),
            params,
            'approval'
        );

        const normalized = normalizeTabResponse('approval', rawResponse, params);
        runtimeContext.shared.approvalRaw = normalized;
            return normalized;
        })().catch((error) => {
            runtimeContext.shared.approvalPromise = null;
            throw error;
        });

        return runtimeContext.shared.approvalPromise;
    }

    async function requestJson(requestUrl, params, tabKey) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

        try {
            const isLocalhost = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';
            const isFileProtocol = window.location.protocol === 'file:';

            let finalUrl = requestUrl;
            let finalHeaders = buildRequestHeaders(params);

            if (isLocalhost || isFileProtocol) {
                const proxyUrl = buildProxyUrl(requestUrl, params.environment);
                if (proxyUrl) {
                    finalUrl = proxyUrl;
                    console.log('[proxy mode] request:', finalUrl);
                }
            }

            const response = await fetch(finalUrl, {
                method: 'GET',
                headers: finalHeaders,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('yht_access_token 授权失效，请重新授权');
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json') || contentType.includes('text/json')) {
                return response.json();
            }

            return response.text();
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error('请求超时，请稍后重试');
            }

            if (window.location.protocol === 'file:' || error instanceof TypeError) {
                return buildMockTabData(tabKey, params);
            }

            throw error;
        }
    }

    function buildProxyUrl(originalUrl, environment) {
        // 构建代理 URL，将真实 API 请求转换为本地代理请求
        try {
            const url = new URL(originalUrl);
            const apiPath = url.pathname + url.search;
            const proxyEnvironmentMap = {
                core1: 'c1',
                core2: 'c2',
                core3: 'c3',
                core4: 'c4'
            };
            const proxyEnvironment = proxyEnvironmentMap[environment] || environment;
            
            // 构建代理 URL: /api/proxy?env=test&path=/xxx
            const proxyBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? `${window.location.protocol}//${window.location.hostname}:18080`
                : window.location.origin;
            const proxyUrl = new URL('/api/proxy', proxyBase);
            proxyUrl.searchParams.set('env', proxyEnvironment);
            proxyUrl.searchParams.set('path', apiPath);
            
            return proxyUrl.toString();
        } catch (e) {
            console.error('构建代理 URL 失败:', e);
            return null;
        }
    }

    function buildRequestHeaders(params) {
        const headers = {
            Accept: 'application/json, text/plain, */*'
        };

        if (isTokenAuth(params.authType) && params.yht_access_token) {
            headers.yht_access_token = params.yht_access_token;
        }

        return headers;
    }

    function buildRequestUrl(path, baseUrl, query) {
        if (!path) {
            throw new Error('缺少接口路径配置');
        }

        const requestUrl = new URL(path, baseUrl);
        Object.keys(query || {}).forEach((key) => {
            const value = query[key];
            if (value !== undefined && value !== null && value !== '') {
                requestUrl.searchParams.set(key, value);
            }
        });
        return requestUrl;
    }

    function normalizeTabResponse(tabKey, response, params) {
        switch (tabKey) {
            case 'document':
                return response;
            case 'formConfig':
                return typeof response === 'string' ? safeJsonParse(response, buildMockTabData(tabKey, params)) : response;
            case 'approval':
                if (typeof response === 'string') {
                    return safeJsonParse(response, { message: response });
                }
                if (response && typeof response.message === 'string' && response.message.trim().charAt(0) === '{') {
                    const parsedMessage = safeJsonParse(response.message, null);
                    if (parsedMessage) {
                        return parsedMessage;
                    }
                }
                return response.instanceInfo || response.data || response;
            case 'businessLog':
                return response.businessLogInfo || response.businessLog || response.logs || response.logInfo || response.data || buildMockTabData(tabKey, params);
            case 'jiraAnalysis':
                return response.jiraAnalysisInfo || response.jiraAnalysis || response.jira || response.issues || response.data || buildMockTabData(tabKey, params);
            default:
                return response && response.data ? response.data : response;
        }
    }

    function parseDocumentPayload(response) {
        if (!response) {
            throw new Error('单据接口返回为空');
        }

        const payload = typeof response.data === 'string'
            ? safeJsonParse(response.data, null)
            : response.data;

        if (!payload || typeof payload !== 'object') {
            throw new Error('单据接口返回的 data 无法解析为有效 JSON');
        }

        return payload;
    }

    function fillTenantIdFromDocument(params, documentParsed) {
        if (params.ytenant_id) {
            return;
        }

        const tenantId = getNestedFieldValue(documentParsed, ['head', 'ytenant_id', 'value']) ||
            getNestedFieldValue(documentParsed, ['head', 'ytenant_id', 'pk']) ||
            getNestedFieldValue(documentParsed, ['head', 'ytenant_id', 'name']);

        if (!tenantId) {
            return;
        }

        params.ytenant_id = tenantId;
        saveParamsToStorage(params);
        renderSummary(params);
    }

    function saveParamsToStorage(params) {
        const saved = localStorage.getItem(CONFIG.storageKey);
        let existing = {};

        if (saved) {
            try {
                existing = JSON.parse(saved) || {};
            } catch (error) {
                console.warn('Failed to parse cached params before merge:', error);
            }
        }

        localStorage.setItem(CONFIG.storageKey, JSON.stringify(Object.assign({}, existing, params)));
    }

    function buildFormConfigRenderData(formConfig, documentParsed) {
        const fieldMap = buildFieldMap(formConfig);
        const documentMeta = buildDocumentMeta(documentParsed);
        const mainFields = Array.from(fieldMap.main.values()).map(toComponentSummary);
        const subTables = Array.from(fieldMap.tables.values()).map((table) => ({
            title: table.title,
            fieldId: table.fieldId,
            columncode: table.columncode || '-',
            componentType: table.componentKey,
            childFieldCount: table.columns.length,
            childFieldDetails: table.columns.map(toComponentSummary)
        }));

        return {
            表单标题: getNestedFieldValue(formConfig, ['form', 'title']) || '-',
            '表单版本id（pk_temp）': formConfig.pk_temp || documentMeta.pkTemp || '-',
            流程定义ID: formConfig.pk_procdef || documentMeta.processDefinitionId || '-',
            主表字段数量: mainFields.length,
            子表数量: subTables.length,
            表单属性: {
                BPM页签视图: formConfig.BPMTabView || '-',
                是否多流程: formatPrimitive(Boolean(formConfig.isMultiBPM)),
                是否禁止修改: formatPrimitive(Boolean(formConfig.forbidModify)),
                是否启用审批意见: formatPrimitive(Boolean(formConfig.enableApprovalOpinions))
            },
            主表字段: mainFields,
            子表配置: subTables.map((table) => ({
                标题: table.title,
                fieldId: table.fieldId,
                columncode: table.columncode || '-',
                组件类型: table.componentType,
                子字段数量: table.childFieldCount,
                子字段明细: table.childFieldDetails
            })),
            原始配置明细: {
                form: formConfig.form || {},
                formComponents: Array.isArray(formConfig.formComponents) ? formConfig.formComponents : []
            }
        };
    }

function buildDocumentRenderData(documentParsed, formConfig, approvalRaw) {
        const fieldMap = buildFieldMap(formConfig);
        const mainRows = mapFieldRecord(documentParsed.head || {}, fieldMap);
        const bodyRows = Array.isArray(getNestedFieldValue(documentParsed, ['body', 'bodys']))
            ? documentParsed.body.bodys.map((row, index) => ({
                序号: index + 1,
                字段明细: mapFieldRecord(row, fieldMap)
            }))
            : [];

        return {
            字段权限: buildProcessAuthRenderData(documentParsed.processauthinfo || {}, approvalRaw, fieldMap),
            单据版本: getNestedFieldValue(documentParsed, ['head', 'version', 'value']) ||
                getNestedFieldValue(documentParsed, ['head', 'version', 'pk']) ||
                getNestedFieldValue(documentParsed, ['head', 'version', 'name']) ||
                '-',
            流程版本: extractProcessVersion(
                getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'value']) ||
                getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'pk']) ||
                getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'name'])
            ),
            流程实例ID: getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'value']) ||
                getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'pk']) ||
                getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'name']) ||
                '-',
            单据时间: documentParsed.ts || '-',
            最后修改时间: documentParsed.modifydate || '-',
            主表字段: mainRows,
            子表数据: bodyRows,
            流程字段: {
                流程定义ID: getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'value']) ||
                    getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'pk']) ||
                    getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'name']) ||
                    '-',
                流程实例ID: getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'value']) ||
                    getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'pk']) ||
                    getNestedFieldValue(documentParsed, ['head', 'pk_procdefins', 'name']) ||
                    '-',
                单据状态: getNestedFieldValue(documentParsed, ['head', 'status', 'value']) || '-'
            },
            原始单据明细: {
                head: documentParsed.head || {},
                body: documentParsed.body || {},
                formInfo: documentParsed.formInfo || {},
                allSubDatas: documentParsed.allSubDatas || {}
            }
        };
    }

    function buildApprovalRenderData(approvalRaw) {
        if (approvalRaw && approvalRaw.message && !approvalRaw.instanceInfo && !approvalRaw.historicTasks) {
            return formatApprovalDisplayData({
                流程状态: '接口返回业务提示',
                响应编码: approvalRaw.code || '-',
                状态值: approvalRaw.status === undefined ? '-' : approvalRaw.status,
                提示信息: approvalRaw.message
            });
        }

        const instanceInfo = approvalRaw.instanceInfo || approvalRaw;
        const historicTasks = instanceInfo.historicTasks || [];
        const historicActivities = instanceInfo.historicActivityInstances || [];

        return formatApprovalDisplayData({
            流程标题: instanceInfo.name || '-',
            流程模型名称: instanceInfo.processDefinitionName || '-',
            流程状态: formatProcessState(instanceInfo.state),
            发起时间: instanceInfo.startTime || '-',
            结束时间: instanceInfo.endTime || '-',
            发起人: getNestedFieldValue(instanceInfo, ['startParticipant', 'name']) || instanceInfo.startParticipantName || '-',
            审批记录: historicTasks.map((task, index) => ({
                序号: index + 1,
                节点名称: task.name || '-',
                处理人: getNestedFieldValue(task, ['assigneeParticipant', 'name']) || task.username || task.assignee || '-',
                开始时间: task.startTime || '-',
                完成时间: task.endTime || '-',
                耗时毫秒: task.durationInMillis || '-',
                任务定义Key: task.taskDefinitionKey || '-',
                已完成: formatPrimitive(Boolean(task.finished))
            })),
            流程轨迹: historicActivities.map((item, index) => ({
                序号: index + 1,
                节点名称: item.activityName || '-',
                节点类型: item.activityType || '-',
                处理人: item.assignee || '-',
                开始时间: item.startTime || '-',
                结束时间: item.endTime || '-',
                耗时毫秒: item.durationInMillis || '-'
            })),
            当前任务: historicTasks.filter((task) => !task.finished).map((task) => ({
                节点名称: task.name || '-',
                处理人: getNestedFieldValue(task, ['assigneeParticipant', 'name']) || task.username || task.assignee || '-',
                到期时间: task.dueDate || '-'
            }))
        });
    }

    function formatApprovalDisplayData(value, keyPath) {
        if (Array.isArray(value)) {
            return value.map((item, index) => formatApprovalDisplayData(item, (keyPath || []).concat(String(index))));
        }

        if (value && typeof value === 'object') {
            return Object.keys(value).reduce((result, key) => {
                result[key] = formatApprovalDisplayData(value[key], (keyPath || []).concat(key));
                return result;
            }, {});
        }

        if (typeof value === 'string' && shouldFormatApprovalDateValue(value, keyPath || [])) {
            return formatIsoDateTimeString(value);
        }

        return value;
    }

    function shouldFormatApprovalDateValue(value, keyPath) {
        const lastKey = String((keyPath && keyPath.length && keyPath[keyPath.length - 1]) || '').toLowerCase();
        const looksLikeDateField =
            /time|date/.test(lastKey) ||
            /时间|日期/.test(lastKey);

        return looksLikeDateField && isIsoDateTimeWithOffset(value);
    }

    function isIsoDateTimeWithOffset(value) {
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    }

    function formatIsoDateTimeString(value) {
        const match = value.match(
            /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
        );

        if (!match) {
            return value;
        }

        return `${match[1]} ${match[2]}`;
    }

    function buildDocumentMeta(documentParsed) {
        return {
            pkTemp: getNestedFieldValue(documentParsed, ['head', 'pk_temp', 'value']) || '-',
            processDefinitionId: getNestedFieldValue(documentParsed, ['head', 'pk_procdef', 'value']) || '-'
        };
    }

    function buildFieldMap(formConfig) {
        const fieldMap = {
            main: new Map(),
            tables: new Map(),
            all: new Map()
        };
        const components = Array.isArray(formConfig && formConfig.formComponents) ? formConfig.formComponents : [];

        components.forEach((component) => {
            if (!component || !component.fieldId) {
                return;
            }

            if (component.componentKey === 'DataTable') {
                const table = Object.assign({}, normalizeComponentMeta(component), {
                    columns: flattenNestedComponents(component.layoutDetail || [])
                });
                table.columns.forEach((child) => {
                    fieldMap.all.set(child.fieldId, child);
                });
                fieldMap.tables.set(component.fieldId, table);
                return;
            }

            flattenNestedComponents([component]).forEach((item) => {
                fieldMap.all.set(item.fieldId, item);
                fieldMap.main.set(item.fieldId, item);
            });
        });

        return fieldMap;
    }

    function flattenNestedComponents(components) {
        return (Array.isArray(components) ? components : []).reduce((result, component) => {
            if (!component) {
                return result;
            }

            if (component.componentKey === 'TableLayout' || component.componentKey === 'TdLayout') {
                return result.concat(flattenNestedComponents(component.layoutDetail || []));
            }

            if (!component.fieldId) {
                return result.concat(flattenNestedComponents(component.layoutDetail || []));
            }

            result.push(normalizeComponentMeta(component));
            return result;
        }, []);
    }

    function normalizeComponentMeta(component) {
        return {
            fieldId: component.fieldId,
            title: component.title || component.fieldId,
            columncode: component.columncode || component.columnCode || '-',
            componentKey: component.componentKey || '-',
            required: Boolean(component.required),
            invisible: Boolean(component.invisible),
            visible: component.visible !== false
        };
    }

    function buildProcessAuthRenderData(processAuthInfo, approvalRaw, fieldMap) {
        const activityNameMap = buildActivityNameMap(approvalRaw);
        const result = {};
        Object.keys(processAuthInfo || {}).forEach((key) => {
            const items = Array.isArray(processAuthInfo[key]) ? processAuthInfo[key] : [];
            result[formatProcessAuthGroupName(key, activityNameMap)] = items.map((item) => ({
                fieldId: item.fieldid || '-',
                控件名称: resolveFieldMeta(item.fieldid, fieldMap).title,
                权限: formatAuthValue(item.auth),
                允许增行: item.rowAddable === undefined ? '-' : formatPrimitive(Boolean(item.rowAddable)),
                允许删行: item.rowRemovable === undefined ? '-' : formatPrimitive(Boolean(item.rowRemovable)),
                子表显示类型: item.subFormDataShowType || '-'
            }));
        });
        return result;
    }

    function buildActivityNameMap(approvalRaw) {
        const instanceInfo = approvalRaw && (approvalRaw.instanceInfo || approvalRaw);
        const activities = Array.isArray(instanceInfo && instanceInfo.historicActivityInstances)
            ? instanceInfo.historicActivityInstances
            : [];

        return activities.reduce((map, item) => {
            if (item && item.activityId && item.activityName) {
                map.set(item.activityId, item.activityName);
            }
            return map;
        }, new Map());
    }

    function formatProcessAuthGroupName(key, activityNameMap) {
        if (key === 'fillIn') {
            return `${key}（发起页权限）`;
        }

        if (key.indexOf('approveUser') === 0) {
            const activityName = activityNameMap.get(key);
            return activityName ? `${key}（${activityName}）` : `${key}（审批环节权限）`;
        }

        return key;
    }

    function mapFieldRecord(record, fieldMap) {
        const mapped = {};
        Object.keys(record || {}).forEach((fieldId) => {
            const fieldMeta = resolveFieldMeta(fieldId, fieldMap);
            mapped[fieldId] = {
                字段标题: fieldMeta.title,
                组件类型: fieldMeta.componentKey,
                值: extractFieldDisplayValue(record[fieldId]),
                原始值: record[fieldId]
            };
        });
        return mapped;
    }

    function resolveFieldMeta(fieldId, fieldMap) {
        const defaultMeta = {
            title: fieldId,
            columncode: '-',
            componentKey: '-'
        };

        if (!fieldMap || !fieldMap.all || typeof fieldMap.all.get !== 'function') {
            return defaultMeta;
        }

        return fieldMap.all.get(fieldId) || defaultMeta;
    }

    function extractFieldDisplayValue(fieldValue) {
        if (fieldValue && typeof fieldValue === 'object') {
            if (!isEmptyValue(fieldValue.name)) {
                return fieldValue.name;
            }
            if (!isEmptyValue(fieldValue.value)) {
                return fieldValue.value;
            }
            if (!isEmptyValue(fieldValue.pk)) {
                return fieldValue.pk;
            }
        }
        return fieldValue;
    }

    function toComponentSummary(component) {
        return {
            字段标题: component.title,
            fieldId: component.fieldId,
            columncode: component.columncode || '-',
            组件类型: component.componentKey,
            必填: formatPrimitive(Boolean(component.required)),
            可见: formatPrimitive(Boolean(component.visible)),
            隐藏: formatPrimitive(Boolean(component.invisible))
        };
    }

    function getNestedFieldValue(source, path) {
        return path.reduce((result, key) => (result && result[key] !== undefined ? result[key] : undefined), source);
    }

    function extractProcessVersion(processDefinitionId) {
        if (isEmptyValue(processDefinitionId)) {
            return '-';
        }

        const segments = String(processDefinitionId).split(':');
        return segments.length === 3 && segments[1] ? segments[1] : '-';
    }

    function renderSummary(params) {
        const environmentConfig = CONFIG.environments[params.environment] || {};
        const fields = [
            { label: '所属环境', value: environmentConfig.label || params.environment || '-' },
            { label: '环境域名', value: environmentConfig.baseUrl || '未配置' },
            { label: '租户 ID', value: params.ytenant_id || '-' },
            { label: '表单Id', value: params.pkBo },
            { label: '单据Id', value: params.pkBoins },
            { label: '授权方式', value: isTokenAuth(params.authType) ? 'yht_access_token 授权' : 'sso授权' }
        ];

        if (params.authType === 'sso') {
            fields.push({ label: 'SSO 链接', value: params.ssoUrl || '-' });
            fields.push({ label: '密钥', value: maskSecret(params.secretKey) });
            fields.push({ label: '链接密码', value: params.linkPassword ? maskSecret(params.linkPassword) : '-' });
        }

        if (isTokenAuth(params.authType)) {
            fields.push({ label: 'yht_access_token', value: maskSecret(params.yht_access_token) });
        }

        elements.summaryGrid.innerHTML = fields.map((item) => `
            <div class="summary-item">
                <span class="summary-label">${escapeHtml(item.label)}</span>
                <span class="summary-value">${escapeHtml(item.value)}</span>
            </div>
        `).join('');
    }

    function renderBusinessValue(value) {
        if (isEmptyValue(value)) {
            return '<div class="empty-state">暂无数据</div>';
        }

        if (!isComplexValue(value)) {
            return renderBusinessTable([['值', value]]);
        }

        if (Array.isArray(value) && value.length === 0) {
            return '<div class="empty-state">暂无数据</div>';
        }

        if (!Array.isArray(value) && !Object.keys(value).length) {
            return '<div class="empty-state">暂无数据</div>';
        }

        const entries = Array.isArray(value)
            ? value.map((item, index) => [`第 ${index + 1} 项`, item])
            : Object.entries(value);
        const baseEntries = entries.filter(([, itemValue]) => !isComplexValue(itemValue));
        const detailEntries = entries.filter(([, itemValue]) => isComplexValue(itemValue));

        return `
            <div class="business-data-view">
                ${baseEntries.length ? renderBusinessSection('基础信息', '关键字段以二维表格呈现，便于业务核对。', renderBusinessTable(baseEntries)) : ''}
                ${detailEntries.length ? renderBusinessSection('树形明细', '对象、数组和明细行以层级结构展开。', renderTreeDetails(detailEntries, 0)) : ''}
            </div>
        `;
    }

    function renderBusinessSection(title, note, body) {
        return `
            <section class="business-section">
                <div class="business-section-head">
                    <div class="business-section-title">${escapeHtml(title)}</div>
                    <div class="business-section-note">${escapeHtml(note)}</div>
                </div>
                ${body}
            </section>
        `;
    }

    function renderBusinessTable(entries) {
        return `
            <div class="business-table-wrap">
                <table class="business-table">
                    <thead>
                        <tr>
                            <th>字段</th>
                            <th>值</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.map(([key, itemValue]) => `
                            <tr>
                                <th scope="row">${escapeHtml(formatKey(key))}</th>
                                <td>${escapeHtml(formatPrimitive(itemValue))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderTreeDetails(entries, depth) {
        if (!entries.length) {
            return '<div class="empty-state">暂无明细数据</div>';
        }

        return `
            <div class="tree-list depth-${Math.min(depth, 3)}">
                ${entries.map(([key, itemValue]) => renderTreeNode(key, itemValue, depth)).join('')}
            </div>
        `;
    }

    function renderTreeNode(key, value, depth) {
        const isArray = Array.isArray(value);
        const nodeId = `tree-node-${depth}-${hashString(String(key) + JSON.stringify(value).slice(0, 120))}`;
        const title = isArray ? `${formatKey(key)}（${value.length} 项）` : formatKey(key);

        return `
            <article class="tree-node">
                <button class="tree-node-head" type="button" aria-expanded="true" aria-controls="${nodeId}">
                    <span class="tree-node-toggle" aria-hidden="true"></span>
                    <span class="tree-node-title">${escapeHtml(title)}</span>
                    <span class="tree-node-type">${isArray ? '数组' : '对象'}</span>
                </button>
                <div class="tree-node-body" id="${nodeId}">
                    ${isArray ? renderArrayDetail(value, depth + 1) : renderObjectDetail(value, depth + 1)}
                </div>
            </article>
        `;
    }

    function renderArrayDetail(value, depth) {
        if (!value.length) {
            return '<div class="tree-empty">空数组</div>';
        }

        if (value.every((item) => !isComplexValue(item))) {
            return renderBusinessTable(value.map((item, index) => [`第 ${index + 1} 项`, item]));
        }

        if (value.every(isFlatObject)) {
            return renderArrayTable(value);
        }

        return renderTreeDetails(value.map((item, index) => [`第 ${index + 1} 项`, item]), depth);
    }

    function renderObjectDetail(value, depth) {
        const entries = Object.entries(value);
        if (!entries.length) {
            return '<div class="tree-empty">空对象</div>';
        }

        const baseEntries = entries.filter(([, itemValue]) => !isComplexValue(itemValue));
        const detailEntries = entries.filter(([, itemValue]) => isComplexValue(itemValue));

        return `
            ${baseEntries.length ? renderBusinessTable(baseEntries) : ''}
            ${detailEntries.length ? renderTreeDetails(detailEntries, depth) : ''}
        `;
    }

    function renderArrayTable(items) {
        const columns = Array.from(items.reduce((set, item) => {
            Object.keys(item).forEach((key) => set.add(key));
            return set;
        }, new Set()));

        return `
            <div class="business-table-wrap">
                <table class="business-table business-table-detail">
                    <thead>
                        <tr>
                            <th>序号</th>
                            ${columns.map((column) => `<th>${escapeHtml(formatKey(column))}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, index) => `
                            <tr>
                                <th scope="row">${index + 1}</th>
                                ${columns.map((column) => `<td>${escapeHtml(formatPrimitive(item[column]))}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function activateTab(tabName) {
        elements.tabButtons.forEach((button) => {
            const active = button.dataset.tab === tabName;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        elements.tabPanels.forEach((panel) => {
            const active = panel.dataset.panel === tabName;
            panel.classList.toggle('is-active', active);
            panel.hidden = !active;
        });
    }

    function handleTreeToggle(event) {
        const head = event.target.closest('.tree-node-head');
        if (!head) {
            return;
        }

        const node = head.closest('.tree-node');
        const body = node && Array.from(node.children).find((child) => child.classList && child.classList.contains('tree-node-body'));
        if (!node || !body) {
            return;
        }

        const isCollapsed = node.classList.toggle('is-collapsed');
        body.hidden = isCollapsed;
        head.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    }

    function fillLoadingState() {
        TAB_KEYS.forEach((tabKey) => {
            elements.panels[tabKey].innerHTML = '<div class="empty-state">正在加载，请稍候...</div>';
        });
    }

    function renderErrorBlock(error) {
        return `
            <div class="empty-state is-error">
                <div class="error-title">数据加载失败</div>
                <div class="error-message">${escapeHtml(error.message || '未知错误')}</div>
            </div>
        `;
    }

    function renderMissingParams() {
        renderSummary({
            environment: '-',
            authType: 'sso',
            ytenant_id: '-',
            pkBo: '-',
            pkBoins: '-',
            ssoUrl: '-',
            secretKey: '-',
            linkPassword: '-',
            yht_access_token: '-'
        });

        TAB_KEYS.forEach((tabKey) => {
            elements.panels[tabKey].innerHTML = renderErrorBlock(new Error('缺少首页传入参数，请返回首页重新提交'));
        });

        setStatus('参数缺失', 'is-error');
    }

    function setStatus(text, className) {
        elements.status.textContent = text;
        elements.status.className = 'status-chip ' + className;
    }

    function showToast(message, type) {
        elements.toastMessage.textContent = message;
        elements.toast.className = 'toast ' + (type || 'info');
        elements.toast.style.display = 'block';

        setTimeout(() => {
            elements.toast.style.display = 'none';
        }, 3000);
    }

    function buildMockTabData(tabKey, params) {
        const environmentConfig = CONFIG.environments[params.environment] || {};
        const authLabel = isTokenAuth(params.authType) ? 'yht_access_token 授权' : 'sso授权';
        const mockMap = {
            formConfig: {
                表单标题: '采购申请单',
                '表单版本id（pk_temp）': params.pkBo,
                主表字段数量: 2,
                子表数量: 1,
                主表字段: [
                    { 字段标题: '申请人', fieldId: 'applicant', columncode: '-', 组件类型: 'Employee', 必填: '是', 可见: '是', 隐藏: '否' },
                    { 字段标题: '申请部门', fieldId: 'dept', columncode: '-', 组件类型: 'Department', 必填: '是', 可见: '是', 隐藏: '否' }
                ],
                子表配置: [
                    {
                        标题: '采购明细',
                        fieldId: 'detail',
                        columncode: '-',
                        组件类型: 'DataTable',
                        子字段数量: 2,
                        子字段明细: [
                            { 字段标题: '物料名称', fieldId: 'itemName', columncode: '-', 组件类型: 'Input', 必填: '是', 可见: '是', 隐藏: '否' },
                            { 字段标题: '数量', fieldId: 'qty', columncode: '-', 组件类型: 'Number', 必填: '是', 可见: '是', 隐藏: '否' }
                        ]
                    }
                ],
                所属环境: environmentConfig.label || params.environment,
                授权方式: authLabel
            },
            document: {
                单据时间: '2026-04-22 10:10:00',
                最后修改时间: '2026-04-22 10:12:00',
                主表字段: {
                    applicant: { 值: '张三', 原始值: { name: '张三' } },
                    dept: { 值: '综合管理部', 原始值: { name: '综合管理部' } }
                },
                子表数据: [
                    {
                        序号: 1,
                        字段明细: {
                            itemName: { 值: '笔记本电脑', 原始值: { name: '笔记本电脑' } },
                            qty: { 值: 2, 原始值: { value: 2 } }
                        }
                    }
                ],
                流程字段: { 流程定义ID: 'mock-proc-def', 流程实例ID: 'mock-proc-inst', 单据状态: 'run' },
                字段权限: {
                    fillIn: [
                        { fieldId: 'applicant', auth: '编辑', rowAddable: '是', rowRemovable: '是', subFormDataShowType: '-' }
                    ]
                }
            },
            approval: {
                流程标题: '采购申请审批流程',
                流程模型名称: '采购申请',
                流程状态: '审批中',
                发起时间: '2026-04-22T10:12:00+08:00',
                结束时间: '-',
                发起人: '张三',
                审批记录: [
                    { 序号: 1, 节点名称: '直属主管审批', 处理人: '李四', 开始时间: '2026-04-22T10:15:00+08:00', 完成时间: '-', 耗时毫秒: '-', 任务定义Key: 'approve_1', 已完成: '否' }
                ],
                流程轨迹: [],
                当前任务: [
                    { 节点名称: '直属主管审批', 处理人: '李四', 到期时间: '-' }
                ]
            },
            businessLog: {
                日志范围: '表单业务链路',
                单据Id: params.pkBoins,
                表单Id: params.pkBo,
                所属环境: environmentConfig.label || params.environment,
                授权方式: authLabel,
                最新状态: '当前仍使用 mock 数据',
                日志明细: [
                    { 时间: '2026-04-22 10:11:02', 级别: 'INFO', 模块: 'form-service', 操作: '读取表单配置', 耗时: '126ms' }
                ]
            },
            jiraAnalysis: {
                分析目标: '业务问题排查',
                单据Id: params.pkBoins,
                表单Id: params.pkBo,
                所属环境: environmentConfig.label || params.environment,
                当前结论: '当前仍使用 mock 数据',
                关联问题: [
                    { Jira编号: 'IFORM-1286', 标题: '审批轨迹查询偶发超时', 状态: '处理中', 优先级: 'P2' }
                ]
            }
        };

        return mockMap[tabKey] || {};
    }

    function safeJsonParse(text, fallback) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return fallback;
        }
    }

    function maskSecret(value) {
        if (!value) {
            return '-';
        }

        if (value.length <= 6) {
            return '*'.repeat(value.length);
        }

        return value.slice(0, 3) + '*'.repeat(value.length - 6) + value.slice(-3);
    }

    function isComplexValue(value) {
        return typeof value === 'object' && value !== null;
    }

    function normalizeAuthType(value) {
        return value === 'yht_token' ? 'yht_access_token' : value;
    }

    function isTokenAuth(value) {
        return value === 'yht_access_token' || value === 'yht_token';
    }

    function isEmptyValue(value) {
        return value === null || value === undefined || value === '';
    }

    function isFlatObject(value) {
        return value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.values(value).every((itemValue) => !isComplexValue(itemValue));
    }

    function formatPrimitive(value) {
        if (isEmptyValue(value)) {
            return '-';
        }

        if (typeof value === 'boolean') {
            return value ? '是' : '否';
        }

        if (typeof value === 'object') {
            return JSON.stringify(value);
        }

        return String(value);
    }

    function formatKey(key) {
        return String(key);
    }

    function hashString(value) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
        }
        return Math.abs(hash).toString(36);
    }

    function formatAuthValue(value) {
        if (value === 0) {
            return '隐藏';
        }
        if (value === 1) {
            return '查看';
        }
        if (value === 2) {
            return '编辑';
        }
        return '-';
    }

    function formatProcessState(value) {
        if (value === 'run') {
            return '审批中';
        }
        if (value === 'end') {
            return '已完成';
        }
        return value || '-';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function mergeConfig(externalConfig) {
        return {
            requestTimeout: externalConfig.requestTimeout || DEFAULT_CONFIG.requestTimeout,
            storageKey: externalConfig.storageKey || DEFAULT_CONFIG.storageKey,
            environments: Object.assign({}, DEFAULT_CONFIG.environments, externalConfig.environments),
            tabs: {
                formConfig: Object.assign({}, DEFAULT_CONFIG.tabs.formConfig, externalConfig.tabs && externalConfig.tabs.formConfig),
                document: Object.assign({}, DEFAULT_CONFIG.tabs.document, externalConfig.tabs && externalConfig.tabs.document),
                approval: Object.assign({}, DEFAULT_CONFIG.tabs.approval, externalConfig.tabs && externalConfig.tabs.approval),
                businessLog: Object.assign({}, DEFAULT_CONFIG.tabs.businessLog, externalConfig.tabs && externalConfig.tabs.businessLog),
                jiraAnalysis: Object.assign({}, DEFAULT_CONFIG.tabs.jiraAnalysis, externalConfig.tabs && externalConfig.tabs.jiraAnalysis)
            }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

