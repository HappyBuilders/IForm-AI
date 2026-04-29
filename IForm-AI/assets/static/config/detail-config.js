window.IFormDetailConfig = {
    requestTimeout: 30000,
    storageKey: 'iform_ai_params',
    environments: window.IFormRuntimeConfig && window.IFormRuntimeConfig.environments ? window.IFormRuntimeConfig.environments : {},
    tabs: {
        formConfig: {
            title: '表单配置信息',
            formConfigPathTemplate: '/yonbip-ec-iform/iform_ctr/rt_ctr/{pk_temp}/billVue.json'
        },
        document: {
            title: '单据数据信息',
            path: '/yonbip-ec-iform/iform_ctr/bill_ctr/getFormData'
        },
        approval: {
            title: '流程审批信息',
            path: '/yonbip-ec-iform/iform_ctr/bill_ctr/loadDataJson'
        },
        businessLog: {
            title: '业务日志',
            path: '/api/business/business-log'
        },
        jiraAnalysis: {
            title: 'Jira问题分析',
            proxyBasePath: '/api/jira',
            issueTablePath: '/rest/issueNav/1/issueTable',
            issueDetailPath: '/secure/AjaxIssueEditAction!default.jspa',
            issueBrowsePathTemplate: '/browse/{issueKey}',
            jqlTemplate: '(project = UPESN AND issuetype = 支持问题 AND (领域模块 in cascadeOption(10707, 11001) OR 领域模块 in cascadeOption(10707, 10710)) AND status = 支持确认完成) OR issueKey = {issueKey} order by created DESC',
            listRequest: {
                startIndex: '0',
                layoutKey: 'split-view'
            },
            detailFieldWhitelist: [
                'summary',
                'customfield_10123',
                'priority',
                'customfield_10119',
                'customfield_11919',
                'status',
                'assignee',
                'creator',
                'customfield_10439',
                'customfield_15702',
                'customfield_15703',
                'customfield_15803',
                'customfield_10119',
                'duedate',
                'comment'
            ]
        }
    }
};
