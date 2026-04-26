/**
 * IForm-AI H5 Business System
 * Home Page Script
 */

(function() {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'iform_ai_params',
        DETAIL_PAGE: './detail.html',
        DEFAULT_ENVIRONMENT: 'test',
        DEFAULT_AUTH_TYPE: 'yht_access_token',
        DEFAULT_FORM_PARAM_MODE: 'url',
        RESOLVE_URL_API: '/api/resolve-form-params'
    };

    const elements = {
        form: document.getElementById('businessForm'),
        environment: document.getElementById('environment'),
        formParamMode: document.getElementById('formParamMode'),
        authType: document.getElementById('authType'),
        ytenantId: document.getElementById('ytenant_id'),
        pkBo: document.getElementById('pkBo'),
        pkBoins: document.getElementById('pkBoins'),
        jiraIssueKey: document.getElementById('jiraIssueKey'),
        billUrl: document.getElementById('billUrl'),
        ssoUrl: document.getElementById('ssoUrl'),
        secretKey: document.getElementById('secretKey'),
        linkPassword: document.getElementById('linkPassword'),
        yhtAccessToken: document.getElementById('yhtAccessToken'),
        manualParamGroup: document.getElementById('manualParamGroup'),
        urlParamGroup: document.getElementById('urlParamGroup'),
        ssoAuthGroup: document.getElementById('ssoAuthGroup'),
        tokenAuthGroup: document.getElementById('tokenAuthGroup'),
        submitBtn: document.querySelector('.btn-primary'),
        btnText: document.querySelector('.btn-text'),
        btnLoading: document.querySelector('.btn-loading'),
        toast: document.getElementById('toast'),
        toastMessage: document.querySelector('.toast-message')
    };

    function init() {
        bindEvents();
        loadFromStorage();
        loadFromURL();
        syncAuthMode();
        syncFormParamMode();
    }

    function bindEvents() {
        const saveHandler = debounce(saveToStorage, 400);

        elements.form.addEventListener('submit', handleSubmit);
        elements.form.addEventListener('reset', handleReset);
        elements.environment.addEventListener('change', () => {
            syncEnvironmentDependentFields();
            saveHandler();
        });
        elements.formParamMode.addEventListener('change', () => {
            syncFormParamMode();
            saveHandler();
        });
        elements.authType.addEventListener('change', () => {
            syncAuthMode();
            saveHandler();
        });
        elements.ytenantId.addEventListener('input', saveHandler);
        elements.pkBo.addEventListener('input', saveHandler);
        elements.pkBoins.addEventListener('input', saveHandler);
        elements.jiraIssueKey.addEventListener('input', saveHandler);
        elements.billUrl.addEventListener('input', saveHandler);
        elements.ssoUrl.addEventListener('input', saveHandler);
        elements.secretKey.addEventListener('input', saveHandler);
        elements.linkPassword.addEventListener('input', saveHandler);
        elements.yhtAccessToken.addEventListener('input', saveHandler);
    }

    async function handleSubmit(event) {
        event.preventDefault();

        let formData = getFormData();
        if (!validateForm(formData)) {
            return;
        }

        setLoading(true);

        try {
            if (formData.formParamMode === 'url') {
                formData = await resolveFormParamsFromUrl(formData);
            }

            saveToStorage(formData);
            navigateToDetail(formData);
        } catch (error) {
            console.error('Failed to resolve form params:', error);
            showToast(error.message || '解析单据链接失败', 'error');
            setLoading(false);
        }
    }

    function handleReset() {
        clearStorage();
        clearURL();
        setTimeout(() => {
            setEnvironmentValue(CONFIG.DEFAULT_ENVIRONMENT);
            setAuthTypeValue(CONFIG.DEFAULT_AUTH_TYPE);
            setFormParamModeValue(CONFIG.DEFAULT_FORM_PARAM_MODE);
            syncAuthMode();
            syncFormParamMode();
        }, 0);
    }

    function getFormData() {
        return {
            environment: elements.environment.value,
            formParamMode: normalizeFormParamMode(elements.formParamMode.value),
            authType: elements.authType.value,
            ytenant_id: elements.ytenantId.value.trim(),
            pkBo: elements.pkBo.value.trim(),
            pkBoins: elements.pkBoins.value.trim(),
            jiraIssueKey: elements.jiraIssueKey.value.trim(),
            billUrl: elements.billUrl.value.trim(),
            ssoUrl: elements.ssoUrl.value.trim(),
            secretKey: elements.secretKey.value.trim(),
            linkPassword: elements.linkPassword.value.trim(),
            yht_access_token: elements.yhtAccessToken.value.trim()
        };
    }

    function validateForm(data) {
        if (!data.environment) {
            elements.environment.focus();
            showToast('请选择环境', 'error');
            return false;
        }

        if (!data.formParamMode) {
            elements.formParamMode.focus();
            showToast('请选择表单参数设置方式', 'error');
            return false;
        }

        if (data.formParamMode === 'manual') {
            if (!data.pkBo) {
                elements.pkBo.focus();
                showToast('请输入表单Id', 'error');
                return false;
            }

            if (!data.pkBoins) {
                elements.pkBoins.focus();
                showToast('请输入单据Id', 'error');
                return false;
            }
        }

        if (data.formParamMode === 'url') {
            if (!data.billUrl) {
                elements.billUrl.focus();
                showToast('请输入单据链接 URL', 'error');
                return false;
            }

            if (!isValidUrl(data.billUrl)) {
                elements.billUrl.focus();
                showToast('单据链接 URL 格式不正确', 'error');
                return false;
            }

            if (!doesBillUrlMatchEnvironment(data.billUrl, data.environment)) {
                elements.billUrl.focus();
                showToast('单据链接 URL 与当前所选环境不匹配，请检查环境或重新填写链接', 'error');
                return false;
            }
        }

        if (!data.authType) {
            elements.authType.focus();
            showToast('请选择授权方式', 'error');
            return false;
        }

        if (data.authType === 'sso') {
            if (!data.ssoUrl) {
                elements.ssoUrl.focus();
                showToast('请输入 SSO 链接地址', 'error');
                return false;
            }

            if (!isValidUrl(data.ssoUrl)) {
                elements.ssoUrl.focus();
                showToast('SSO 链接地址格式不正确', 'error');
                return false;
            }

            if (!data.secretKey) {
                elements.secretKey.focus();
                showToast('请输入密钥', 'error');
                return false;
            }
        }

        if (isTokenAuth(data.authType) && !data.yht_access_token) {
            elements.yhtAccessToken.focus();
            showToast('请输入 yht_access_token', 'error');
            return false;
        }

        if (data.formParamMode === 'url' && !isTokenAuth(data.authType)) {
            elements.authType.focus();
            showToast('单据链接解析仅支持 yht_access_token 授权', 'error');
            return false;
        }

        return true;
    }

    async function resolveFormParamsFromUrl(data) {
        clearResolvedFormParams();

        const apiUrl = new URL(CONFIG.RESOLVE_URL_API, getProxyBase());
        apiUrl.searchParams.set('env', normalizeEnvironment(data.environment));
        apiUrl.searchParams.set('url', data.billUrl);

        const response = await fetch(apiUrl.toString(), {
            method: 'GET',
            headers: {
                yht_access_token: data.yht_access_token
            }
        });

        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.success === false) {
            throw new Error(
                (result && result.error && result.error.message) ||
                '解析单据链接失败'
            );
        }

        if (!result.data || !result.data.formId || !result.data.formInstanceId) {
            throw new Error('302 目标地址中未解析到 formId 或 formInstanceId');
        }

        elements.pkBo.value = result.data.formId;
        elements.pkBoins.value = result.data.formInstanceId;

        return Object.assign({}, data, {
            pkBo: result.data.formId,
            pkBoins: result.data.formInstanceId
        });
    }

    function getProxyBase() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return `${window.location.protocol}//${window.location.hostname}:18080`;
        }

        return window.location.origin;
    }

    function navigateToDetail(params) {
        const detailUrl = new URL(CONFIG.DETAIL_PAGE, window.location.href);

        Object.keys(params).forEach((key) => {
            if (params[key] !== '') {
                detailUrl.searchParams.set(key, params[key]);
            }
        });

        window.location.href = detailUrl.toString();
    }

    function loadFromURL() {
        const url = new URL(window.location.href);

        const authType = url.searchParams.get('authType');
        if (authType) {
            setAuthTypeValue(authType);
        }

        const formParamMode = url.searchParams.get('formParamMode');
        if (formParamMode) {
            setFormParamModeValue(formParamMode);
        }

        const environment = url.searchParams.get('environment');
        if (environment) {
            setEnvironmentValue(environment);
        }

        const fieldMap = {
            ytenant_id: elements.ytenantId,
            pkBo: elements.pkBo,
            pkBoins: elements.pkBoins,
            jiraIssueKey: elements.jiraIssueKey,
            billUrl: elements.billUrl,
            ssoUrl: elements.ssoUrl,
            secretKey: elements.secretKey,
            linkPassword: elements.linkPassword,
            yht_access_token: elements.yhtAccessToken
        };

        Object.keys(fieldMap).forEach((key) => {
            const value = url.searchParams.get(key);
            if (value) {
                fieldMap[key].value = value;
            }
        });
    }

    function clearURL() {
        window.history.replaceState({}, '', window.location.pathname);
    }

    function saveToStorage(data) {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data || getFormData()));
    }

    function loadFromStorage() {
        const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!saved) {
            setEnvironmentValue(CONFIG.DEFAULT_ENVIRONMENT);
            setAuthTypeValue(CONFIG.DEFAULT_AUTH_TYPE);
            setFormParamModeValue(CONFIG.DEFAULT_FORM_PARAM_MODE);
            return;
        }

        try {
            const data = JSON.parse(saved);
            setEnvironmentValue(data.environment || CONFIG.DEFAULT_ENVIRONMENT);
            setAuthTypeValue(normalizeAuthType(data.authType || CONFIG.DEFAULT_AUTH_TYPE));
            setFormParamModeValue(normalizeFormParamMode(data.formParamMode || CONFIG.DEFAULT_FORM_PARAM_MODE));
            if (data.ytenant_id) elements.ytenantId.value = data.ytenant_id;
            if (data.pkBo) elements.pkBo.value = data.pkBo;
            if (data.pkBoins) elements.pkBoins.value = data.pkBoins;
            if (data.jiraIssueKey) elements.jiraIssueKey.value = data.jiraIssueKey;
            if (data.billUrl) elements.billUrl.value = data.billUrl;
            if (data.ssoUrl) elements.ssoUrl.value = data.ssoUrl;
            if (data.secretKey) elements.secretKey.value = data.secretKey;
            if (data.linkPassword) elements.linkPassword.value = data.linkPassword;
            if (data.yht_access_token || data.yhtToken) {
                elements.yhtAccessToken.value = data.yht_access_token || data.yhtToken;
            }
        } catch (error) {
            console.error('Failed to load from storage:', error);
            setEnvironmentValue(CONFIG.DEFAULT_ENVIRONMENT);
            setAuthTypeValue(CONFIG.DEFAULT_AUTH_TYPE);
            setFormParamModeValue(CONFIG.DEFAULT_FORM_PARAM_MODE);
        }
    }

    function clearStorage() {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
    }

    function syncAuthMode() {
        const authType = elements.authType.value;
        const isSso = authType === 'sso';

        elements.ssoAuthGroup.classList.toggle('is-hidden', !isSso);
        elements.tokenAuthGroup.classList.toggle('is-hidden', isSso);
    }

    function syncFormParamMode() {
        const isManual = normalizeFormParamMode(elements.formParamMode.value) === 'manual';
        elements.manualParamGroup.classList.toggle('is-hidden', !isManual);
        elements.urlParamGroup.classList.toggle('is-hidden', isManual);
    }

    function syncEnvironmentDependentFields() {
        const clearedItems = [];
        const formMode = normalizeFormParamMode(elements.formParamMode.value);

        if (clearFieldValue(elements.yhtAccessToken)) {
            clearedItems.push('yht_access_token');
        }

        if (formMode === 'url' && clearResolvedFormParams()) {
            clearedItems.push('表单Id/单据Id');
        }

        if (clearFieldValue(elements.billUrl)) {
            clearedItems.push('单据链接');
        }

        if (!clearedItems.length) {
            return;
        }

        if (isTokenAuth(elements.authType.value)) {
            elements.yhtAccessToken.focus();
        }

        showToast(`已切换环境，${clearedItems.join('、')}已清空，请按当前环境重新填写`, 'info');
    }

    function clearResolvedFormParams() {
        const hadValue = Boolean(elements.pkBo.value || elements.pkBoins.value);
        elements.pkBo.value = '';
        elements.pkBoins.value = '';
        return hadValue;
    }

    function clearFieldValue(element) {
        if (!element || !element.value) {
            return false;
        }

        element.value = '';
        return true;
    }

    function setAuthTypeValue(value) {
        elements.authType.value = normalizeAuthType(value);
    }

    function setFormParamModeValue(value) {
        elements.formParamMode.value = normalizeFormParamMode(value);
    }

    function normalizeAuthType(value) {
        return value === 'yht_token' ? 'yht_access_token' : value;
    }

    function normalizeFormParamMode(value) {
        return value === 'url' ? 'url' : 'manual';
    }

    function isTokenAuth(value) {
        return value === 'yht_access_token' || value === 'yht_token';
    }

    function normalizeEnvironment(value) {
        const mapping = {
            core1: 'c1',
            core2: 'c2',
            core3: 'c3',
            core4: 'c4'
        };

        return mapping[value] || value;
    }

    function doesBillUrlMatchEnvironment(billUrl, environment) {
        if (!billUrl || !environment || !isValidUrl(billUrl)) {
            return true;
        }

        const expectedOrigin = getEnvironmentOrigin(environment);
        if (!expectedOrigin) {
            return true;
        }

        try {
            return new URL(billUrl).origin === expectedOrigin;
        } catch (error) {
            return false;
        }
    }

    function getEnvironmentOrigin(environment) {
        const originMap = {
            test: 'https://bip-test.yonyoucloud.com',
            daily: 'https://bip-daily.yonyoucloud.com',
            pre: 'https://bip-pre.yonyoucloud.com',
            core1: 'https://c1.yonyoucloud.com',
            core2: 'https://c2.yonyoucloud.com',
            core3: 'https://c3.yonyoucloud.com',
            core4: 'https://c4.yonyoucloud.com',
            c1: 'https://c1.yonyoucloud.com',
            c2: 'https://c2.yonyoucloud.com',
            c3: 'https://c3.yonyoucloud.com',
            c4: 'https://c4.yonyoucloud.com'
        };

        return originMap[environment] || '';
    }

    function setEnvironmentValue(value) {
        elements.environment.value = value;
    }

    function setLoading(isLoading) {
        elements.submitBtn.disabled = isLoading;
        elements.btnText.style.display = isLoading ? 'none' : 'inline';
        elements.btnLoading.style.display = isLoading ? 'flex' : 'none';
    }

    function showToast(message, type) {
        elements.toastMessage.textContent = message;
        elements.toast.className = 'toast ' + (type || 'info');
        elements.toast.style.display = 'block';

        setTimeout(() => {
            elements.toast.style.display = 'none';
        }, 3000);
    }

    function isValidUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (error) {
            return false;
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(null, args), wait);
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
