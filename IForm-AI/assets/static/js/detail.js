/**
 * IForm-AI H5 Business System
 * Detail Page Script
 */

(function() {
    'use strict';

    const DEFAULT_CONFIG = {
        requestTimeout: 180000,
        storageKey: 'iform_ai_params',
        environments: {},
        tabs: {
            formConfig: { title: '表单配置信息', formConfigPathTemplate: '/yonbip-ec-iform/iform_ctr/rt_ctr/{pk_temp}/billVue.json' },
            document: { title: '单据数据信息', path: '/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData' },
            approval: { title: '流程审批信息', path: '/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson' },
            businessLog: { title: '业务日志', path: '/api/business/business-log' },
            jiraAnalysis: {
                title: 'Jira问题分析',
                proxyBasePath: '/api/jira',
                issueTablePath: '/rest/issueNav/1/issueTable',
                issueDetailPath: '/secure/AjaxIssueEditAction!default.jspa',
                issueBrowsePathTemplate: '/browse/{issueKey}',
                jqlTemplate: 'issueKey = {issueKey} order by created DESC',
                listRequest: {
                    startIndex: '0',
                    layoutKey: 'split-view'
                },
                detailFieldWhitelist: []
            }
        }
    };

    const CONFIG = mergeConfig(window.IFormDetailConfig || {});
    const TAB_KEYS = ['formConfig', 'document', 'approval', 'businessLog', 'aiAnalysis', 'jiraAnalysis'];
    const PRIMARY_TAB_KEYS = ['formConfig', 'document', 'approval', 'businessLog'];
    const JIRA_TAB_KEY = 'jiraAnalysis';
    const AI_ANALYSIS_TAB_KEY = 'aiAnalysis';
    const JIRA_COOKIE_STORAGE_KEY = CONFIG.storageKey + '_jira_cookie';
    const JIRA_RECENT_ISSUES_PAGE_SIZE = 10;
    const collapseStateStore = {};
    let currentParams = null;
    let currentJiraAnalysisData = null;
    let currentLoadSequence = 0;
    let currentBusinessData = {}; // 存储各页签的业务数据用于AI分析

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
            aiAnalysis: document.getElementById('panel-aiAnalysis'),
            jiraAnalysis: document.getElementById('panel-jiraAnalysis')
        },
        aiAnalyzeBtn: document.getElementById('aiAnalyzeBtn'),
        jiraIssueKeyInput: document.getElementById('jiraIssueKeyInput'),
        jiraCookieInput: document.getElementById('jiraCookieInput'),
        jiraLoadBtn: document.getElementById('jiraLoadBtn'),
        jiraCookieClearBtn: document.getElementById('jiraCookieClearBtn')
    };

    // ==================== AI 智能分析功能 ====================
    function handleAIAnalyzeClick() {
        if (!currentParams) {
            showToast('请先加载业务数据', 'error');
            return;
        }

        // 收集各页签数据
        const analysisData = {
            params: currentParams,
            formConfig: extractPanelData('panel-formConfig'),
            document: extractPanelData('panel-document'),
            approval: extractPanelData('panel-approval'),
            businessLog: extractPanelData('panel-businessLog')
        };

        // 显示加载状态
        if (elements.aiAnalyzeBtn) {
            elements.aiAnalyzeBtn.disabled = true;
            elements.aiAnalyzeBtn.textContent = '分析中...';
        }
        if (elements.panels.aiAnalysis) {
            elements.panels.aiAnalysis.innerHTML = '<div class="ai-analysis-loading">正在调用AI分析，请稍候...</div>';
        }

        // 调用后端 API
        analyzeWithLLM({
            prompt: '你是一个专业的业务数据分析助手。请分析以下业务系统数据，给出：\n1. 数据概要总结\n2. 关键信息提取\n3. 可能的问题或风险提示\n4. 改进建议\n请用简洁易懂的中文回答。',
            data: analysisData
        }).then(result => {
            if (result.code === 200 && result.data) {
                let content = result.data.content || result.data.message || JSON.stringify(result.data, null, 2);
                if (elements.panels.aiAnalysis) {
                    elements.panels.aiAnalysis.innerHTML = '<div class="ai-analysis-content">' + formatAIResponse(content) + '</div>';
                }
                showToast('AI分析完成', 'success');
            } else {
                throw new Error(result.message || '分析失败');
            }
        }).catch(error => {
            console.error('AI分析失败:', error);
            if (elements.panels.aiAnalysis) {
                elements.panels.aiAnalysis.innerHTML = '<div class="ai-analysis-error">AI分析失败: ' + escapeHtml(error.message) + '</div>';
            }
            showToast('AI分析失败: ' + error.message, 'error');
        }).finally(() => {
            if (elements.aiAnalyzeBtn) {
                elements.aiAnalyzeBtn.disabled = false;
                elements.aiAnalyzeBtn.textContent = '开始分析';
            }
        });
    }

    async function analyzeWithLLM(payload) {
        // 提交任务
        const submitResponse = await fetch('/api/llm/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const submitResult = await submitResponse.json();

        if (submitResult.code !== 202) {
            throw new Error(submitResult.message || '任务提交失败');
        }

        const taskId = submitResult.data.taskId;

        // 轮询查询状态
        const maxAttempts = 120; // 最多轮询120次
        const pollInterval = 5000; // 每5秒查询一次
        let attempts = 0;

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            const statusResponse = await fetch(`/api/llm/analyze/status/${taskId}`);
            const statusResult = await statusResponse.json();

            if (statusResult.data.status === 'completed') {
                return {
                    code: 200,
                    message: 'success',
                    data: statusResult.data.result
                };
            } else if (statusResult.data.status === 'failed') {
                throw new Error(statusResult.data.error || '分析失败');
            }

            attempts++;

            // 更新UI显示进度
            if (elements.panels.aiAnalysis) {
                elements.panels.aiAnalysis.innerHTML = '<div class="ai-analysis-loading">正在分析中... (' + Math.round(attempts * 5) + '秒)</div>';
            }
        }

        throw new Error('分析超时，请稍后重试');
    }

    function extractPanelData(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return null;

        const data = {};
        const items = panel.querySelectorAll('.data-item');
        items.forEach(item => {
            const label = item.querySelector('.data-label');
            const value = item.querySelector('.data-value');
            if (label && value) {
                data[label.textContent.trim()] = value.textContent.trim();
            }
        });

        // 如果没有 data-item，尝试获取 pre 或 code 标签的内容
        if (Object.keys(data).length === 0) {
            const pre = panel.querySelector('pre');
            if (pre) {
                try {
                    return JSON.parse(pre.textContent);
                } catch {
                    return pre.textContent;
                }
            }
        }

        return Object.keys(data).length > 0 ? data : null;
    }

    function formatAIResponse(content) {
        // 简单格式化AI返回的内容
        if (typeof content === 'string') {
            return content
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        return JSON.stringify(content, null, 2).replace(/\n/g, '<br>');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== 原有函数 ====================
    function init() {
        bindEvents();

        currentParams = getRequestParams();
        hydrateJiraControls(currentParams);

        if (!currentParams) {
            renderMissingParams();
            return;
        }

        renderSummary(currentParams);
        loadAllTabs(currentParams);
    }

    function bindEvents() {
        elements.reloadBtn.addEventListener('click', () => {
            const params = getRequestParams();
            if (params) {
                currentParams = params;
                hydrateJiraControls(currentParams);
                loadAllTabs(params, true);
            }
        });

        elements.tabButtons.forEach((button) => {
            button.addEventListener('click', () => activateTab(button.dataset.tab));
        });

        elements.tabPanels.forEach((panel) => {
            panel.addEventListener('click', handlePanelToggle);
        });

        if (elements.jiraIssueKeyInput) {
            elements.jiraIssueKeyInput.addEventListener('input', handleJiraIssueKeyInput);
        }

        if (elements.jiraCookieInput) {
            elements.jiraCookieInput.addEventListener('input', handleJiraCookieInput);
        }

        if (elements.jiraLoadBtn) {
            elements.jiraLoadBtn.addEventListener('click', handleJiraLoadClick);
        }

        if (elements.jiraCookieClearBtn) {
            elements.jiraCookieClearBtn.addEventListener('click', handleJiraCookieClearClick);
        }

        if (elements.aiAnalyzeBtn) {
            elements.aiAnalyzeBtn.addEventListener('click', handleAIAnalyzeClick);
        }
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
            jiraIssueKey: url.searchParams.get('jiraIssueKey') || '',
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

        const loadSequence = ++currentLoadSequence;
        const runtimeContext = { shared: {} };
        const primaryResults = await Promise.allSettled(
            PRIMARY_TAB_KEYS.map((tabKey) => requestTabData(tabKey, params, environmentConfig.baseUrl, runtimeContext))
        );

        if (loadSequence !== currentLoadSequence) {
            return;
        }

        let successCount = 0;
        primaryResults.forEach((result, index) => {
            const tabKey = PRIMARY_TAB_KEYS[index];
            if (result.status === 'fulfilled') {
                elements.panels[tabKey].innerHTML = renderTabValue(tabKey, result.value);
                successCount += 1;
            } else {
                elements.panels[tabKey].innerHTML = renderErrorBlock(result.reason);
            }
        });

        if (successCount === PRIMARY_TAB_KEYS.length) {
            setStatus('核心页签已加载', 'is-success');
            if (!silent) {
                showToast('表单相关页签已优先加载', 'success');
            }
        } else if (successCount > 0) {
            setStatus('部分成功', 'is-loading');
            showToast('部分页签加载失败，请检查配置或接口', 'error');
        } else {
            setStatus('加载失败', 'is-error');
            showToast('详情数据加载失败，请检查配置或接口', 'error');
        }

        loadJiraTabAsync(params, runtimeContext, loadSequence, successCount);
    }

    async function loadJiraTabAsync(params, runtimeContext, loadSequence, primarySuccessCount) {
        try {
            const jiraValue = await requestJiraAnalysisData(params, runtimeContext);
            if (loadSequence !== currentLoadSequence) {
                return;
            }

            elements.panels[JIRA_TAB_KEY].innerHTML = renderTabValue(JIRA_TAB_KEY, jiraValue);
            const isPending = jiraValue && jiraValue.state === 'pending';

            if (primarySuccessCount === PRIMARY_TAB_KEYS.length && !isPending) {
                setStatus('加载完成', 'is-success');
            }
        } catch (error) {
            if (loadSequence !== currentLoadSequence) {
                return;
            }

            elements.panels[JIRA_TAB_KEY].innerHTML = renderErrorBlock(error);
        }
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
                return buildMockTabData(tabKey, params);
            case 'jiraAnalysis':
                return requestJiraAnalysisData(params, runtimeContext);
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

    async function requestJiraAnalysisData(params, runtimeContext, options) {
        const requestOptions = options || {};
        const jiraParams = getJiraRuntimeParams(params);

        if (!jiraParams.issueKey) {
            return buildJiraPendingState('请先填写 Jira工单号，再加载 Jira 数据', params, jiraParams);
        }

        if (!jiraParams.cookie) {
            return buildJiraPendingState('请先填写 Jira系统Cookie，再加载 Jira 数据', params, jiraParams);
        }

        const forceReload = Boolean(requestOptions.forceReload);
        if (!forceReload && runtimeContext && runtimeContext.shared && runtimeContext.shared.jiraAnalysisData) {
            return runtimeContext.shared.jiraAnalysisData;
        }

        const issueTableRaw = await requestJiraIssueTable(jiraParams);
        const issueTable = normalizeJiraIssueTableResponse(issueTableRaw);
        const currentIssue = findCurrentJiraIssue(issueTable, jiraParams.issueKey);

        if (!currentIssue) {
            throw new Error(`未在 Jira 查询结果中匹配到工单 ${jiraParams.issueKey}`);
        }

        const issueDetailRaw = await requestJiraIssueDetail(currentIssue, jiraParams);
        const issueDetail = normalizeJiraIssueDetailResponse(issueDetailRaw);
        const renderData = buildJiraAnalysisRenderData(params, jiraParams, issueTable, currentIssue, issueDetail);

        if (runtimeContext && runtimeContext.shared) {
            runtimeContext.shared.jiraAnalysisData = renderData;
        }

        return renderData;
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

    function hydrateJiraControls(params) {
        if (elements.jiraIssueKeyInput) {
            elements.jiraIssueKeyInput.value = params && params.jiraIssueKey ? params.jiraIssueKey : '';
        }

        if (elements.jiraCookieInput) {
            elements.jiraCookieInput.value = loadJiraCookieFromStorage();
        }
    }

    function handleJiraIssueKeyInput() {
        const nextValue = normalizeJiraIssueKey(elements.jiraIssueKeyInput ? elements.jiraIssueKeyInput.value : '');
        if (elements.jiraIssueKeyInput && elements.jiraIssueKeyInput.value !== nextValue) {
            elements.jiraIssueKeyInput.value = nextValue;
        }

        if (!currentParams) {
            return;
        }

        currentParams.jiraIssueKey = nextValue;
        saveParamsToStorage(currentParams);
        renderSummary(currentParams);
    }

    function handleJiraCookieInput() {
        const normalizedCookie = normalizeJiraCookieValue(elements.jiraCookieInput ? elements.jiraCookieInput.value : '');
        if (elements.jiraCookieInput && elements.jiraCookieInput.value !== normalizedCookie) {
            elements.jiraCookieInput.value = normalizedCookie;
        }
        saveJiraCookieToStorage(normalizedCookie);
    }

    async function handleJiraLoadClick() {
        const params = currentParams || getRequestParams();
        if (!params) {
            showToast('当前缺少详情页请求参数，请返回首页重新提交', 'error');
            return;
        }

        const jiraIssueKey = normalizeJiraIssueKey(elements.jiraIssueKeyInput ? elements.jiraIssueKeyInput.value : '');
        const jiraCookie = normalizeJiraCookieValue(elements.jiraCookieInput ? elements.jiraCookieInput.value : '');

        if (elements.jiraIssueKeyInput && elements.jiraIssueKeyInput.value !== jiraIssueKey) {
            elements.jiraIssueKeyInput.value = jiraIssueKey;
        }

        if (elements.jiraCookieInput && elements.jiraCookieInput.value !== jiraCookie) {
            elements.jiraCookieInput.value = jiraCookie;
        }

        params.jiraIssueKey = jiraIssueKey;
        currentParams = params;
        saveParamsToStorage(currentParams);
        saveJiraCookieToStorage(jiraCookie);
        renderSummary(currentParams);

        if (!jiraIssueKey) {
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(
                buildJiraPendingState('请先填写 Jira工单号，再加载 Jira 数据', currentParams, { issueKey: '', cookie: jiraCookie })
            );
            showToast('请填写 Jira工单号', 'error');
            return;
        }

        if (!jiraCookie) {
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(
                buildJiraPendingState('请先填写 Jira系统Cookie，再加载 Jira 数据', currentParams, { issueKey: jiraIssueKey, cookie: '' })
            );
            showToast('请填写 Jira系统Cookie', 'error');
            return;
        }

        elements.jiraLoadBtn.disabled = true;
        elements.panels.jiraAnalysis.innerHTML = '<div class="empty-state">正在加载 Jira 数据，请稍候...</div>';

        try {
            const data = await requestJiraAnalysisData(currentParams, { shared: {} }, { forceReload: true });
            currentJiraAnalysisData = data;
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(data);
            showToast('Jira 数据加载完成', 'success');
        } catch (error) {
            currentJiraAnalysisData = null;
            elements.panels.jiraAnalysis.innerHTML = renderErrorBlock(error);
            showToast(error.message || 'Jira 数据加载失败', 'error');
        } finally {
            elements.jiraLoadBtn.disabled = false;
        }
    }

    function handleJiraCookieClearClick() {
        clearJiraCookieFromStorage();
        if (elements.jiraCookieInput) {
            elements.jiraCookieInput.value = '';
            elements.jiraCookieInput.focus();
        }
        showToast('Jira 系统 Cookie 已清空', 'info');
    }

    function getJiraRuntimeParams(params) {
        return {
            issueKey: normalizeJiraIssueKey((params && params.jiraIssueKey) || (elements.jiraIssueKeyInput && elements.jiraIssueKeyInput.value) || ''),
            cookie: loadJiraCookieFromStorage()
        };
    }

    function saveJiraCookieToStorage(value) {
        sessionStorage.setItem(JIRA_COOKIE_STORAGE_KEY, normalizeJiraCookieValue(value));
    }

    function loadJiraCookieFromStorage() {
        return normalizeJiraCookieValue(sessionStorage.getItem(JIRA_COOKIE_STORAGE_KEY) || '');
    }

    function clearJiraCookieFromStorage() {
        sessionStorage.removeItem(JIRA_COOKIE_STORAGE_KEY);
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
        const mainFields = fieldMap.mainDisplayRows || [];
        const subTables = Array.from(fieldMap.tables.values()).map((table) => ({
            title: table.title,
            fieldId: table.fieldId,
            columncode: table.columncode || '-',
            componentType: table.componentKey,
            childFieldCount: table.columns.length,
            childFieldDetails: table.displayRows || []
        }));

        return {
            表单标题: getNestedFieldValue(formConfig, ['form', 'title']) || '-',
            '表单版本id（pk_temp）': formConfig.pk_temp || documentMeta.pkTemp || '-',
            流程定义ID: formConfig.pk_procdef || documentMeta.processDefinitionId || '-',
            主表字段数量: mainFields.length,
            子表数量: subTables.length,
            表单属性: {
                '允许复制提交': formatPrimitive(normalizeBooleanValue(formConfig.canCopy)),
                '可另存为PDF': formatPrimitive(normalizeBooleanValue(formConfig.canSavePDF)),
                '可分享': formatPrimitive(normalizeBooleanValue(formConfig.canShare)),
                '可网页打印': formatPrimitive(normalizeBooleanValue(formConfig.canWebPrint)),
                '是否是多流程': formatPrimitive(normalizeBooleanValue(formConfig.isMultiBPM))
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
            流程环节信息: historicActivities.map((item, index) => ({
                序号: index + 1,
                环节Id: item.activityId || '-',
                环节名称: item.activityName || '-'
            })),
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
            all: new Map(),
            mainDisplayRows: []
        };
        const components = Array.isArray(formConfig && formConfig.formComponents) ? formConfig.formComponents : [];
        const mainScopeState = createLayoutScopeState('主表布局');

        components.forEach((component) => {
            if (!component) {
                return;
            }

            if (component.componentKey === 'DataTable' && component.fieldId) {
                const table = buildTableComponentMeta(component);
                table.columns.forEach((child) => {
                    fieldMap.all.set(child.fieldId, child);
                });
                fieldMap.tables.set(component.fieldId, table);
                return;
            }

            const parsedNode = collectNestedComponentData([component], {
                depth: 0,
                tablePath: [],
                scopeState: mainScopeState,
                defaultTablePathLabel: '主表直出区域'
            });

            parsedNode.fields.forEach((item) => {
                fieldMap.all.set(item.fieldId, item);
                fieldMap.main.set(item.fieldId, item);
            });
            fieldMap.mainDisplayRows = fieldMap.mainDisplayRows.concat(parsedNode.displayRows);
        });

        return fieldMap;
    }

    function createLayoutScopeState(anonymousTablePrefix) {
        return {
            anonymousTableCount: 0,
            anonymousTablePrefix: anonymousTablePrefix || '布局'
        };
    }

    function buildTableComponentMeta(component) {
        const tableTitle = (component && (component.title || component.fieldId)) || '未命名子表';
        const parsedChildren = collectNestedComponentData(component.layoutDetail || [], {
            depth: 0,
            tablePath: [],
            scopeState: createLayoutScopeState(`${tableTitle}布局`),
            defaultTablePathLabel: `${tableTitle}直出区域`
        });

        return Object.assign({}, normalizeComponentMeta(component), {
            columns: parsedChildren.fields,
            displayRows: parsedChildren.displayRows
        });
    }

    function collectNestedComponentData(components, context) {
        return (Array.isArray(components) ? components : []).reduce((result, component) => {
            if (!component) {
                return result;
            }

            if (component.componentKey === 'TableLayout') {
                const tableTitle = resolveTableLayoutTitle(component, context.scopeState);
                const nextTablePath = context.tablePath.concat(tableTitle);
                const nested = collectNestedComponentData(component.layoutDetail || [], {
                    depth: context.depth + 1,
                    tablePath: nextTablePath,
                    scopeState: context.scopeState,
                    defaultTablePathLabel: `${tableTitle}直出区域`
                });
                const tableMeta = normalizeComponentMeta(component, {
                    fieldIdFallback: '-',
                    titleFallback: tableTitle,
                    columncodeFallback: '-'
                });

                result.displayRows.push({
                    rowType: 'tableLayout',
                    depth: context.depth,
                    tablePathLabel: nextTablePath.join(' / '),
                    title: tableTitle,
                    fieldId: tableMeta.fieldId,
                    columncode: '-',
                    componentType: tableMeta.componentKey,
                    childFieldCount: nested.fields.length,
                    required: '-',
                    visible: '-',
                    invisible: '-'
                });
                result.fields = result.fields.concat(nested.fields);
                result.displayRows = result.displayRows.concat(nested.displayRows);
                return result;
            }

            if (component.componentKey === 'TdLayout') {
                const nested = collectNestedComponentData(component.layoutDetail || [], {
                    depth: context.depth,
                    tablePath: context.tablePath,
                    scopeState: context.scopeState,
                    defaultTablePathLabel: context.defaultTablePathLabel
                });
                result.fields = result.fields.concat(nested.fields);
                result.displayRows = result.displayRows.concat(nested.displayRows);
                return result;
            }

            if (!component.fieldId) {
                const nested = collectNestedComponentData(component.layoutDetail || [], {
                    depth: context.depth,
                    tablePath: context.tablePath,
                    scopeState: context.scopeState,
                    defaultTablePathLabel: context.defaultTablePathLabel
                });
                result.fields = result.fields.concat(nested.fields);
                result.displayRows = result.displayRows.concat(nested.displayRows);
                return result;
            }

            const normalized = normalizeComponentMeta(component);
            result.fields.push(normalized);
            result.displayRows.push({
                rowType: 'field',
                depth: context.depth,
                tablePathLabel: context.tablePath.length
                    ? context.tablePath.join(' / ')
                    : (context.defaultTablePathLabel || '直出区域'),
                title: normalized.title,
                fieldId: normalized.fieldId,
                columncode: normalized.columncode || '-',
                componentType: normalized.componentKey,
                required: formatPrimitive(Boolean(normalized.required)),
                visible: formatPrimitive(Boolean(normalized.visible)),
                invisible: formatPrimitive(Boolean(normalized.invisible))
            });
            return result;
        }, {
            fields: [],
            displayRows: []
        });
    }

    function resolveTableLayoutTitle(component, scopeState) {
        if (component && component.title) {
            return component.title;
        }

        if (component && component.fieldId) {
            return component.fieldId;
        }

        scopeState.anonymousTableCount += 1;
        return `${scopeState.anonymousTablePrefix}${scopeState.anonymousTableCount}`;
    }

    function normalizeComponentMeta(component, options) {
        const config = options || {};
        return {
            fieldId: component.fieldId || config.fieldIdFallback || '-',
            title: component.title || component.fieldId || config.titleFallback || '-',
            columncode: component.columncode || component.columnCode || config.columncodeFallback || '-',
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
            { label: 'Jira工单号', value: params.jiraIssueKey || '-' },
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

    function renderTabValue(tabKey, value) {
        if (tabKey === 'formConfig') {
            return renderFormConfigValue(value);
        }

        if (tabKey === 'jiraAnalysis') {
            return renderJiraAnalysisValue(value);
        }

        return renderBusinessValue(value);
    }

    function renderFormConfigValue(value) {
        if (!value || typeof value !== 'object') {
            return renderBusinessValue(value);
        }

        const basicInfoEntries = [
            ['表单标题', value.表单标题],
            ['表单版本id（pk_temp）', value['表单版本id（pk_temp）']],
            ['流程定义ID', value.流程定义ID],
            ['主表字段数量', value.主表字段数量],
            ['子表数量', value.子表数量]
        ];
        const formProperties = value.表单属性 && typeof value.表单属性 === 'object'
            ? Object.entries(value.表单属性)
            : [];

        return `
            <div class="business-data-view">
                ${renderBusinessSection('基础信息', '统计数量仅包含真实控件，TableLayout 仅作为层级和归属展示。', renderBusinessTable(basicInfoEntries))}
                ${formProperties.length ? renderBusinessSection('表单属性', '保留原有基础属性信息，便于核对配置开关。', renderBusinessTable(formProperties)) : ''}
                ${renderBusinessSection(
                    '主表字段',
                    '主表区域保留 TableLayout 层级，控件可看出所在表格归属。',
                    renderComponentHierarchyTable(value.主表字段, '暂无主表控件'),
                    { collapsible: true, sectionKey: 'main-fields' }
                )}
                ${renderFormConfigSubTables(value.子表配置)}
                ${value.原始配置明细 ? renderBusinessSection('原始配置明细', '保留原始 JSON 结构，便于排查接口返回细节。', renderTreeDetails(Object.entries(value.原始配置明细), 0)) : ''}
            </div>
        `;
    }

    function renderFormConfigSubTables(subTables) {
        const items = Array.isArray(subTables) ? subTables : [];
        if (!items.length) {
            return renderBusinessSection('子表配置', '当前表单未配置子表。', '<div class="empty-state">暂无子表配置</div>');
        }

        return renderBusinessSection(
            '子表配置',
            '子表字段同样保留 TableLayout 层级和表格归属，统计数量仅计算真实子字段。',
            `
                <div class="subtable-config-list">
                    ${items.map((table) => renderSubTableCard(table)).join('')}
                </div>
            `
        );
    }

    function renderSubTableCard(table) {
        const summaryEntries = [
            ['标题', table && table.标题],
            ['fieldId', table && table.fieldId],
            ['columncode', table && table.columncode],
            ['组件类型', table && table.组件类型],
            ['子字段数量', table && table.子字段数量]
        ];

        const tableKey = `subtable-${hashString(String((table && table.fieldId) || (table && table.标题) || 'subtable'))}`;

        return `
            <article class="subtable-card">
                <div class="subtable-card-head">
                    <div class="subtable-card-title">${escapeHtml((table && table.标题) || '-')}</div>
                    <div class="subtable-card-meta">${escapeHtml(String((table && table.子字段数量) || 0))} 个子字段</div>
                </div>
                ${renderBusinessTable(summaryEntries)}
                <div class="subtable-card-body">
                    ${renderCollapsibleBlock(
                        '子字段明细',
                        renderComponentHierarchyTable(table && table.子字段明细, '暂无子字段配置'),
                        {
                            collapsed: false,
                            blockClassName: 'subtable-detail-block',
                            blockKey: tableKey
                        }
                    )}
                </div>
            </article>
        `;
    }

    function renderJiraAnalysisValue(value) {
        if (!value || typeof value !== 'object') {
            return renderBusinessValue(value);
        }

        if (value.state === 'pending') {
            currentJiraAnalysisData = null;
            return `
                <div class="business-data-view">
                    ${renderBusinessSection('加载说明', 'Jira 页签需要独立输入授权参数。', `<div class="empty-state">${escapeHtml(value.message || '请先填写 Jira 参数')}</div>`)}
                </div>
            `;
        }

        currentJiraAnalysisData = value;
        const mergedIssueDetailEntries = [
            ...Object.entries(value.currentIssueBase || {}),
            ...Object.entries(value.currentIssueDetail || {})
        ];

        return `
            <div class="business-data-view">
                ${renderBusinessSection('工单详细内容', '合并展示当前工单基础信息与 Jira 详情字段内容。', renderBusinessTable(mergedIssueDetailEntries))}
                ${renderBusinessSection('相似场景工单解析', '基于当前工单 summary 与 Jira 查询结果中的候选工单 summary 做语义匹配后返回命中列表。', renderJiraSimilarIssuesSection(value), {
                    collapsible: true,
                    sectionKey: 'jira-similar-issues',
                    headActionHtml: renderJiraSimilarAnalysisAction(value)
                })}
                ${renderBusinessSection('近期工单列表', '使用 issueTable.table 展示当前查询条件下返回的近期工单集合，不代表和当前工单存在真实关联。', renderJiraRecentIssuesSection(value), { collapsible: true, sectionKey: 'jira-recent-issues' })}
                ${renderBusinessSection('列表工单详情', '统一展示从相似场景工单解析或近期工单列表中打开的工单详情。', renderJiraSharedIssueDetailSection(value), { collapsible: true, sectionKey: 'jira-shared-issue-detail' })}
                ${value.raw ? renderBusinessSection('原始返回数据', '保留 Jira 列表与详情接口原始结构，便于排查解析问题。', renderTreeDetails(Object.entries(value.raw), 0), { collapsible: true, sectionKey: 'jira-raw', collapsed: true }) : ''}
            </div>
        `;
    }

    function renderJiraSimilarAnalysisAction(value) {
        const similarSceneAnalysis = value && value.similarSceneAnalysis ? value.similarSceneAnalysis : {};
        const isLoading = similarSceneAnalysis.state === 'loading';
        const analysis = similarSceneAnalysis.analysis || {};
        const hasMore = Boolean(analysis.hasMore);
        const hasStarted = Number(analysis.currentBatch || 0) > 0 || Array.isArray(similarSceneAnalysis.matches) && similarSceneAnalysis.matches.length > 0;
        return `
            <div class="jira-similar-analysis-actions">
                <button
                    type="button"
                    class="btn btn-primary btn-inline btn-mini"
                    data-jira-action="analyze-similar"
                    ${isLoading || hasStarted ? 'disabled' : ''}
                >
                    ${isLoading && !hasStarted ? '分析中...' : '开始分析'}
                </button>
                ${hasStarted && hasMore ? `
                    <button
                        type="button"
                        class="btn btn-secondary btn-inline btn-mini"
                        data-jira-action="analyze-similar-more"
                        ${isLoading ? 'disabled' : ''}
                    >
                        ${isLoading ? '分析中...' : '分析更多'}
                    </button>
                ` : ''}
                ${hasStarted && !hasMore && !isLoading ? '<span class="jira-similar-analysis-status">没有更多分析工单了</span>' : ''}
            </div>
        `;
    }

    function renderJiraSimilarIssuesSection(value) {
        const similarSceneAnalysis = value && value.similarSceneAnalysis ? value.similarSceneAnalysis : {};
        const matches = Array.isArray(similarSceneAnalysis.matches) ? similarSceneAnalysis.matches : [];
        const analysis = similarSceneAnalysis.analysis || {};
        const state = similarSceneAnalysis.state || 'pending';

        if (state === 'loading') {
            return `<div class="empty-state">${escapeHtml(similarSceneAnalysis.message || '正在分析相似场景工单，请稍候...')}</div>`;
        }

        if (state === 'error') {
            return `<div class="empty-state is-error">${escapeHtml(similarSceneAnalysis.message || '相似场景分析失败')}</div>`;
        }

        if (state === 'pending') {
            return renderBusinessTable([
                ['当前状态', similarSceneAnalysis.message || '待开始分析'],
                ['候选工单总数', analysis.candidateCount || 0],
                ['已分析工单数', analysis.analyzedCount || 0],
                ['分析批次', `${analysis.currentBatch || 0} / ${analysis.totalBatches || 0}`],
                ['分析来源', formatJiraSimilarAnalysisSource(analysis.source, state)],
                ['说明', '请点击“开始分析”后触发大模型匹配']
            ]);
        }

        if (!matches.length) {
            return renderBusinessTable([
                ['当前状态', state === 'loaded' ? ((analysis.hasMore ? '当前批次未命中相似场景工单' : '未命中相似场景工单')) : '待分析'],
                ['候选工单总数', analysis.candidateCount || 0],
                ['已分析工单数', analysis.analyzedCount || 0],
                ['分析批次', `${analysis.currentBatch || 0} / ${analysis.totalBatches || 0}`],
                ['分析来源', formatJiraSimilarAnalysisSource(analysis.source, state)],
                ['分析结论', analysis.conclusion || '暂无结果']
            ]);
        }

        return `
            <div class="jira-recent-issues-layout">
                ${renderJiraSimilarIssuesTable(matches)}
                ${renderBusinessTable([
                    ['分析来源', formatJiraSimilarAnalysisSource(analysis.source, state)],
                    ['候选工单总数', analysis.candidateCount || 0],
                    ['已分析工单数', analysis.analyzedCount || 0],
                    ['分析批次', `${analysis.currentBatch || 0} / ${analysis.totalBatches || 0}`],
                    ['命中工单数', analysis.matchedCount || matches.length],
                    ['分析结论', analysis.conclusion || '-']
                ])}
            </div>
        `;
    }

    function renderJiraSimilarIssuesTable(items) {
        return `
            <div class="business-table-wrap">
                <table class="business-table business-table-detail jira-similar-issues-table">
                    <thead>
                        <tr>
                            <th>序号</th>
                            <th>Jira编号</th>
                            <th>标题摘要</th>
                            <th>状态</th>
                            <th>类型</th>
                            <th>相似度</th>
                            <th>匹配原因</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, index) => `
                            <tr>
                                <th scope="row">${index + 1}</th>
                                <td>${escapeHtml(formatPrimitive(item.issueKey))}</td>
                                <td>${escapeHtml(formatPrimitive(item.summary))}</td>
                                <td>${escapeHtml(formatPrimitive(item.status))}</td>
                                <td>${escapeHtml(formatPrimitive(item.type))}</td>
                                <td>${escapeHtml(formatSimilarityScore(item.similarityScore))}</td>
                                <td>${escapeHtml(formatPrimitive(item.matchReason))}</td>
                                <td>
                                    <button
                                        type="button"
                                        class="btn btn-secondary btn-inline btn-mini"
                                        data-jira-action="view-detail"
                                        data-detail-source="similar"
                                        data-issue-id="${escapeHtml(formatPrimitive(item.issueId))}"
                                        data-issue-key="${escapeHtml(formatPrimitive(item.issueKey))}"
                                    >
                                        查看详情
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderJiraRecentIssuesSection(value) {
        const recentIssues = Array.isArray(value && value.recentIssues) ? value.recentIssues : [];
        if (!recentIssues.length) {
            return '<div class="empty-state">暂无近期工单</div>';
        }

        const pagination = ensureJiraRecentIssuesPagination(value, recentIssues.length);
        const startIndex = (pagination.currentPage - 1) * pagination.pageSize;
        const pagedIssues = recentIssues.slice(startIndex, startIndex + pagination.pageSize);
        const listHtml = renderJiraRecentIssuesTable(pagedIssues, startIndex);

        return `
            <div class="jira-recent-issues-layout">
                ${listHtml}
                ${renderJiraRecentIssuesPagination(pagination, recentIssues.length)}
            </div>
        `;
    }

    function renderJiraSharedIssueDetailSection(value) {
        const detailTitlePrefix = value && value.selectedRecentIssueDetail && value.selectedRecentIssueDetail.sourceLabel
            ? value.selectedRecentIssueDetail.sourceLabel
            : '工单详情';

        if (!value || !value.selectedRecentIssueDetail) {
            return '<div class="empty-state">点击“相似场景工单解析”或“近期工单列表”中的“查看详情”可在此处查看对应工单的详细内容</div>';
        }

        return `
            <div class="jira-inline-detail-block" id="jira-recent-issue-detail-anchor">
                <div class="collapse-block-head">
                    <span class="collapse-block-title">${escapeHtml(`${detailTitlePrefix}：${value.selectedRecentIssueDetail.issueKey || '-'}`)}</span>
                </div>
                <div class="collapse-block-body">
                    ${renderBusinessTable(Object.entries(value.selectedRecentIssueDetail.detail || {}))}
                </div>
            </div>
        `;
    }

    function renderJiraRecentIssuesTable(items, startIndex) {
        return `
            <div class="business-table-wrap">
                <table class="business-table business-table-detail jira-recent-issues-table">
                    <thead>
                        <tr>
                            <th>序号</th>
                            <th>Jira编号</th>
                            <th>标题</th>
                            <th>状态</th>
                            <th>类型</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, index) => `
                            <tr>
                                <th scope="row">${startIndex + index + 1}</th>
                                <td>${escapeHtml(formatPrimitive(item.Jira编号))}</td>
                                <td>${escapeHtml(formatPrimitive(item.标题))}</td>
                                <td>${escapeHtml(formatPrimitive(item.状态))}</td>
                                <td>${escapeHtml(formatPrimitive(item.类型))}</td>
                                <td>
                                    <button
                                        type="button"
                                        class="btn btn-secondary btn-inline btn-mini"
                                        data-jira-action="view-detail"
                                        data-detail-source="recent"
                                        data-issue-id="${escapeHtml(formatPrimitive(item.issueId))}"
                                        data-issue-key="${escapeHtml(formatPrimitive(item.Jira编号))}"
                                    >
                                        查看详情
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function ensureJiraRecentIssuesPagination(value, totalCount) {
        const pageSize = JIRA_RECENT_ISSUES_PAGE_SIZE;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const currentPage = Math.min(
            Math.max(Number(value && value.recentIssuesCurrentPage) || 1, 1),
            totalPages
        );

        if (value) {
            value.recentIssuesCurrentPage = currentPage;
        }

        return {
            pageSize: pageSize,
            currentPage: currentPage,
            totalPages: totalPages
        };
    }

    function renderJiraRecentIssuesPagination(pagination, totalCount) {
        if (!pagination || pagination.totalPages <= 1) {
            return `
                <div class="section-head-meta jira-recent-issues-pagination is-single-page">
                    <div class="jira-recent-issues-pagination-summary">
                        <span class="jira-recent-issues-pagination-stat">
                            <span class="jira-recent-issues-pagination-label">总条数</span>
                            <strong>${totalCount}</strong>
                        </span>
                        <span class="jira-recent-issues-pagination-stat">
                            <span class="jira-recent-issues-pagination-label">当前展示</span>
                            <strong>${Math.min(totalCount, JIRA_RECENT_ISSUES_PAGE_SIZE)}</strong>
                        </span>
                    </div>
                </div>
            `;
        }

        const pageNumbers = buildJiraRecentIssuesPageNumbers(pagination.currentPage, pagination.totalPages);

        return `
            <div class="section-head-meta jira-recent-issues-pagination">
                <div class="jira-recent-issues-pagination-summary">
                    <span class="jira-recent-issues-pagination-stat">
                        <span class="jira-recent-issues-pagination-label">总条数</span>
                        <strong>${totalCount}</strong>
                    </span>
                    <span class="jira-recent-issues-pagination-stat">
                        <span class="jira-recent-issues-pagination-label">当前页</span>
                        <strong>${pagination.currentPage}</strong>
                    </span>
                    <span class="jira-recent-issues-pagination-stat">
                        <span class="jira-recent-issues-pagination-label">总页数</span>
                        <strong>${pagination.totalPages}</strong>
                    </span>
                </div>
                <div class="jira-recent-issues-pagination-actions">
                    <button
                        type="button"
                        class="btn btn-secondary btn-inline btn-mini"
                        data-jira-action="recent-page"
                        data-page="1"
                        ${pagination.currentPage <= 1 ? 'disabled' : ''}
                    >
                        首页
                    </button>
                    <button
                        type="button"
                        class="btn btn-secondary btn-inline btn-mini"
                        data-jira-action="recent-page"
                        data-page="${pagination.currentPage - 1}"
                        ${pagination.currentPage <= 1 ? 'disabled' : ''}
                    >
                        上一页
                    </button>
                    ${pageNumbers.map((page) => page === 'ellipsis'
                        ? '<span class="jira-recent-issues-pagination-ellipsis">...</span>'
                        : `
                            <button
                                type="button"
                                class="btn btn-secondary btn-inline btn-mini ${page === pagination.currentPage ? 'is-active' : ''}"
                                data-jira-action="recent-page"
                                data-page="${page}"
                                ${page === pagination.currentPage ? 'disabled' : ''}
                            >
                                ${page}
                            </button>
                        `
                    ).join('')}
                    <button
                        type="button"
                        class="btn btn-secondary btn-inline btn-mini"
                        data-jira-action="recent-page"
                        data-page="${pagination.currentPage + 1}"
                        ${pagination.currentPage >= pagination.totalPages ? 'disabled' : ''}
                    >
                        下一页
                    </button>
                    <button
                        type="button"
                        class="btn btn-secondary btn-inline btn-mini"
                        data-jira-action="recent-page"
                        data-page="${pagination.totalPages}"
                        ${pagination.currentPage >= pagination.totalPages ? 'disabled' : ''}
                    >
                        末页
                    </button>
                </div>
            </div>
        `;
    }

    function buildJiraRecentIssuesPageNumbers(currentPage, totalPages) {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }

        if (currentPage <= 4) {
            return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
        }

        if (currentPage >= totalPages - 3) {
            return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        }

        return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages];
    }

    function renderComponentHierarchyTable(rows, emptyText) {
        const items = Array.isArray(rows) ? rows : [];
        if (!items.length) {
            return `<div class="empty-state">${escapeHtml(emptyText || '暂无控件配置')}</div>`;
        }

        const normalizedItems = buildComponentHierarchyRows(items);

        return `
            <div class="business-table-wrap">
                <table class="business-table business-table-detail component-table">
                    <thead>
                        <tr>
                            <th>字段标题 / 层级</th>
                            <th>fieldId</th>
                            <th>columncode</th>
                            <th>组件类型</th>
                            <th>所属表格</th>
                            <th>必填</th>
                            <th>可见</th>
                            <th>隐藏</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${normalizedItems.map((row) => renderComponentHierarchyRow(row)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function buildComponentHierarchyRows(rows) {
        const items = Array.isArray(rows) ? rows : [];
        const layoutStack = [];

        return items.map((item, index) => {
            const row = Object.assign({}, item);
            const depth = Number(row.depth) || 0;

            while (layoutStack.length && layoutStack[layoutStack.length - 1].depth >= depth) {
                layoutStack.pop();
            }

            row.rowIndex = index;
            row.rowKey = row.rowKey || `component-row-${index}-${hashString(`${row.rowType || 'field'}-${row.title || ''}-${row.fieldId || ''}-${row.tablePathLabel || ''}`)}`;
            row.parentLayoutKey = layoutStack.length ? layoutStack[layoutStack.length - 1].rowKey : '';
            row.ancestorLayoutKeys = layoutStack.map((layout) => layout.rowKey);

            if (layoutStack.length) {
                layoutStack[layoutStack.length - 1].hasChildren = true;
            }

            if (row.rowType === 'tableLayout') {
                row.hasChildren = false;
                layoutStack.push(row);
                return row;
            }

            return row;
        });
    }

    function renderComponentHierarchyRow(row) {
        const item = row || {};
        const depthClass = `depth-${Math.min(Math.max(Number(item.depth) || 0, 0), 6)}`;
        const isLayoutRow = item.rowType === 'tableLayout';
        const rowClassName = isLayoutRow ? 'component-row is-layout-row' : 'component-row';
        const requiredText = item.required === undefined ? '-' : item.required;
        const visibleText = item.visible === undefined ? '-' : item.visible;
        const invisibleText = item.invisible === undefined ? '-' : item.invisible;
        const layoutCountText = isLayoutRow
            ? formatComponentCountLabel(item.childFieldCount)
            : '';
        const ancestorLayoutKeys = Array.isArray(item.ancestorLayoutKeys) ? item.ancestorLayoutKeys.join(',') : '';
        const layoutToggle = isLayoutRow && item.hasChildren
            ? `
                <button
                    class="component-row-toggle"
                    type="button"
                    data-component-toggle="layout"
                    data-layout-key="${escapeHtml(item.rowKey || '')}"
                    aria-expanded="true"
                    aria-label="收起${escapeHtml(item.title || '表格')}下级控件"
                >
                    <span class="component-row-toggle-icon" aria-hidden="true"></span>
                </button>
            `
            : '<span class="component-row-toggle-placeholder" aria-hidden="true"></span>';

        return `
            <tr
                class="${rowClassName}"
                data-row-key="${escapeHtml(item.rowKey || '')}"
                data-row-type="${escapeHtml(item.rowType || 'field')}"
                data-parent-layout-key="${escapeHtml(item.parentLayoutKey || '')}"
                data-ancestor-layout-keys="${escapeHtml(ancestorLayoutKeys)}"
            >
                <td>
                    <div class="component-title-cell ${depthClass}">
                        ${layoutToggle}
                        <span class="component-depth-line" aria-hidden="true"></span>
                        <span class="component-name">${escapeHtml(item.title || '-')}</span>
                        ${isLayoutRow ? '<span class="component-kind is-layout">表格</span>' : ''}
                        ${layoutCountText ? `<span class="component-meta-chip">${escapeHtml(layoutCountText)}</span>` : ''}
                    </div>
                </td>
                <td>${escapeHtml(item.fieldId || '-')}</td>
                <td>${escapeHtml(item.columncode || '-')}</td>
                <td>${escapeHtml(item.componentType || '-')}</td>
                <td>${escapeHtml(item.tablePathLabel || '-')}</td>
                <td>${escapeHtml(String(requiredText))}</td>
                <td>${escapeHtml(String(visibleText))}</td>
                <td>${escapeHtml(String(invisibleText))}</td>
            </tr>
        `;
    }

    function formatComponentCountLabel(count) {
        const numericCount = Number(count);
        if (!isFinite(numericCount) || numericCount < 0) {
            return '';
        }

        return `${numericCount}个控件`;
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

    function renderBusinessSection(title, note, body, options) {
        const config = options || {};
        const collapseId = config.collapsible
            ? `collapse-${hashString(String(config.sectionKey || title || 'section'))}`
            : '';
        const collapsed = config.collapsible ? resolveCollapseState(collapseId, config.collapsed) : Boolean(config.collapsed);
        const headAction = config.collapsible
            ? renderSectionCollapseToggle(collapseId, collapsed)
            : '';
        const headExtraAction = config.headActionHtml || '';
        const bodyContent = config.collapsible
            ? `
                <div class="collapse-block business-section-collapse${collapsed ? ' is-collapsed' : ''}" data-collapse-block="${collapseId}">
                    <div class="collapse-block-body" id="${collapseId}"${collapsed ? ' hidden' : ''}>
                        ${body}
                    </div>
                </div>
            `
            : body;

        return `
            <section class="business-section">
                <div class="business-section-head${config.collapsible ? ' is-collapsible' : ''}">
                    <div class="business-section-heading">
                        <div class="business-section-title-row">
                            ${headAction}
                            <div class="business-section-title">${escapeHtml(title)}</div>
                        </div>
                        <div class="business-section-note">${escapeHtml(note)}</div>
                    </div>
                    ${headExtraAction}
                </div>
                ${bodyContent}
            </section>
        `;
    }

    function renderSectionCollapseToggle(targetId, collapsed) {
        return `
            <button
                class="section-collapse-toggle"
                type="button"
                data-collapse-toggle="block"
                aria-expanded="${collapsed ? 'false' : 'true'}"
                aria-controls="${targetId}"
            >
                <span class="collapse-block-toggle" aria-hidden="true"></span>
                <span class="section-collapse-text">${collapsed ? '展开' : '收起'}</span>
            </button>
        `;
    }

    function renderCollapsibleBlock(title, body, options) {
        const config = options || {};
        const blockClassName = config.blockClassName ? ` ${config.blockClassName}` : '';
        const blockKey = `collapse-${hashString(String(config.blockKey || title || 'block'))}`;
        const collapsed = resolveCollapseState(blockKey, config.collapsed);
        const anchorId = config.anchorId ? ` id="${escapeHtml(config.anchorId)}"` : '';

        return `
            <div class="collapse-block${blockClassName}${collapsed ? ' is-collapsed' : ''}" data-collapse-block="${blockKey}"${anchorId}>
                <button
                    class="collapse-block-head"
                    type="button"
                    data-collapse-toggle="block"
                    aria-expanded="${collapsed ? 'false' : 'true'}"
                    aria-controls="${blockKey}"
                >
                    <span class="collapse-block-toggle" aria-hidden="true"></span>
                    <span class="collapse-block-title">${escapeHtml(title || '明细')}</span>
                </button>
                <div class="collapse-block-body" id="${blockKey}"${collapsed ? ' hidden' : ''}>
                    ${body}
                </div>
            </div>
        `;
    }

    function resolveCollapseState(key, defaultCollapsed) {
        if (!key) {
            return Boolean(defaultCollapsed);
        }

        if (Object.prototype.hasOwnProperty.call(collapseStateStore, key)) {
            return Boolean(collapseStateStore[key]);
        }

        return Boolean(defaultCollapsed);
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

    function handlePanelToggle(event) {
        const collapseHead = event.target.closest('[data-collapse-toggle="block"]');
        if (collapseHead) {
            toggleCollapseBlock(collapseHead);
            return;
        }

        const layoutToggle = event.target.closest('[data-component-toggle="layout"]');
        if (layoutToggle) {
            toggleComponentLayoutRows(layoutToggle);
            return;
        }

        const jiraActionButton = event.target.closest('[data-jira-action="view-detail"]');
        if (jiraActionButton) {
            handleJiraRecentIssueDetailAction(jiraActionButton);
            return;
        }

        const jiraRecentPageButton = event.target.closest('[data-jira-action="recent-page"]');
        if (jiraRecentPageButton) {
            handleJiraRecentIssuesPageAction(jiraRecentPageButton);
            return;
        }

        const jiraAnalyzeButton = event.target.closest('[data-jira-action="analyze-similar"]');
        if (jiraAnalyzeButton) {
            handleJiraSimilarAnalysisAction(jiraAnalyzeButton);
            return;
        }

        const jiraAnalyzeMoreButton = event.target.closest('[data-jira-action="analyze-similar-more"]');
        if (jiraAnalyzeMoreButton) {
            handleJiraSimilarAnalysisMoreAction(jiraAnalyzeMoreButton);
            return;
        }

        handleTreeToggle(event);
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

    function toggleCollapseBlock(head) {
        const bodyId = head.getAttribute('aria-controls');
        const body = bodyId ? document.getElementById(bodyId) : null;
        const block = body && body.closest('.collapse-block');
        if (!block || !body) {
            return;
        }

        const isCollapsed = block.classList.toggle('is-collapsed');
        if (bodyId) {
            collapseStateStore[bodyId] = isCollapsed;
        }
        body.hidden = isCollapsed;
        head.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

        const textNode = head.querySelector('.section-collapse-text');
        if (textNode) {
            textNode.textContent = isCollapsed ? '展开' : '收起';
        }
    }

    function toggleComponentLayoutRows(button) {
        const layoutKey = button.getAttribute('data-layout-key');
        const row = button.closest('tr');
        const table = row && row.closest('table');
        if (!layoutKey || !row || !table) {
            return;
        }

        const isCollapsed = row.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

        Array.from(table.querySelectorAll('tbody tr')).forEach((tableRow) => {
            if (tableRow === row) {
                return;
            }

            const ancestorKeys = (tableRow.dataset.ancestorLayoutKeys || '').split(',').filter(Boolean);
            if (!ancestorKeys.includes(layoutKey)) {
                return;
            }

            const shouldHide = hasCollapsedAncestorLayout(tableRow, table);
            tableRow.hidden = shouldHide;
        });
    }

    function hasCollapsedAncestorLayout(row, table) {
        const ancestorKeys = (row.dataset.ancestorLayoutKeys || '').split(',').filter(Boolean);
        if (!ancestorKeys.length) {
            return false;
        }

        return ancestorKeys.some((key) => {
            const ancestorRow = table.querySelector(`tr[data-row-key="${cssEscapeValue(key)}"]`);
            return ancestorRow && ancestorRow.classList.contains('is-collapsed');
        });
    }

    function cssEscapeValue(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }

        return String(value).replace(/["\\]/g, '\\$&');
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

    function buildJiraPendingState(message, params, jiraParams) {
        return {
            state: 'pending',
            message: message,
            issueKey: (jiraParams && jiraParams.issueKey) || (params && params.jiraIssueKey) || '',
            hasCookie: Boolean(jiraParams && jiraParams.cookie)
        };
    }

    async function requestJiraIssueTable(jiraParams) {
        const proxyUrl = buildLocalProxyUrl(CONFIG.tabs.jiraAnalysis.proxyBasePath + '/issue-table');
        const payload = Object.assign({}, CONFIG.tabs.jiraAnalysis.listRequest || {}, {
            jql: buildJiraJql(jiraParams.issueKey)
        });

        return requestCustomJson({
            url: proxyUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'x-jira-cookie': jiraParams.cookie
            },
            body: JSON.stringify(payload),
            authErrorMessage: 'Jira 系统 Cookie 无效，请重新填写后重试'
        });
    }

    async function requestJiraIssueDetail(currentIssue, jiraParams) {
        const proxyUrl = new URL(buildLocalProxyUrl(CONFIG.tabs.jiraAnalysis.proxyBasePath + '/issue-detail'));
        proxyUrl.searchParams.set('issueId', currentIssue.id);
        proxyUrl.searchParams.set('issueKey', jiraParams.issueKey);
        proxyUrl.searchParams.set('_', Date.now());

        return requestCustomJson({
            url: proxyUrl.toString(),
            method: 'GET',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'x-jira-cookie': jiraParams.cookie
            },
            authErrorMessage: 'Jira 系统 Cookie 无效，请重新填写后重试'
        });
    }

    async function requestJiraSimilarIssuesAnalysis(currentIssue, issueTable) {
        const proxyUrl = buildLocalProxyUrl(CONFIG.tabs.jiraAnalysis.proxyBasePath + '/similar-issues-analysis');
        const issueList = Array.isArray(issueTable && issueTable.table) ? issueTable.table : [];
        const payload = {
            issueKey: currentIssue && currentIssue.key ? currentIssue.key : '',
            currentSummary: currentIssue && currentIssue.summary ? currentIssue.summary : '',
            candidates: issueList.map((item) => ({
                issueKey: item.key || '',
                issueId: item.id || '',
                summary: item.summary || '',
                status: item.status || '-',
                type: getNestedFieldValue(item, ['type', 'name']) || '-'
            }))
        };

        // 提交分析任务
        const submitResponse = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(payload)
        });
        const submitResult = await submitResponse.json();

        if (!submitResult.success) {
            throw new Error(submitResult.message || '任务提交失败');
        }

        // 如果立即返回结果（非异步模式）
        if (submitResult.data.state === 'loaded') {
            return submitResult;
        }

        return pollJiraSimilarIssuesAnalysisTask(submitResult.data.taskId, issueList.length);
    }

    async function requestJiraSimilarIssuesAnalysisMore(taskId, candidateCount) {
        const proxyUrl = buildLocalProxyUrl(CONFIG.tabs.jiraAnalysis.proxyBasePath + '/similar-issues-analysis/continue');
        const submitResponse = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify({ taskId: taskId || '' })
        });
        const submitResult = await submitResponse.json();

        if (!submitResult.success) {
            throw new Error(submitResult.message || '继续分析任务提交失败');
        }

        if (submitResult.data.state === 'loaded') {
            return submitResult;
        }

        return pollJiraSimilarIssuesAnalysisTask(
            submitResult.data.taskId,
            candidateCount || (submitResult.data.analysis ? submitResult.data.analysis.candidateCount || 0 : 0)
        );
    }

    async function pollJiraSimilarIssuesAnalysisTask(taskId, candidateCount) {
        // 轮询查询状态
        const maxAttempts = 120;
        const pollInterval = 5000;
        let attempts = 0;

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            const statusUrl = buildLocalProxyUrl(CONFIG.tabs.jiraAnalysis.proxyBasePath + '/similar-issues-analysis/status/' + taskId);
            const statusResponse = await fetch(statusUrl);
            const statusResult = await statusResponse.json();

            if (statusResult.success && statusResult.data.state === 'loaded') {
                return statusResult;
            } else if (!statusResult.success) {
                throw new Error(statusResult.message || '分析失败');
            }

            attempts++;

            // 更新进度显示
            if (elements.panels && elements.panels.jiraAnalysis && currentJiraAnalysisData) {
                const progressMessage = '正在分析相似工单... (' + (attempts * 5) + '秒)';
                const existingAnalysis = currentJiraAnalysisData.similarSceneAnalysis && currentJiraAnalysisData.similarSceneAnalysis.analysis
                    ? currentJiraAnalysisData.similarSceneAnalysis.analysis
                    : {};
                currentJiraAnalysisData.similarSceneAnalysis = {
                    state: 'loading',
                    message: progressMessage,
                    taskId: taskId,
                    matches: currentJiraAnalysisData.similarSceneAnalysis && Array.isArray(currentJiraAnalysisData.similarSceneAnalysis.matches)
                        ? currentJiraAnalysisData.similarSceneAnalysis.matches
                        : [],
                    analysis: {
                        source: 'loading',
                        candidateCount: candidateCount,
                        matchedCount: existingAnalysis.matchedCount || 0,
                        analyzedCount: existingAnalysis.analyzedCount || 0,
                        currentBatch: existingAnalysis.currentBatch || 0,
                        totalBatches: existingAnalysis.totalBatches || Math.max(1, Math.ceil((candidateCount || 0) / 30)),
                        hasMore: true,
                        conclusion: ''
                    }
                };
                elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            }
        }

        throw new Error('分析超时，请稍后重试');
    }

    async function handleJiraSimilarAnalysisAction(button) {
        if (!button || button.disabled) {
            return;
        }

        if (!currentJiraAnalysisData || !currentJiraAnalysisData.raw) {
            showToast('当前 Jira 数据尚未加载完成', 'error');
            return;
        }

        const rawIssueTable = currentJiraAnalysisData.raw.issueTable;
        const currentIssue = {
            key: currentJiraAnalysisData.issueKey || '',
            id: currentJiraAnalysisData.issueId || '',
            summary: currentJiraAnalysisData.currentIssueBase ? currentJiraAnalysisData.currentIssueBase.标题 || '' : '',
            status: currentJiraAnalysisData.status || '-',
            type: {
                name: currentJiraAnalysisData.currentIssueBase ? currentJiraAnalysisData.currentIssueBase.类型 || '-' : '-'
            }
        };

        button.disabled = true;
        currentJiraAnalysisData.similarSceneAnalysis = buildJiraSimilarAnalysisLoadingState(rawIssueTable);
        elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);

        try {
            const analysisResponse = await requestJiraSimilarIssuesAnalysis(currentIssue, rawIssueTable);
            currentJiraAnalysisData.similarSceneAnalysis = normalizeJiraSimilarIssuesAnalysisResponse(analysisResponse);
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            showToast(
                currentJiraAnalysisData.similarSceneAnalysis.analysis && currentJiraAnalysisData.similarSceneAnalysis.analysis.hasMore
                    ? '首批相似场景工单分析完成'
                    : '相似场景工单分析完成',
                'success'
            );
        } catch (error) {
            currentJiraAnalysisData.similarSceneAnalysis = buildJiraSimilarAnalysisErrorState(error, rawIssueTable);
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            showToast(error.message || '相似场景工单分析失败', 'error');
        }
    }

    async function handleJiraSimilarAnalysisMoreAction(button) {
        if (!button || button.disabled || !currentJiraAnalysisData || !currentJiraAnalysisData.raw) {
            return;
        }

        const rawIssueTable = currentJiraAnalysisData.raw.issueTable;
        const similarSceneAnalysis = currentJiraAnalysisData.similarSceneAnalysis || {};
        const analysis = similarSceneAnalysis.analysis || {};
        const taskId = similarSceneAnalysis.taskId || '';

        if (!taskId) {
            showToast('缺少分析任务标识，请重新开始分析', 'error');
            return;
        }

        button.disabled = true;
        currentJiraAnalysisData.similarSceneAnalysis = buildJiraSimilarAnalysisLoadingState(rawIssueTable, similarSceneAnalysis);
        elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);

        try {
            const analysisResponse = await requestJiraSimilarIssuesAnalysisMore(taskId, analysis.candidateCount || 0);
            currentJiraAnalysisData.similarSceneAnalysis = normalizeJiraSimilarIssuesAnalysisResponse(analysisResponse);
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            showToast(
                currentJiraAnalysisData.similarSceneAnalysis.analysis && currentJiraAnalysisData.similarSceneAnalysis.analysis.hasMore
                    ? '已完成一批分析，可继续分析更多工单'
                    : '全部相似场景工单分析完成',
                'success'
            );
        } catch (error) {
            currentJiraAnalysisData.similarSceneAnalysis = buildJiraSimilarAnalysisErrorState(error, rawIssueTable, similarSceneAnalysis);
            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            showToast(error.message || '继续分析相似场景工单失败', 'error');
        }
    }

    function handleJiraRecentIssuesPageAction(button) {
        if (!button || button.disabled || !currentJiraAnalysisData || !elements.panels.jiraAnalysis) {
            return;
        }

        const recentIssues = Array.isArray(currentJiraAnalysisData.recentIssues) ? currentJiraAnalysisData.recentIssues : [];
        if (!recentIssues.length) {
            return;
        }

        const totalPages = Math.max(1, Math.ceil(recentIssues.length / JIRA_RECENT_ISSUES_PAGE_SIZE));
        const targetPage = Math.min(
            Math.max(Number(button.getAttribute('data-page')) || 1, 1),
            totalPages
        );

        currentJiraAnalysisData.recentIssuesCurrentPage = targetPage;
        elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
    }

    async function handleJiraRecentIssueDetailAction(button) {
        if (!button || button.disabled) {
            return;
        }

        if (!currentJiraAnalysisData) {
            showToast('当前 Jira 数据尚未加载完成', 'error');
            return;
        }

        const issueId = String(button.getAttribute('data-issue-id') || '').trim();
        const issueKey = normalizeJiraIssueKey(button.getAttribute('data-issue-key') || '');
        const detailSource = String(button.getAttribute('data-detail-source') || '').trim();
        const jiraCookie = loadJiraCookieFromStorage();

        if (!issueId || !issueKey) {
            showToast('当前列表项缺少 issueId 或 Jira 编号', 'error');
            return;
        }

        if (!jiraCookie) {
            showToast('请先填写 Jira系统Cookie', 'error');
            return;
        }

        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = '加载中...';

        try {
            const issueDetailRaw = await requestJiraIssueDetail({ id: issueId, key: issueKey }, { issueKey: issueKey, cookie: jiraCookie });
            const issueDetail = normalizeJiraIssueDetailResponse(issueDetailRaw);
            const detailFields = extractJiraDetailFields(issueDetail);
            const solutionValue = findJiraFieldValue(detailFields, ['解决方案']) || '-';
            const detailEntries = detailFields.reduce((result, item) => {
                result[item.label] = item.value;
                return result;
            }, {});

            if (!detailEntries['解决方案']) {
                detailEntries['解决方案'] = solutionValue;
            }

            currentJiraAnalysisData.selectedRecentIssueDetail = {
                issueId: issueId,
                issueKey: issueKey,
                source: detailSource || 'recent',
                sourceLabel: detailSource === 'similar' ? '相似场景工单详情' : '近期工单详情',
                detail: detailEntries
            };

            elements.panels.jiraAnalysis.innerHTML = renderJiraAnalysisValue(currentJiraAnalysisData);
            scrollToJiraRecentIssueDetail();
            showToast(`已加载 ${issueKey} 的工单详细内容`, 'success');
        } catch (error) {
            showToast(error.message || '加载近期工单详情失败', 'error');
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    function scrollToJiraRecentIssueDetail() {
        const detailAnchor = document.getElementById('jira-recent-issue-detail-anchor');
        if (!detailAnchor) {
            return;
        }

        requestAnimationFrame(() => {
            detailAnchor.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        });
    }

    async function requestCustomJson(options) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

        try {
            const response = await fetch(options.url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const contentType = response.headers.get('content-type') || '';
            const responseBody = contentType.includes('application/json') || contentType.includes('text/json')
                ? await response.json().catch(() => null)
                : await response.text();

            if (!response.ok) {
                const message = extractProxyErrorMessage(responseBody) ||
                    (response.status === 401 || response.status === 403 ? options.authErrorMessage : '') ||
                    `HTTP ${response.status}: ${response.statusText}`;
                throw new Error(message);
            }

            return responseBody;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请稍后重试');
            }
            throw error;
        }
    }

    function extractProxyErrorMessage(responseBody) {
        if (!responseBody || typeof responseBody !== 'object') {
            return '';
        }

        return responseBody.error && responseBody.error.message
            ? responseBody.error.message
            : '';
    }

    function buildLocalProxyUrl(path) {
        const proxyBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? `${window.location.protocol}//${window.location.hostname}:18080`
            : window.location.origin;
        return new URL(path, proxyBase).toString();
    }

    function buildJiraJql(issueKey) {
        const template = CONFIG.tabs.jiraAnalysis.jqlTemplate || 'issueKey = {issueKey} order by created DESC';
        return template.replace(/\{issueKey\}/g, issueKey);
    }

    function normalizeJiraIssueTableResponse(response) {
        if (!response || typeof response !== 'object') {
            throw new Error('Jira 列表接口返回为空');
        }

        return response.issueTable || response.data || response;
    }

    function normalizeJiraIssueDetailResponse(response) {
        if (!response || typeof response !== 'object') {
            throw new Error('Jira 详情接口返回为空');
        }

        return response.data || response;
    }

    function formatSimilarityScore(value) {
        const score = Number(value);
        if (!Number.isFinite(score)) {
            return '-';
        }

        return `${Math.round(score * 100)}%`;
    }

    function formatJiraSimilarAnalysisSource(source, state) {
        if (state === 'pending') {
            return '未触发';
        }

        if (state === 'loading') {
            return '分析中';
        }

        if (source === 'fallback') {
            return '本地兜底匹配';
        }

        if (source === 'llm') {
            return '智能体分析';
        }

        return '-';
    }

    function findCurrentJiraIssue(issueTable, issueKey) {
        const issueList = Array.isArray(issueTable && issueTable.table) ? issueTable.table : [];
        return issueList.find((item) => normalizeJiraIssueKey(item && item.key) === normalizeJiraIssueKey(issueKey)) || null;
    }

    function buildJiraAnalysisRenderData(params, jiraParams, issueTable, currentIssue, issueDetail, similarSceneAnalysis) {
        const recentIssues = Array.isArray(issueTable && issueTable.table)
            ? issueTable.table.map((item) => ({
                Jira编号: item.key || '-',
                issueId: item.id || '-',
                标题: item.summary || '-',
                状态: item.status || '-',
                类型: getNestedFieldValue(item, ['type', 'name']) || '-'
            }))
            : [];

        const detailFields = extractJiraDetailFields(issueDetail);
        const promotedBaseInfo = pickJiraFieldEntries(detailFields, ['剩余处理时长', 'SOP单据号', '外部系统编号']);
        const promotedFieldLabels = new Set(Object.keys(promotedBaseInfo));
        const detailEntries = detailFields.reduce((result, item) => {
            if (promotedFieldLabels.has(String(item.label))) {
                return result;
            }
            result[item.label] = item.value;
            return result;
        }, {});

        return {
            state: 'loaded',
            issueKey: currentIssue.key || jiraParams.issueKey,
            issueId: currentIssue.id || '-',
            issueTableTotal: issueTable.total || recentIssues.length || 0,
            status: currentIssue.status || '-',
            priority: findJiraFieldValue(detailFields, ['优先级', 'priority']) || '-',
            currentIssueBase: {
                Jira工单号: currentIssue.key || jiraParams.issueKey || '-',
                issueId: currentIssue.id || '-',
                标题: currentIssue.summary || '-',
                类型: getNestedFieldValue(currentIssue, ['type', 'name']) || '-',
                状态: currentIssue.status || '-',
                优先级: findJiraFieldValue(detailFields, ['优先级', 'priority']) || '-',
                ...promotedBaseInfo
            },
            currentIssueDetail: detailEntries,
            recentIssues: recentIssues,
            similarSceneAnalysis: normalizeJiraSimilarIssuesAnalysisResponse(
                similarSceneAnalysis || buildJiraSimilarAnalysisPendingState(issueTable)
            ),
            raw: {
                issueTable: issueTable,
                issueDetail: issueDetail
            }
        };
    }

    function buildJiraSimilarAnalysisPendingState(issueTable) {
        const candidateCount = Array.isArray(issueTable && issueTable.table) ? issueTable.table.length : 0;
        return {
            state: 'pending',
            message: '待开始分析',
            matches: [],
            analysis: {
                source: 'pending',
                candidateCount: candidateCount,
                matchedCount: 0,
                analyzedCount: 0,
                currentBatch: 0,
                totalBatches: candidateCount ? Math.ceil(candidateCount / 30) : 0,
                hasMore: candidateCount > 0,
                conclusion: ''
            }
        };
    }

    function buildJiraSimilarAnalysisLoadingState(issueTable, previousState) {
        const candidateCount = Array.isArray(issueTable && issueTable.table) ? issueTable.table.length : 0;
        const previousMatches = previousState && Array.isArray(previousState.matches) ? previousState.matches : [];
        const previousAnalysis = previousState && previousState.analysis && typeof previousState.analysis === 'object'
            ? previousState.analysis
            : {};
        return {
            state: 'loading',
            message: '正在分析相似场景工单，请稍候...',
            taskId: previousState && previousState.taskId ? previousState.taskId : '',
            matches: previousMatches,
            analysis: {
                source: 'loading',
                candidateCount: previousAnalysis.candidateCount || candidateCount,
                matchedCount: previousAnalysis.matchedCount || previousMatches.length,
                analyzedCount: previousAnalysis.analyzedCount || 0,
                currentBatch: previousAnalysis.currentBatch || 0,
                totalBatches: previousAnalysis.totalBatches || (candidateCount ? Math.ceil(candidateCount / 30) : 0),
                hasMore: previousAnalysis.hasMore !== undefined ? Boolean(previousAnalysis.hasMore) : candidateCount > 0,
                conclusion: ''
            }
        };
    }

    function buildJiraSimilarAnalysisErrorState(error, issueTable, previousState) {
        const candidateCount = Array.isArray(issueTable && issueTable.table) ? issueTable.table.length : 0;
        const previousMatches = previousState && Array.isArray(previousState.matches) ? previousState.matches : [];
        const previousAnalysis = previousState && previousState.analysis && typeof previousState.analysis === 'object'
            ? previousState.analysis
            : {};
        return {
            state: 'error',
            message: error && error.message ? error.message : '相似场景分析失败',
            taskId: previousState && previousState.taskId ? previousState.taskId : '',
            matches: previousMatches,
            analysis: {
                source: 'error',
                candidateCount: previousAnalysis.candidateCount || candidateCount,
                matchedCount: previousAnalysis.matchedCount || previousMatches.length,
                analyzedCount: previousAnalysis.analyzedCount || 0,
                currentBatch: previousAnalysis.currentBatch || 0,
                totalBatches: previousAnalysis.totalBatches || (candidateCount ? Math.ceil(candidateCount / 30) : 0),
                hasMore: previousAnalysis.hasMore !== undefined ? Boolean(previousAnalysis.hasMore) : candidateCount > 0,
                conclusion: '相似场景分析未完成'
            }
        };
    }

    function normalizeJiraSimilarIssuesAnalysisResponse(response) {
        if (!response || typeof response !== 'object') {
            return {
                state: 'error',
                message: '相似场景分析接口返回为空',
                matches: [],
                analysis: {}
            };
        }

        const payload = response.data && typeof response.data === 'object' ? response.data : response;
        return {
            state: payload.state || 'loaded',
            message: payload.message || '',
            taskId: payload.taskId || (currentJiraAnalysisData && currentJiraAnalysisData.similarSceneAnalysis ? currentJiraAnalysisData.similarSceneAnalysis.taskId || '' : ''),
            matches: Array.isArray(payload.matches) ? payload.matches : [],
            analysis: payload.analysis && typeof payload.analysis === 'object'
                ? Object.assign({ source: 'llm' }, payload.analysis)
                : { source: 'llm' }
        };
    }

    function extractJiraDetailFields(issueDetail) {
        const fields = Array.isArray(issueDetail && issueDetail.fields) ? issueDetail.fields : [];
        const whitelist = Array.isArray(CONFIG.tabs.jiraAnalysis.detailFieldWhitelist)
            ? CONFIG.tabs.jiraAnalysis.detailFieldWhitelist
            : [];
        const priorityLabels = new Set(['剩余处理时长', 'SOP单据号', '外部系统编号', '到期日', '解决方案']);
        const filteredFields = whitelist.length
            ? fields.filter((item) => whitelist.includes(item.id) || priorityLabels.has(String(item.label || '')))
            : fields;

        return filteredFields.map((field) => ({
            id: field.id || '-',
            label: field.label || field.id || '-',
            value: formatJiraFieldValue(field.label || field.id || '-', parseJiraFieldHtmlValue(field.editHtml))
        }));
    }

    function pickJiraFieldEntries(fields, labels) {
        const labelSet = new Set((labels || []).map((item) => String(item)));
        return (fields || []).reduce((result, item) => {
            if (labelSet.has(String(item.label))) {
                result[item.label] = item.value;
            }
            return result;
        }, {});
    }

    function findJiraFieldValue(fields, labels) {
        const labelSet = new Set((labels || []).map((item) => String(item)));
        const matched = (fields || []).find((item) => labelSet.has(String(item.label)) || labelSet.has(String(item.id)));
        return matched ? matched.value : '';
    }

    function parseJiraFieldHtmlValue(editHtml) {
        if (!editHtml) {
            return '-';
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(String(editHtml), 'text/html');

        const dateInputValues = Array.from(doc.querySelectorAll('.aui-field-datepicker input:not([type="hidden"]), input.datepicker-input'))
            .map((input) => normalizeWhitespace(input.value))
            .filter(Boolean);
        if (dateInputValues.length) {
            return dateInputValues.join(' / ');
        }

        const checkedRadios = Array.from(doc.querySelectorAll('input[type="radio"]:checked'))
            .map((input) => findLabelText(doc, input))
            .filter(Boolean);
        if (checkedRadios.length) {
            return checkedRadios.join(' / ');
        }

        const checkedCheckboxes = Array.from(doc.querySelectorAll('input[type="checkbox"]:checked'))
            .map((input) => findLabelText(doc, input))
            .filter(Boolean);
        if (checkedCheckboxes.length) {
            return checkedCheckboxes.join(' / ');
        }

        const selectedOptions = Array.from(doc.querySelectorAll('select option:checked'))
            .map((option) => normalizeWhitespace(option.textContent))
            .filter((text) => text && text !== '无');
        if (selectedOptions.length) {
            return selectedOptions.join(' / ');
        }

        const textareas = Array.from(doc.querySelectorAll('textarea'))
            .map((item) => normalizeWhitespace(item.value || item.textContent))
            .filter(Boolean);
        if (textareas.length) {
            return textareas.join('\n');
        }

        const inputs = Array.from(doc.querySelectorAll('input'))
            .filter((input) => {
                const type = String(input.getAttribute('type') || 'text').toLowerCase();
                return !['hidden', 'radio', 'checkbox', 'button', 'submit'].includes(type);
            })
            .map((input) => normalizeWhitespace(input.value))
            .filter(Boolean);
        if (inputs.length) {
            return inputs.join(' / ');
        }

        const richText = Array.from(doc.querySelectorAll('.content-inner, .description, p'))
            .map((item) => normalizeWhitespace(item.textContent))
            .filter(Boolean);
        if (richText.length) {
            return richText.join(' / ');
        }

        return normalizeWhitespace(doc.body.textContent) || '-';
    }

    function formatJiraFieldValue(label, value) {
        if (isEmptyValue(value) || value === '-') {
            return '-';
        }

        if (isPreciseJiraSolutionLabel(label)) {
            return formatJiraSolutionValue(value);
        }

        if (String(label).includes('到期日')) {
            return formatJiraDateValue(value);
        }

        return value;
    }

    function isPreciseJiraSolutionLabel(label) {
        return String(label || '').trim() === '解决方案';
    }

    function formatJiraSolutionValue(value) {
        return String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function formatJiraDateValue(value) {
        const normalized = normalizeWhitespace(value);
        if (!normalized) {
            return '-';
        }

        const isoLikeValue = normalized
            .replace(/\//g, '-')
            .replace('T', ' ')
            .replace(/([+-]\d{2}:\d{2}|Z)$/i, '')
            .trim();

        const match = isoLikeValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::\d{2})?)?/);
        if (!match) {
            return normalized;
        }

        const [, year, month, day, hour, minute] = match;
        if (hour && minute) {
            return `${year}-${month}-${day} ${hour}:${minute}`;
        }

        return `${year}-${month}-${day}`;
    }

    function findLabelText(doc, input) {
        const inputId = input.getAttribute('id');
        if (inputId) {
            const label = doc.querySelector(`label[for="${cssEscapeValue(inputId)}"]`);
            if (label) {
                return normalizeWhitespace(label.textContent);
            }
        }

        const parentLabel = input.closest('label');
        if (parentLabel) {
            return normalizeWhitespace(parentLabel.textContent);
        }

        const nextSiblingLabel = input.parentElement && input.parentElement.querySelector('label');
        return nextSiblingLabel ? normalizeWhitespace(nextSiblingLabel.textContent) : '';
    }

    function renderMissingParams() {
        renderSummary({
            environment: '-',
            authType: 'sso',
            ytenant_id: '-',
            pkBo: '-',
            pkBoins: '-',
            jiraIssueKey: '-',
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
                流程定义ID: 'mock-proc-def',
                主表字段数量: 3,
                子表数量: 1,
                主表字段: [
                    { rowType: 'field', depth: 0, title: '申请人', fieldId: 'applicant', columncode: 'applicant_code', componentType: 'Employee', tablePathLabel: '主表直出区域', required: '是', visible: '是', invisible: '否' },
                    { rowType: 'tableLayout', depth: 0, title: '申请基础信息表格', fieldId: '-', columncode: '-', componentType: 'TableLayout', tablePathLabel: '申请基础信息表格', childFieldCount: 2, required: '-', visible: '-', invisible: '-' },
                    { rowType: 'field', depth: 1, title: '申请部门', fieldId: 'dept', columncode: 'dept_code', componentType: 'Department', tablePathLabel: '申请基础信息表格', required: '是', visible: '是', invisible: '否' },
                    { rowType: 'field', depth: 1, title: '联系电话', fieldId: 'mobile', columncode: 'mobile_code', componentType: 'Mobile', tablePathLabel: '申请基础信息表格', required: '否', visible: '是', invisible: '否' }
                ],
                子表配置: [
                    {
                        标题: '采购明细',
                        fieldId: 'detail',
                        columncode: '-',
                        组件类型: 'DataTable',
                        子字段数量: 2,
                        子字段明细: [
                            { rowType: 'tableLayout', depth: 0, title: '明细表格', fieldId: '-', columncode: '-', componentType: 'TableLayout', tablePathLabel: '明细表格', childFieldCount: 2, required: '-', visible: '-', invisible: '-' },
                            { rowType: 'field', depth: 1, title: '物料名称', fieldId: 'itemName', columncode: 'item_name', componentType: 'Input', tablePathLabel: '明细表格', required: '是', visible: '是', invisible: '否' },
                            { rowType: 'field', depth: 1, title: '数量', fieldId: 'qty', columncode: 'qty', componentType: 'Number', tablePathLabel: '明细表格', required: '是', visible: '是', invisible: '否' }
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
                流程环节信息: [
                    { 序号: 1, 环节Id: 'approve_1', 环节名称: '直属主管审批' }
                ],
                审批记录: [
                    { 序号: 1, 节点名称: '直属主管审批', 处理人: '李四', 开始时间: '2026-04-22T10:15:00+08:00', 完成时间: '-', 耗时毫秒: '-', 任务定义Key: 'approve_1', 已完成: '否' }
                ],
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
                state: 'loaded',
                issueKey: params.jiraIssueKey || 'UPESN-415300',
                issueId: 8877099,
                issueTableTotal: 1,
                status: '支持确认完成',
                priority: 'P2',
                currentIssueBase: {
                    标题: '【DSP支持问题】草稿箱里的申请可以批量一键提交吗？',
                    类型: '支持问题',
                    状态: '支持确认完成',
                    issueId: 8877099,
                    Jira编号: params.jiraIssueKey || 'UPESN-415300'
                },
                currentIssueDetail: {
                    概要: '【DSP支持问题】草稿箱里的申请可以批量一键提交吗？',
                    领域模块: '协同 / 审批-表单',
                    问题来源: '外部系统',
                    AI处理结果: '当前仍使用 mock 数据'
                },
                recentIssues: [
                    { Jira编号: params.jiraIssueKey || 'UPESN-415300', issueId: 8877099, 标题: '审批轨迹查询偶发超时', 状态: '处理中', 类型: '支持问题' }
                ],
                similarSceneAnalysis: {
                    state: 'loaded',
                    matches: [
                        {
                            issueKey: 'UPESN-415210',
                            issueId: 8877001,
                            summary: '草稿箱提交后审批未触发，用户希望支持批量提交处理',
                            status: '已解决',
                            type: '支持问题',
                            similarityScore: 0.86,
                            matchReason: '草稿箱批量提交与审批触发问题的语义描述接近'
                        }
                    ],
                    analysis: {
                        candidateCount: 3,
                        matchedCount: 1,
                        conclusion: 'Mock 数据中命中 1 条相似场景工单'
                    }
                }
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

    function normalizeJiraIssueKey(value) {
        return String(value || '').trim().toUpperCase();
    }

    function normalizeJiraCookieValue(value) {
        const normalized = String(value || '').trim();
        return normalized.replace(/^cookie\s*:\s*/i, '').trim();
    }

    function normalizeWhitespace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
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

    function normalizeBooleanValue(value) {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            if (value === 1) {
                return true;
            }
            if (value === 0) {
                return false;
            }
            return value;
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1') {
                return true;
            }
            if (normalized === 'false' || normalized === '0') {
                return false;
            }
            return value;
        }

        return value;
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

