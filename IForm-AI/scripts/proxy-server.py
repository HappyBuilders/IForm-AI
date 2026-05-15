#!/usr/bin/env python3
"""
IForm-AI H5 System - local HTTP server with lightweight proxy support.
"""

import http.server
import json
import os
import re
import shutil
import socketserver
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, unquote

PORT = 18080
SCRIPT_PATH = Path(__file__).resolve()
SKILL_ROOT = SCRIPT_PATH.parent.parent
DIRECTORY = SKILL_ROOT / "assets"
RUNTIME_CONFIG_PATH = DIRECTORY / "static" / "config" / "runtime-config.json"
PROJECT_ROOT = SKILL_ROOT
ANALYSIS_CONTEXT_DIR = PROJECT_ROOT / ".tmp" / "analysis"
AI_ANALYSIS_DATA_GUIDE_PATH = DIRECTORY / "AI_ANALYSIS_DATA_GUIDE.md"
PRIMARY_SKILL_REFERENCES_PATH = SKILL_ROOT / 'references'

REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
SIMILAR_ISSUE_BATCH_SIZE = 30
REFERENCE_INDEX_PREVIEW_LIMIT = 40
REFERENCE_AUTO_SELECT_LIMIT = 6
REFERENCE_FILE_CHUNK_SIZE = 4000
REFERENCE_FILE_MAX_CHUNKS = 3
AI_REFERENCE_FILES = [
    AI_ANALYSIS_DATA_GUIDE_PATH,
    DIRECTORY / '智能业务表单系统详情页数据获取技术方案.md',
    DIRECTORY / 'PROJECT_REQUIREMENTS.md',
    DIRECTORY / 'REQUIREMENT_CHANGES.md'
]
AI_ANALYSIS_MINIMAL_REFERENCE_NAMES = {
    AI_ANALYSIS_DATA_GUIDE_PATH.name,
    'formConfig.json',
    'document.json',
    'approval.json',
    'businessLog.json'
}

# 异步任务存储
LLM_TASKS = {}  # task_id -> {'status': 'pending|running|completed|failed', 'result': None, 'error': None}
REFERENCE_INDEX_CACHE = {'signature': None, 'data': None}
REFERENCE_CONTENT_CACHE = {}
UPDATE_CONFIG_SCRIPT = SCRIPT_PATH.parent / 'update-config.py'


def get_yonclaw_profile_roots():
    roots = []
    seen = set()
    candidates = [
        Path.home() / 'AppData' / 'Roaming' / 'yonclaw' / 'profiles',
        Path.home() / 'Library' / 'Application Support' / 'yonclaw' / 'profiles'
    ]

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.exists():
            continue
        seen.add(key)
        roots.append(resolved)

    return roots


def get_candidate_reference_roots():
    roots = []
    seen = set()

    def add_root(path):
        try:
            resolved = Path(path).resolve()
        except Exception:
            return
        key = str(resolved).lower()
        if key in seen:
            return
        seen.add(key)
        roots.append(resolved)

    # Always prefer the references directory next to the currently executing skill.
    add_root(PRIMARY_SKILL_REFERENCES_PATH)

    for yonclaw_runtime in get_yonclaw_profile_roots():
        for profile_dir in yonclaw_runtime.iterdir():
            if not profile_dir.is_dir():
                continue
            add_root(profile_dir / 'userData' / 'runtime' / 'openclaw' / 'skills' / 'iform-ai' / 'references')

    return roots


def to_project_relative_path(path):
    try:
        resolved = Path(path).resolve()
        return str(resolved.relative_to(PROJECT_ROOT.resolve())).replace('\\', '/')
    except Exception:
        return str(path).replace('\\', '/')


def normalize_manifest_entry(tab_key, entry):
    item = entry if isinstance(entry, dict) else {}
    file_ref = str(item.get('fileRef', '') or '').strip()
    file_name = str(item.get('fileName', '') or '').strip()
    legacy_file_path = str(item.get('filePath', '') or '').strip()

    if not file_ref and legacy_file_path:
        file_ref = to_project_relative_path(legacy_file_path)
    if not file_name and file_ref:
        file_name = Path(file_ref).name
    if not file_name and legacy_file_path:
        file_name = Path(legacy_file_path).name

    return {
        'tabKey': str(item.get('tabKey', '') or '').strip() or tab_key,
        'description': str(item.get('description', '') or '').strip(),
        'fileName': file_name,
        'fileRef': file_ref,
        'updatedAt': item.get('updatedAt')
    }


def refresh_runtime_config():
    global RUNTIME_CONFIG

    if not UPDATE_CONFIG_SCRIPT.exists():
        print('[IForm-AI] 未找到配置更新脚本')
        return

    print('[IForm-AI] 启动前更新 YonClaw 配置...')
    try:
        subprocess.run(
            [sys.executable, str(UPDATE_CONFIG_SCRIPT)],
            check=True,
            cwd=str(PROJECT_ROOT)
        )
        RUNTIME_CONFIG = load_runtime_config()
        print('[IForm-AI] 已重新加载运行时配置')
    except subprocess.CalledProcessError:
        print('[IForm-AI] 配置更新失败，继续使用当前本地配置')


def load_runtime_config():
    default_config = {
        'environments': {},
        'jira': {
            'enabled': False,
            'baseUrl': ''
        },
        'yonclaw': {
            'gatewayUrl': 'http://127.0.0.1:29179/v1/chat/completions',
            'gatewayToken': '',
            'model': 'openclaw/main',
            'cliPath': ''
        }
    }

    if not RUNTIME_CONFIG_PATH.exists():
        return default_config

    try:
        with RUNTIME_CONFIG_PATH.open('r', encoding='utf-8') as config_file:
            loaded = json.load(config_file)
    except Exception as error:
        print(f'[IForm-AI] 运行时配置读取失败: {error}')
        return default_config

    if not isinstance(loaded, dict):
        return default_config

    config = default_config.copy()
    config['environments'] = loaded.get('environments', {}) if isinstance(loaded.get('environments', {}), dict) else {}
    jira_config = loaded.get('jira', {})
    if isinstance(jira_config, dict):
        config['jira'] = {
            'enabled': bool(jira_config.get('enabled')),
            'baseUrl': str(jira_config.get('baseUrl', '') or '').strip()
        }

    # 读取 YonClaw 配置
    yonclaw_config = loaded.get('yonclaw', {})
    if isinstance(yonclaw_config, dict):
        config['yonclaw'] = {
            'gatewayUrl': str(yonclaw_config.get('gatewayUrl', '') or '').strip(),
            'gatewayToken': str(yonclaw_config.get('gatewayToken', '') or '').strip(),
            'model': str(yonclaw_config.get('model', 'openclaw/main') or '').strip(),
            'cliPath': str(yonclaw_config.get('cliPath', '') or '').strip()
        }

    return config


RUNTIME_CONFIG = load_runtime_config()


def get_jira_base_url_from_config():
    jira_config = RUNTIME_CONFIG.get('jira', {})
    if not isinstance(jira_config, dict):
        return ''
    if not jira_config.get('enabled'):
        return ''
    return str(jira_config.get('baseUrl', '') or '').strip().rstrip('/')


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, yht_access_token, x-xsrf-token, x-jira-cookie')
        self.send_header('Access-Control-Max-Age', '86400')

    def do_GET(self):
        if self.path.startswith('/api/resolve-form-params'):
            self.handle_resolve_form_params()
            return

        if self.path.startswith('/api/jira/issue-detail'):
            self.handle_jira_issue_detail()
            return

        if self.path.startswith('/api/llm/analyze/status/'):
            task_id = self.path.split('/api/llm/analyze/status/')[-1]
            self.handle_llm_analyze_status(task_id)
            return

        if self.path.startswith('/api/llm/analyze/result/'):
            task_id = self.path.split('/api/llm/analyze/result/')[-1]
            self.handle_llm_analyze_result(task_id)
            return

        if self.path.startswith('/api/jira/similar-issues-analysis/status/'):
            task_id = self.path.split('/api/jira/similar-issues-analysis/status/')[-1]
            self.handle_jira_similar_analysis_status(task_id)
            return

        if self.path.startswith('/api/llm/reference-files'):
            self.handle_list_reference_files()
            return

        if self.path.startswith('/api/proxy'):
            self.handle_proxy_request()
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/analysis/context/save'):
            self.handle_save_analysis_context()
            return

        if self.path.startswith('/api/jira/issue-table'):
            self.handle_jira_issue_table()
            return

        if self.path.startswith('/api/jira/similar-issues-analysis/continue'):
            self.handle_jira_similar_issues_continue()
            return

        if self.path.startswith('/api/jira/similar-issues-analysis'):
            self.handle_jira_similar_issues_analysis()
            return

        if self.path.startswith('/api/llm/analyze-jira-problem'):
            self.handle_llm_analyze_jira_problem()
            return

        if self.path.startswith('/api/llm/analyze'):
            self.handle_llm_analyze()
            return

        self.send_error_response(404, '不支持的 POST 接口')

    def handle_proxy_request(self):
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)

            env = params.get('env', [''])[0]
            api_path = params.get('path', [''])[0]

            if not env or not api_path:
                self.send_error_response(400, '缺少 env 或 path 参数')
                return

            base_url = self.get_environment_base_url(env)
            if not base_url:
                self.send_error_response(400, f'不支持的环境: {env}')
                return

            target_url = f"{base_url}{api_path}"
            query_params = {k: v[0] for k, v in params.items() if k not in ['env', 'path']}
            if query_params:
                target_url += '&' + urlencode(query_params) if '?' in api_path else '?' + urlencode(query_params)

            headers = self.collect_forward_headers()
            request = urllib.request.Request(target_url, headers=headers, method='GET')
            context = self.create_ssl_context()

            with urllib.request.urlopen(request, context=context, timeout=30) as response:
                data = response.read()
                self.send_response(response.status)
                self.send_cors_headers()
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as error:
            self.send_error_response(error.code, f'代理请求失败: {error.reason}')
        except Exception as error:
            self.send_error_response(500, f'代理请求异常: {error}')

    def handle_save_analysis_context(self):
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            session_id = self.normalize_analysis_path_part(payload.get('sessionId', ''))
            tab_key = self.normalize_analysis_path_part(payload.get('tabKey', ''))
            if not session_id or not tab_key:
                self.send_error_response(400, '缺少 sessionId 或 tabKey 参数')
                return

            raw_data = payload.get('rawData', None)
            description = str(payload.get('description', '') or '').strip()
            context_root = ANALYSIS_CONTEXT_DIR.resolve()
            session_dir = (ANALYSIS_CONTEXT_DIR / session_id).resolve()
            if context_root not in session_dir.parents and session_dir != context_root:
                self.send_error_response(400, '非法 sessionId')
                return

            self.cleanup_old_analysis_contexts(session_id)
            session_dir.mkdir(parents=True, exist_ok=True)
            file_path = session_dir / f'{tab_key}.json'
            text = raw_data if isinstance(raw_data, str) else json.dumps(raw_data, ensure_ascii=False, indent=2)
            file_path.write_text(text or '', encoding='utf-8')

            manifest_path = session_dir / 'manifest.json'
            manifest = {}
            if manifest_path.exists():
                try:
                    loaded_manifest = json.loads(manifest_path.read_text(encoding='utf-8') or '{}')
                    if isinstance(loaded_manifest, dict):
                        manifest = {
                            str(existing_tab_key): normalize_manifest_entry(existing_tab_key, existing_entry)
                            for existing_tab_key, existing_entry in loaded_manifest.items()
                        }
                except Exception:
                    manifest = {}

            manifest[tab_key] = normalize_manifest_entry(tab_key, {
                'tabKey': tab_key,
                'description': description,
                'fileName': file_path.name,
                'fileRef': to_project_relative_path(file_path),
                'updatedAt': int(time.time() * 1000)
            })
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

            self.send_json_response(200, {
                'success': True,
                'data': {
                    'sessionId': session_id,
                    'tabKey': tab_key,
                    'sessionRef': to_project_relative_path(session_dir),
                    'fileName': file_path.name,
                    'fileRef': to_project_relative_path(file_path),
                    'manifestRef': to_project_relative_path(manifest_path),
                    'guideFileName': AI_ANALYSIS_DATA_GUIDE_PATH.name,
                    'guideRef': to_project_relative_path(AI_ANALYSIS_DATA_GUIDE_PATH)
                }
            })
        except json.JSONDecodeError:
            self.send_error_response(400, '请求体不是合法的 JSON')
        except Exception as error:
            self.send_error_response(500, f'保存分析上下文失败: {error}')

    def normalize_analysis_path_part(self, value):
        normalized = re.sub(r'[^a-zA-Z0-9_-]+', '-', str(value or '').strip())
        return normalized[:80]

    def cleanup_old_analysis_contexts(self, current_session_id):
        context_root = ANALYSIS_CONTEXT_DIR.resolve()
        if not context_root.exists():
            return

        current_session_dir = (ANALYSIS_CONTEXT_DIR / current_session_id).resolve()
        for child in context_root.iterdir():
            resolved_child = child.resolve()
            if resolved_child == current_session_dir:
                continue
            if context_root not in resolved_child.parents:
                continue
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                try:
                    child.unlink()
                except FileNotFoundError:
                    pass

    def handle_jira_issue_table(self):
        try:
            jira_base_url = self.get_jira_base_url()
            if not jira_base_url:
                self.send_error_response(400, 'Jira 代理未启用，请先在运行时配置中注册并启用 Jira 域名')
                return

            jira_cookie = self.get_jira_cookie()
            if not jira_cookie:
                self.send_error_response(400, '缺少 Jira 系统 Cookie')
                return

            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            jql = str(payload.get('jql', '')).strip()
            if not jql:
                self.send_error_response(400, '缺少 jql 参数')
                return

            post_data = {
                'startIndex': str(payload.get('startIndex', '0')),
                'jql': jql,
                'layoutKey': str(payload.get('layoutKey', 'split-view'))
            }
            encoded_body = urllib.parse.urlencode(post_data).encode('utf-8')

            referer = self.build_jira_issue_search_referer(jql)
            headers = self.build_jira_headers(jira_cookie, {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': jira_base_url,
                'Referer': referer
            })

            request = urllib.request.Request(
                f'{jira_base_url}/rest/issueNav/1/issueTable',
                data=encoded_body,
                headers=headers,
                method='POST'
            )
            context = self.create_ssl_context()

            with urllib.request.urlopen(request, context=context, timeout=30) as response:
                data = response.read()
                body_text = self.decode_response_body(data, response.headers.get_content_charset())
                if self.looks_like_jira_login_page(body_text):
                    self.send_error_response(401, 'Jira 请求返回登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试')
                    return
                self.send_response(response.status)
                self.send_cors_headers()
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as error:
            self.handle_jira_http_error(error)
        except Exception as error:
            self.send_error_response(500, f'Jira 列表请求异常: {error}')

    def handle_jira_issue_detail(self):
        try:
            jira_base_url = self.get_jira_base_url()
            if not jira_base_url:
                self.send_error_response(400, 'Jira 代理未启用，请先在运行时配置中注册并启用 Jira 域名')
                return

            jira_cookie = self.get_jira_cookie()
            if not jira_cookie:
                self.send_error_response(400, '缺少 Jira 系统 Cookie')
                return

            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            issue_id = params.get('issueId', [''])[0]
            issue_key = params.get('issueKey', [''])[0]

            if not issue_id:
                self.send_error_response(400, '缺少 issueId 参数')
                return

            timestamp = params.get('_', [''])[0] or str(int(time.time() * 1000))
            query = urlencode({
                'decorator': 'none',
                'issueId': issue_id,
                '_': timestamp
            })
            detail_url = f'{jira_base_url}/secure/AjaxIssueEditAction!default.jspa?{query}'

            referer = self.build_jira_issue_browse_referer(issue_key) if issue_key else self.build_jira_issue_search_referer('')
            headers = self.build_jira_headers(jira_cookie, {
                'Referer': referer
            })

            request = urllib.request.Request(detail_url, headers=headers, method='GET')
            context = self.create_ssl_context()

            with urllib.request.urlopen(request, context=context, timeout=30) as response:
                data = response.read()
                body_text = self.decode_response_body(data, response.headers.get_content_charset())
                if self.looks_like_jira_login_page(body_text):
                    self.send_error_response(401, 'Jira 请求返回登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试')
                    return
                self.send_response(response.status)
                self.send_cors_headers()
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as error:
            self.handle_jira_http_error(error)
        except Exception as error:
            self.send_error_response(500, f'Jira 详情请求异常: {error}')

    def handle_jira_similar_issues_analysis(self):
        """异步调用相似场景工单分析"""
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            issue_key = str(payload.get('issueKey', '') or '').strip()
            current_summary = str(payload.get('currentSummary', '') or '').strip()
            candidates = payload.get('candidates', [])

            if not issue_key:
                self.send_error_response(400, '缺少 issueKey 参数')
                return

            if not current_summary:
                self.send_error_response(400, '缺少 currentSummary 参数')
                return

            if not isinstance(candidates, list):
                self.send_error_response(400, 'candidates 参数格式不正确')
                return

            normalized_candidates = self.normalize_similar_issue_candidates(candidates, issue_key)
            if not normalized_candidates:
                self.send_json_response(200, {
                    'success': True,
                    'data': {
                        'state': 'loaded',
                        'issueKey': issue_key,
                        'matches': [],
                        'analysis': {
                            'candidateCount': 0,
                            'matchedCount': 0,
                            'conclusion': '暂无可分析的候选工单'
                        }
                    }
                })
                return

            # 生成任务ID
            import uuid
            task_id = str(uuid.uuid4())

            # 构建分析任务数据
            task_data = {
                'task_id': task_id,
                'issue_key': issue_key,
                'current_summary': current_summary,
                'candidates': normalized_candidates,
                'batch_size': SIMILAR_ISSUE_BATCH_SIZE,
                'current_batch': 0,
                'total_batches': max(1, (len(normalized_candidates) + SIMILAR_ISSUE_BATCH_SIZE - 1) // SIMILAR_ISSUE_BATCH_SIZE),
                'aggregated_matches': []
            }

            # 立即返回任务ID
            LLM_TASKS[task_id] = {
                'status': 'pending',
                'result': None,
                'error': None,
                'task_type': 'jira_similar',
                'task_data': task_data
            }

            # 启动后台线程执行
            import threading
            thread = threading.Thread(
                target=self._run_jira_similar_task,
                args=(task_id, task_data),
                daemon=True
            )
            thread.start()

            self.send_json_response(200, {
                'success': True,
                'data': {
                    'state': 'processing',
                    'issueKey': issue_key,
                    'taskId': task_id,
                    'analysis': self.build_jira_similar_task_analysis(task_data)
                }
            })

        except json.JSONDecodeError:
            self.send_error_response(400, '请求体不是合法的 JSON')
        except Exception as error:
            self.send_error_response(500, f'相似场景工单分析失败: {error}')

    def _run_jira_similar_task(self, task_id, task_data):
        """后台执行相似工单分析任务"""
        LLM_TASKS[task_id]['status'] = 'running'

        try:
            response_payload = self.run_next_jira_similar_batch(task_data)
            LLM_TASKS[task_id]['status'] = 'completed'
            LLM_TASKS[task_id]['result'] = {
                'success': True,
                'data': response_payload
            }
        except TimeoutError:
            LLM_TASKS[task_id]['status'] = 'failed'
            LLM_TASKS[task_id]['error'] = 'LLM 分析超时'
        except Exception as error:
            LLM_TASKS[task_id]['status'] = 'failed'
            LLM_TASKS[task_id]['error'] = str(error)

    def handle_jira_similar_issues_continue(self):
        """继续分析下一批相似工单"""
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')
            task_id = str(payload.get('taskId', '') or '').strip()

            if not task_id:
                self.send_error_response(400, '缺少 taskId 参数')
                return

            task = LLM_TASKS.get(task_id)
            if not task:
                self.send_error_response(404, '任务不存在或已过期')
                return

            if task.get('task_type') != 'jira_similar':
                self.send_error_response(400, '任务类型不支持继续分析')
                return

            if task.get('status') in ('pending', 'running'):
                self.send_json_response(200, {
                    'success': True,
                    'data': self.build_jira_similar_status_payload(task_id, task, 'processing')
                })
                return

            task_data = task.get('task_data') or {}
            total_batches = int(task_data.get('total_batches') or 0)
            current_batch = int(task_data.get('current_batch') or 0)
            if current_batch >= total_batches:
                task['status'] = 'completed'
                task['result'] = {
                    'success': True,
                    'data': self.build_jira_similar_completion_payload(task_data)
                }
                self.send_json_response(200, {
                    'success': True,
                    'data': task['result']['data']
                })
                return

            task['status'] = 'pending'
            task['result'] = None
            task['error'] = None

            import threading
            thread = threading.Thread(
                target=self._run_jira_similar_task,
                args=(task_id, task_data),
                daemon=True
            )
            thread.start()

            self.send_json_response(200, {
                'success': True,
                'data': self.build_jira_similar_status_payload(task_id, task, 'processing')
            })
        except json.JSONDecodeError:
            self.send_error_response(400, '请求体不是合法的 JSON')
        except Exception as error:
            self.send_error_response(500, f'继续分析相似场景工单失败: {error}')

    def handle_jira_similar_analysis_status(self, task_id):
        """查询相似工单分析任务状态"""
        task = LLM_TASKS.get(task_id)

        if not task:
            self.send_error_response(404, '任务不存在或已过期')
            return

        if task['status'] == 'completed':
            self.send_json_response(200, {
                'success': True,
                'data': task['result']['data']
            })
        elif task['status'] == 'failed':
            self.send_error_response(500, task.get('error', '分析失败'))
        else:
            self.send_json_response(200, {
                'success': True,
                'data': self.build_jira_similar_status_payload(task_id, task, 'processing')
            })

    def run_next_jira_similar_batch(self, task_data):
        issue_key = task_data['issue_key']
        current_summary = task_data['current_summary']
        candidates = task_data['candidates']
        batch_size = max(1, int(task_data.get('batch_size') or SIMILAR_ISSUE_BATCH_SIZE))
        current_batch = int(task_data.get('current_batch') or 0)
        start_index = current_batch * batch_size
        end_index = start_index + batch_size
        batch_candidates = candidates[start_index:end_index]

        if not batch_candidates:
            return self.build_jira_similar_completion_payload(task_data)

        analysis_result = self.invoke_similar_issue_analysis(issue_key, current_summary, batch_candidates)
        batch_response = self.build_similar_issue_analysis_response(
            issue_key,
            batch_candidates,
            analysis_result
        )

        aggregated_matches = self.merge_similar_issue_matches(
            task_data.get('aggregated_matches', []),
            batch_response.get('matches', [])
        )
        task_data['aggregated_matches'] = aggregated_matches
        task_data['current_batch'] = current_batch + 1

        return self.build_jira_similar_completion_payload(task_data)

    def build_jira_similar_status_payload(self, task_id, task, state):
        task_data = task.get('task_data') or {}
        payload = self.build_jira_similar_completion_payload(task_data)
        payload['state'] = state
        payload['taskId'] = task_id
        payload['status'] = task.get('status', state)
        return payload

    def build_jira_similar_completion_payload(self, task_data):
        analysis = self.build_jira_similar_task_analysis(task_data)
        aggregated_matches = task_data.get('aggregated_matches', []) if isinstance(task_data.get('aggregated_matches', []), list) else []
        current_batch = int(task_data.get('current_batch') or 0)
        total_batches = int(task_data.get('total_batches') or 0)
        issue_key = task_data.get('issue_key', '')
        task_id = task_data.get('task_id', '')
        is_complete = current_batch >= total_batches
        payload = {
            'state': 'loaded',
            'issueKey': issue_key,
            'taskId': task_id,
            'matches': aggregated_matches,
            'analysis': analysis
        }
        if is_complete:
            payload['status'] = 'completed'
        return payload

    def build_jira_similar_task_analysis(self, task_data):
        candidates = task_data.get('candidates', []) if isinstance(task_data.get('candidates', []), list) else []
        aggregated_matches = task_data.get('aggregated_matches', []) if isinstance(task_data.get('aggregated_matches', []), list) else []
        current_batch = int(task_data.get('current_batch') or 0)
        total_batches = int(task_data.get('total_batches') or 0)
        batch_size = max(1, int(task_data.get('batch_size') or SIMILAR_ISSUE_BATCH_SIZE))
        analyzed_count = min(current_batch * batch_size, len(candidates))
        has_more = current_batch < total_batches
        conclusion = (
            f'已完成第 {current_batch} / {total_batches} 批分析，累计命中 {len(aggregated_matches)} 条相似工单'
            if has_more
            else (f'找到 {len(aggregated_matches)} 条相似场景工单' if aggregated_matches else '未匹配到相似场景工单')
        )

        return {
            'source': 'llm',
            'candidateCount': len(candidates),
            'matchedCount': len(aggregated_matches),
            'analyzedCount': analyzed_count,
            'batchSize': batch_size,
            'currentBatch': current_batch,
            'totalBatches': total_batches,
            'hasMore': has_more,
            'conclusion': conclusion
        }

    def merge_similar_issue_matches(self, existing_matches, new_matches):
        merged_map = {}
        for item in existing_matches or []:
            if not isinstance(item, dict):
                continue
            issue_key = str(item.get('issueKey', '') or '').strip()
            if issue_key:
                merged_map[issue_key] = item

        for item in new_matches or []:
            if not isinstance(item, dict):
                continue
            issue_key = str(item.get('issueKey', '') or '').strip()
            if not issue_key:
                continue

            existing = merged_map.get(issue_key)
            new_score = self.safe_float(item.get('similarityScore', 0))
            existing_score = self.safe_float(existing.get('similarityScore', 0)) if existing else -1
            if not existing or new_score >= existing_score:
                merged_map[issue_key] = item

        merged_matches = list(merged_map.values())
        merged_matches.sort(key=lambda item: self.safe_float(item.get('similarityScore', 0)), reverse=True)
        return merged_matches

    def safe_float(self, value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def handle_llm_analyze_jira_problem(self):
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            problem_description = str(payload.get('problemDescription', '') or '').strip()
            if not problem_description:
                self.send_error_response(400, '缺少 problemDescription 参数')
                return

            full_prompt = self.build_jira_problem_analysis_prompt(payload)
            task_id = self.submit_llm_task(full_prompt)

            self.send_json_response(200, {
                'code': 202,
                'message': '任务已提交，正在处理中',
                'data': {
                    'taskId': task_id,
                    'status': 'pending'
                }
            })

        except json.JSONDecodeError:
            self.send_error_response(400, '请求体不是合法的 JSON')
        except Exception as error:
            self.send_error_response(500, f'Jira 问题分析失败: {error}')

    def _run_llm_task(self, task_id, prompt):
        """后台执行 LLM 任务"""
        LLM_TASKS[task_id]['status'] = 'running'

        try:
            result = self.invoke_openclaw_agent(prompt)
            LLM_TASKS[task_id]['status'] = 'completed'
            LLM_TASKS[task_id]['result'] = result
        except TimeoutError:
            LLM_TASKS[task_id]['status'] = 'failed'
            LLM_TASKS[task_id]['error'] = 'LLM 分析超时'
        except Exception as error:
            LLM_TASKS[task_id]['status'] = 'failed'
            LLM_TASKS[task_id]['error'] = str(error)

    def handle_llm_analyze(self):
        """异步调用大模型进行数据分析"""
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            prompt = str(payload.get('prompt', '') or '').strip()
            data = payload.get('data', {})
            analysis_type = payload.get('analysisType', 'overview')

            if not prompt:
                self.send_error_response(400, '缺少 prompt 参数')
                return

            # 根据分析类型构建优化后的prompt
            full_prompt = self.build_analysis_prompt(prompt, data, analysis_type)
            task_id = self.submit_llm_task(full_prompt)

            self.send_json_response(200, {
                'code': 202,
                'message': '任务已提交，正在处理中',
                'data': {
                    'taskId': task_id,
                    'status': 'pending'
                }
            })

        except json.JSONDecodeError:
            self.send_error_response(400, '请求体不是合法的 JSON')
        except Exception as error:
            self.send_error_response(500, f'LLM 分析失败: {error}')

    def submit_llm_task(self, full_prompt):
        import threading
        import uuid

        task_id = str(uuid.uuid4())
        LLM_TASKS[task_id] = {
            'status': 'pending',
            'result': None,
            'error': None,
            'prompt': full_prompt
        }

        thread = threading.Thread(
            target=self._run_llm_task,
            args=(task_id, full_prompt),
            daemon=True
        )
        thread.start()
        return task_id

    def build_jira_problem_analysis_prompt(self, payload):
        analysis_type = str(payload.get('analysisType', '') or '').strip()
        tab_status = payload.get('tabStatus', {})
        analysis_context = payload.get('analysisContext', {})
        raw_params = payload.get('params', {})
        params = raw_params if isinstance(raw_params, dict) else {}
        is_reference_only_analysis = analysis_type == 'diagnosis'

        if is_reference_only_analysis:
            instruction = (
                '你是一名表单场景分析专家。'
                '当前分析类型为场景分析，请忽略业务数据、临时文件中的各页签 JSON、以及任何单据/审批/日志上下文。'
                '你只需要根据用户的问题描述，并结合 references 参考文件结构、命中的参考文档分片和相关说明文档，进行场景匹配、功能说明和方案建议。'
                '不要要求调用方补充业务数据，也不要把业务数据作为判断依据。'
                '如果参考文件中没有足够证据，要明确指出缺失的参考依据。'
                '输出请使用中文，并严格按以下结构输出：'
                '1. 场景理解'
                '2. 参考依据'
                '3. 功能使用建议'
                '4. 配置或操作方案'
                '5. 最终结论'
            )
        else:
            instruction = (
                '角色：Jira / IForm 问题分析工程师。'
                '任务：根据问题描述与 IForm 单据、审批、日志、字段说明，完成问题定位。'
                '数据读取规则：'
                '- 首选：analysisBundleInline。'
                '- 次选：analysisContext.bundleRef.fileRef 的 analysisBundle.json。'
                '- 兜底：仅当 bundle 证据不足时，读取 compactSnapshotRef、fallbackFiles 或 files。'
                '- 路径：所有相对 fileRef/guideRef 均以 iform-ai 技能根目录解析。'
                '- 禁止：写死绝对路径；改到 workspace、references/assets 下探测；要求调用方重复粘贴 JSON。'
                '- \u9ed8\u8ba4\u4e0d\u8bfb references\uff1b\u4ec5\u5f53\u4e1a\u52a1\u8bc1\u636e\u4e0d\u8db3\u4ee5\u89e3\u91ca\u673a\u5236\u6216\u7ed9\u51fa\u65b9\u6848\u65f6\uff0c\u624d\u6309 referenceFallbackPolicy \u5148\u8bfb QUICK_INDEX.md\uff0c\u518d\u547d\u4e2d\u6700\u591a 1~2 \u7bc7\u6587\u6863\u3002'
                '- \u7981\u6b62\u626b\u63cf\u5168\u90e8 references \u6216\u8bfb\u53d6\u8fb9\u7f18\u76f8\u5173\u6587\u6863\u3002'
                '证据规则：'
                '- 优先使用 bundle 中 evidencePack、compactSnapshot。'
                '- 只基于已有字段、日志、权限、流程证据下结论。'
                '- 不臆造字段、操作人、状态或系统机制。'
                '- 证据不足时，列出缺失数据和待确认项。'
                '输出要求：'
                '- 中文。'
                '- 短、准。'
                '- 每部分最多 4 条，关键证据部分可扩充。'
                '- 严格按结构输出：'
                '1. 问题理解'
                '2. 问题定位'
                '3. 参考文档'
                '4. 解决方案'
                '5. 最终结论'
            )

        minimal_params = {} if is_reference_only_analysis else {
            'environment': params.get('environment', ''),
            'pkBo': params.get('pkBo', ''),
            'pkBoins': params.get('pkBoins', ''),
            'jiraIssueKey': params.get('jiraIssueKey', '')
        }
        minimal_analysis_context = {
            'sessionId': analysis_context.get('sessionId', ''),
            'guideFileName': analysis_context.get('guideFileName', ''),
            'guideRef': analysis_context.get('guideRef', ''),
            'bundleRef': {} if is_reference_only_analysis else analysis_context.get('bundleRef', {}),
            'compactSnapshotRef': {} if is_reference_only_analysis else analysis_context.get('compactSnapshotRef', {}),
            'fallbackFiles': [] if is_reference_only_analysis else analysis_context.get('fallbackFiles', analysis_context.get('files', [])),
            'files': [] if is_reference_only_analysis else analysis_context.get('files', []),
            'referenceFallbackPolicy': {} if is_reference_only_analysis else analysis_context.get('referenceFallbackPolicy', {}),
            'instruction': analysis_context.get('instruction', '')
        }

        prompt_payload = {
            'problemDescription': payload.get('problemDescription', ''),
            'analysisType': analysis_type,
            'analysisTypeName': payload.get('analysisTypeName', ''),
            'params': minimal_params,
            'tabStatus': {} if is_reference_only_analysis else tab_status,
            'analysisContext': minimal_analysis_context
        }

        if not is_reference_only_analysis and isinstance(payload.get('analysisBundleInline'), dict):
            prompt_payload['analysisBundleInline'] = payload.get('analysisBundleInline')

        # 兼容旧前端：正常情况下上下文已通过 analysisBundleInline/bundleRef 或 compactSnapshotRef 提供；
        # 只有保存失败或旧版本前端仍内联 compactSnapshot 时，才透传到 prompt。
        if (
            not is_reference_only_analysis
            and not prompt_payload.get('analysisBundleInline')
            and not minimal_analysis_context.get('bundleRef')
            and not minimal_analysis_context.get('compactSnapshotRef')
            and isinstance(payload.get('compactSnapshot'), dict)
        ):
            prompt_payload['compactSnapshot'] = payload.get('compactSnapshot')

        return (
            f"{instruction}\n\n"
            "以下是最小分析上下文，请先基于文件引用和说明文档按需读取，再完成问题分析：\n"
            f"{json.dumps(prompt_payload, ensure_ascii=False, indent=2)}"
        )

    def build_ai_tab_explanations(self):
        return {
            'formConfig': [
                'formConfig 用于描述表单模板定义、主表字段、子表字段、布局结构、必填/可见性配置。',
                '若字段配置与单据表现不一致，应优先检查这里的组件定义、字段标识、布局层级和权限配置。'
            ],
            'document': [
                'document 用于描述当前单据实例的实际业务数据，包含主表、子表、流程标识和字段值。',
                '若页面展示异常、字段缺失、流程参数无法衔接，应重点检查 document 中的真实值和流程标识。'
            ],
            'approval': [
                'approval 用于描述流程审批实例、节点、处理人、意见、完成状态和时间线。',
                '若问题与审批未触发、审批流转异常、节点停滞有关，应重点分析 approval 数据。'
            ],
            'businessLog': [
                'businessLog 用于描述业务日志、模块、操作、耗时和异常链路。',
                '若问题与接口报错、调用超时、链路失败有关，应重点分析 businessLog。'
            ],
            'jiraAnalysis': [
                'jiraAnalysis 用于描述当前 Jira 工单基础信息、工单详细内容、近期工单和相似场景分析。',
                '若 currentIssueDetail 中存在“概要”字段，应将其视为当前 Jira 问题摘要；若不存在，则回退到标题/summary。'
            ]
        }

    def load_ai_reference_documents(self):
        documents = []
        for path in AI_REFERENCE_FILES:
            if not path.exists():
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except Exception as error:
                documents.append({
                    'name': path.name,
                    'error': f'读取失败: {error}'
                })
                continue

            documents.append({
                'name': path.name,
                'content': self.truncate_text(text, 12000)
            })

        return documents

    def _safe_reference_mtime(self, path):
        try:
            return int(path.stat().st_mtime)
        except Exception:
            return 0

    def _extract_reference_keywords(self, value):
        text = str(value or '').strip().lower()
        if not text:
            return []

        text = text.replace('\\', '/')
        tokens = []
        for part in re.split(r'[/\s._\-()（）【】\[\],，;；:：]+', text):
            token = part.strip()
            if len(token) < 2:
                continue
            tokens.append(token)

        seen = set()
        ordered = []
        for token in tokens:
            if token not in seen:
                seen.add(token)
                ordered.append(token)
        return ordered

    def _collect_skill_reference_files(self):
        files = []
        for root in get_candidate_reference_roots():
            if not root.exists():
                continue
            for path in root.glob('**/*.md'):
                if path.is_file():
                    files.append((root, path.resolve()))

        return sorted(
            files,
            key=lambda item: (
                0 if item[0] == PRIMARY_SKILL_REFERENCES_PATH.resolve() else 1,
                str(item[1].relative_to(item[0])).lower()
            )
        )

    def get_reference_index(self):
        files = self._collect_skill_reference_files()
        signature = tuple(
            (
                str(root),
                str(path.relative_to(root)),
                self._safe_reference_mtime(path),
                path.stat().st_size
            )
            for root, path in files
        )
        cached = REFERENCE_INDEX_CACHE
        if cached['signature'] == signature and cached['data'] is not None:
            return cached['data']

        entries = []
        category_counts = {}

        for root, path in files:
            rel_path = str(path.relative_to(root)).replace('\\', '/')
            parts = list(path.relative_to(root).parts)
            keywords = []
            for part in parts:
                keywords.extend(self._extract_reference_keywords(Path(part).stem))
                if Path(part).suffix:
                    keywords.extend(self._extract_reference_keywords(Path(part).suffix.lstrip('.')))

            unique_keywords = []
            seen_keywords = set()
            for keyword in keywords:
                if keyword not in seen_keywords:
                    seen_keywords.add(keyword)
                    unique_keywords.append(keyword)

            top_level = parts[0] if parts else 'root'
            category_counts[top_level] = category_counts.get(top_level, 0) + 1

            entries.append({
                'name': path.name,
                'path': str(path),
                'relativePath': rel_path,
                'root': str(root),
                'source': 'execution-skill' if root == PRIMARY_SKILL_REFERENCES_PATH.resolve() else 'yonclaw-runtime',
                'size': path.stat().st_size,
                'topLevel': top_level,
                'keywords': unique_keywords,
                'mtime': self._safe_reference_mtime(path)
            })

        data = {
            'root': str(PRIMARY_SKILL_REFERENCES_PATH.resolve()),
            'roots': [str(root) for root in get_candidate_reference_roots()],
            'entries': entries,
            'categoryCounts': category_counts,
            'signature': signature
        }
        REFERENCE_INDEX_CACHE['signature'] = signature
        REFERENCE_INDEX_CACHE['data'] = data
        return data

    def score_reference_entry(self, entry, query_keywords):
        if not query_keywords:
            return 0

        haystack = ' '.join([
            str(entry.get('relativePath', '')).lower(),
            ' '.join(entry.get('keywords', []))
        ])
        score = 0
        for keyword in query_keywords:
            if keyword == entry.get('topLevel', '').lower():
                score += 6
            elif f'/{keyword}/' in f"/{entry.get('relativePath', '').lower()}/":
                score += 5
            elif keyword in haystack:
                score += 3
        return score

    def select_reference_entries(self, query_text='', requested_files=None, limit=REFERENCE_AUTO_SELECT_LIMIT):
        index = self.get_reference_index()
        entries = index.get('entries', [])
        requested_files = requested_files if isinstance(requested_files, list) else []
        selected = []
        selected_paths = set()

        for item in requested_files:
            path = self.resolve_reference_file_path(item)
            if not path:
                continue
            resolved = str(path.resolve())
            if resolved in selected_paths:
                continue
            entry = next((candidate for candidate in entries if candidate.get('path') == resolved), None)
            if entry:
                selected.append(entry)
                selected_paths.add(resolved)

        query_keywords = self._extract_reference_keywords(query_text)
        scored = []
        for entry in entries:
            resolved = entry.get('path')
            if resolved in selected_paths:
                continue
            score = self.score_reference_entry(entry, query_keywords)
            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda item: (-item[0], len(item[1].get('relativePath', '')), item[1].get('relativePath', '')))
        for _, entry in scored:
            if len(selected) >= limit:
                break
            selected.append(entry)
            selected_paths.add(entry.get('path'))

        return selected

    def get_reference_file_chunks(self, path):
        resolved = path.resolve()
        cache_key = str(resolved)
        mtime = self._safe_reference_mtime(resolved)
        cached = REFERENCE_CONTENT_CACHE.get(cache_key)
        if cached and cached.get('mtime') == mtime:
            return cached.get('chunks', [])

        text = resolved.read_text(encoding='utf-8')
        segments = re.split(r'\n\s*\n', text)
        chunks = []
        current = []
        current_size = 0

        for segment in segments:
            block = segment.strip()
            if not block:
                continue
            block_size = len(block) + 2
            if current and current_size + block_size > REFERENCE_FILE_CHUNK_SIZE:
                chunks.append('\n\n'.join(current))
                current = []
                current_size = 0
            current.append(block)
            current_size += block_size

        if current:
            chunks.append('\n\n'.join(current))

        if not chunks and text.strip():
            chunks = [self.truncate_text(text.strip(), REFERENCE_FILE_CHUNK_SIZE)]

        REFERENCE_CONTENT_CACHE[cache_key] = {
            'mtime': mtime,
            'chunks': chunks
        }
        return chunks

    def load_reference_content_by_entries(self, entries, query_text=''):
        contents = []
        query_keywords = self._extract_reference_keywords(query_text)

        for entry in entries:
            path = Path(entry.get('path', ''))
            if not path.exists():
                continue

            try:
                chunks = self.get_reference_file_chunks(path)
            except Exception as error:
                contents.append(f"[{entry.get('relativePath')}]\n读取失败: {error}")
                continue

            scored_chunks = []
            for index, chunk in enumerate(chunks):
                score = 0
                lowered_chunk = chunk.lower()
                for keyword in query_keywords:
                    if keyword in lowered_chunk:
                        score += 2
                if index == 0:
                    score += 1
                scored_chunks.append((score, index, chunk))

            scored_chunks.sort(key=lambda item: (-item[0], item[1]))
            selected_chunks = scored_chunks[:REFERENCE_FILE_MAX_CHUNKS]
            selected_chunks.sort(key=lambda item: item[1])

            chunk_texts = []
            for _, index, chunk in selected_chunks:
                chunk_texts.append(f"--- 分片 {index + 1}/{len(chunks)} ---\n{self.truncate_text(chunk, REFERENCE_FILE_CHUNK_SIZE)}")

            contents.append(f"[{entry.get('relativePath')}]\n" + '\n\n'.join(chunk_texts))

        return '\n\n'.join(contents)

    def is_minimal_data_analysis_reference_file(self, file_name):
        return str(file_name or '').strip() in AI_ANALYSIS_MINIMAL_REFERENCE_NAMES

    def build_data_analysis_reference_policy(self, analysis_context=None, reference_files=None):
        analysis_context = analysis_context if isinstance(analysis_context, dict) else {}
        files = analysis_context.get('files', [])
        files = files if isinstance(files, list) else []
        requested = reference_files if isinstance(reference_files, list) else []

        normalized_requested = []
        for item in requested:
            if isinstance(item, dict):
                normalized_requested.append(item)
            elif isinstance(item, str):
                normalized_requested.append({'name': item})

        minimal_requested = []
        for item in normalized_requested:
            raw_name = str(item.get('name', '') or '').strip()
            if self.is_minimal_data_analysis_reference_file(raw_name):
                minimal_requested.append(item)

        minimal_context_files = []
        for item in files:
            if not isinstance(item, dict):
                continue
            raw_name = str(item.get('name', '') or '').strip()
            if self.is_minimal_data_analysis_reference_file(raw_name):
                minimal_context_files.append(item)

        guide_ref = str(analysis_context.get('guideRef', '') or '').strip()
        enable_full_index = False
        instruction_text = str(analysis_context.get('instruction', '') or '')
        question_text = str(analysis_context.get('problemDescription', '') or '')
        full_text = f"{instruction_text}\n{question_text}".lower()
        if '知识库文档' in full_text or 'references 索引' in full_text or 'reference index' in full_text:
            enable_full_index = True

        selected_reference_files = minimal_requested if minimal_requested else minimal_context_files
        if guide_ref and not any(str(item.get('name', '') or '').strip() == AI_ANALYSIS_DATA_GUIDE_PATH.name for item in selected_reference_files if isinstance(item, dict)):
            selected_reference_files = [{'name': AI_ANALYSIS_DATA_GUIDE_PATH.name}] + selected_reference_files

        return {
            'enable_full_index': enable_full_index,
            'selected_reference_files': selected_reference_files,
            'guide_ref': guide_ref
        }

    def build_reference_index_guide(self, selected_entries=None, query_text=''):
        index = self.get_reference_index()
        entries = index.get('entries', [])
        if not entries:
            return ''

        selected_entries = selected_entries or []
        selected_paths = {entry.get('relativePath') for entry in selected_entries}
        preview_entries = entries[:REFERENCE_INDEX_PREVIEW_LIMIT]
        preview_lines = []
        for entry in preview_entries:
            marker = ' *' if entry.get('relativePath') in selected_paths else ''
            preview_lines.append(f"- {entry.get('relativePath')}{marker}")
        if len(entries) > REFERENCE_INDEX_PREVIEW_LIMIT:
            preview_lines.append(f"- ... 其余 {len(entries) - REFERENCE_INDEX_PREVIEW_LIMIT} 个文档按目录层级索引管理")

        category_lines = []
        for category, count in sorted(index.get('categoryCounts', {}).items()):
            category_lines.append(f"- {category}: {count} 个")

        query_hint = f"\n当前问题关键词：{', '.join(self._extract_reference_keywords(query_text)[:12])}" if query_text else ''
        return (
            "【参考资料索引】\n"
            f"当前执行 skill 根目录：{PROJECT_ROOT}\n"
            f"优先 references 根目录：{index.get('root')}\n"
            "按目录层级组织关键词入口，优先根据目录名、子目录名、文件名定位资料，不要一次性扫描全部文档。\n"
            "使用策略：先看索引，再按关键词命中文件，再按分片读取命中片段，优先复用已加载结果。\n"
            f"{query_hint}\n"
            "分类概览：\n"
            f"{chr(10).join(category_lines)}\n"
            "索引预览：\n"
            f"{chr(10).join(preview_lines)}"
        )

    def load_selected_reference_files(self, reference_files):
        items = reference_files if isinstance(reference_files, list) else []
        entries = self.select_reference_entries('', items, limit=max(len(items), REFERENCE_AUTO_SELECT_LIMIT))
        return self.load_reference_content_by_entries(entries)

    def resolve_reference_file_path(self, item):
        raw_path = ''
        raw_name = ''

        if isinstance(item, dict):
            raw_path = str(item.get('path', '') or '').strip()
            raw_name = str(item.get('name', '') or '').strip()
        elif isinstance(item, str):
            raw_name = item.strip()

        if raw_path:
            candidate = Path(raw_path).expanduser()
            try:
                resolved = candidate.resolve()
            except Exception:
                return None
            if self.is_allowed_reference_path(resolved):
                return resolved

        if raw_name:
            for candidate in AI_REFERENCE_FILES:
                if candidate.name == raw_name and candidate.exists():
                    return candidate

            for skill_root in get_candidate_reference_roots():
                try:
                    resolved = (skill_root / raw_name).resolve()
                except Exception:
                    continue
                if self.is_allowed_reference_path(resolved) and resolved.exists():
                    return resolved

        return None

    def is_allowed_reference_path(self, path):
        try:
            resolved = Path(path).resolve()
        except Exception:
            return False

        allowed_roots = [DIRECTORY.resolve()]
        allowed_roots.extend(get_candidate_reference_roots())

        for root in allowed_roots:
            if resolved == root or root in resolved.parents:
                return True

        return False

    def handle_list_reference_files(self):
        """列出可用的参考文件"""
        reference_index = self.get_reference_index()
        skill_files = []
        for entry in reference_index.get('entries', []):
            skill_files.append({
                'name': entry.get('relativePath'),
                'path': entry.get('path'),
                'root': entry.get('root'),
                'source': entry.get('source'),
                'size': entry.get('size'),
                'topLevel': entry.get('topLevel'),
                'keywords': entry.get('keywords', [])
            })

        # 获取 assets 目录下的文件
        asset_files = []
        for f in AI_REFERENCE_FILES:
            if f.exists():
                asset_files.append({
                    'name': f.name,
                    'path': str(f),
                    'size': f.stat().st_size
                })

        self.send_json_response(200, {
            'code': 200,
            'data': {
                'root': reference_index.get('root'),
                'categoryCounts': reference_index.get('categoryCounts', {}),
                'skillReferences': skill_files,
                'assetReferences': asset_files
            }
        })

    def truncate_text(self, text, limit):
        if not isinstance(text, str):
            return text
        if len(text) <= limit:
            return text
        return text[:limit] + '\n...[truncated]'

    def handle_llm_analyze_status(self, task_id):
        """查询 LLM 分析任务状态"""
        task = LLM_TASKS.get(task_id)

        if not task:
            self.send_error_response(404, '任务不存在或已过期')
            return

        self.send_json_response(200, {
            'code': 200,
            'message': 'success',
            'data': {
                'taskId': task_id,
                'status': task['status'],
                'result': task.get('result'),
                'error': task.get('error')
            }
        })

    def handle_llm_analyze_result(self, task_id):
        """获取 LLM 分析任务结果"""
        task = LLM_TASKS.get(task_id)

        if not task:
            self.send_error_response(404, '任务不存在或已过期')
            return

        if task['status'] == 'pending' or task['status'] == 'running':
            self.send_json_response(200, {
                'code': 200,
                'message': '任务处理中',
                'data': {
                    'taskId': task_id,
                    'status': task['status']
                }
            })
        elif task['status'] == 'completed':
            self.send_json_response(200, {
                'code': 200,
                'message': 'success',
                'data': {
                    'taskId': task_id,
                    'status': 'completed',
                    'result': task['result']
                }
            })
        else:  # failed
            self.send_error_response(500, task.get('error', '任务执行失败'))

    def invoke_openclaw_agent(self, prompt_text):
        """调用 YonClaw 大模型"""
        gateway_config = RUNTIME_CONFIG.get('yonclaw', {})
        gateway_url = gateway_config.get('gatewayUrl', '').strip()
        gateway_token = gateway_config.get('gatewayToken', '').strip()
        model = gateway_config.get('model', 'openclaw/main').strip()

        # 注入参考文档扫描指导
        prompt_with_guide = self.inject_reference_guide(prompt_text)

        # 优先通过 openclaw CLI 调用当前 YonClaw agent，避免依赖可能不存在的 /v1/chat/completions。
        cli_result = self.invoke_openclaw_agent_via_cli(prompt_with_guide, model)
        if cli_result:
            return cli_result

        if not gateway_url or not gateway_token:
            raise RuntimeError('Gateway URL 或 Token 未配置，且 openclaw CLI 不可用')

        return self.invoke_openclaw_agent_via_gateway(prompt_with_guide, gateway_url, gateway_token, model)

    def inject_reference_guide(self, prompt_text):
        """Append reference index only when needed; overview data analysis should not be guided to references by default."""
        if self.should_skip_reference_guide(prompt_text):
            return prompt_text

        guide = self.build_reference_index_guide()
        if not guide:
            return prompt_text
        return f"{prompt_text}\n\n{guide}"

    def should_skip_reference_guide(self, prompt_text):
        """Skip global references index for compact evidence-bundle analysis prompts."""
        normalized = str(prompt_text or '').lower()
        if '"analysistype": "overview"' in normalized:
            return True
        if '"analysistype": "jira"' in normalized and '"analysisbundleinline"' in normalized:
            return True
        if 'references' in normalized and '"analysisbundleinline"' in normalized and 'bundle' in normalized:
            return True
        return False

    # ========== AI 分析相关函数 ==========
    def build_analysis_prompt(self, base_prompt, data, analysis_type):
        """根据分析类型构建优化后的prompt"""
        params = data.get('params', {})
        form_config = data.get('formConfig', {})
        document = data.get('document', {})
        approval = data.get('approval', {})
        business_log = data.get('businessLog', {})
        jira = data.get('jira', None)
        problem_desc = data.get('problemDescription', '')
        reference_files = data.get('referenceFiles', [])
        analysis_context = data.get('analysisContext', {}) if isinstance(data.get('analysisContext', {}), dict) else {}

        selected_entries = []
        ref_index_guide = ''
        ref_content = ''

        if analysis_type == 'overview':
            policy = self.build_data_analysis_reference_policy(analysis_context, reference_files)
            selected_entries = self.select_reference_entries(problem_desc, policy.get('selected_reference_files', []))
            if policy.get('enable_full_index'):
                ref_index_guide = self.build_reference_index_guide(selected_entries, problem_desc)
            ref_content = self.load_reference_content_by_entries(selected_entries, problem_desc)
        else:
            selected_entries = self.select_reference_entries(problem_desc, reference_files)
            ref_index_guide = self.build_reference_index_guide(selected_entries, problem_desc)
            ref_content = self.load_reference_content_by_entries(selected_entries, problem_desc)

        if analysis_type == 'diagnosis':
            return self._build_diagnosis_prompt(base_prompt, params, document, approval, business_log, problem_desc, ref_index_guide, ref_content)
        elif analysis_type == 'optimization':
            return self._build_optimization_prompt(base_prompt, approval, business_log, problem_desc, ref_index_guide, ref_content)
        elif analysis_type == 'jira':
            return self._build_jira_prompt(base_prompt, document, approval, jira, problem_desc, ref_index_guide, ref_content)
        else:
            return self._build_overview_prompt(base_prompt, params, form_config, document, approval, business_log, problem_desc, ref_index_guide, ref_content)

    def _build_overview_prompt(self, base, params, form_config, document, approval, business_log, problem_desc, ref_index_guide, ref_content):
        user_desc = f"\n\n【用户问题】\n{problem_desc}" if problem_desc else ""
        ref_index_section = f"\n\n{ref_index_guide}" if ref_index_guide else ""
        ref_section = f"\n\n【按需加载的参考文档分片】\n{ref_content}" if ref_content else ""
        return f"""{base}{user_desc}{ref_index_section}{ref_section}

【参数信息】
{json.dumps(params, ensure_ascii=False, indent=2)}

【表单配置】
{json.dumps(form_config, ensure_ascii=False, indent=2)}

【单据数据】
{json.dumps(document, ensure_ascii=False, indent=2)}

【审批信息】
{json.dumps(approval, ensure_ascii=False, indent=2)}

【业务日志】
{json.dumps(business_log, ensure_ascii=False, indent=2)}"""

    def _build_diagnosis_prompt(self, base, params, document, approval, business_log, problem_desc, ref_index_guide, ref_content):
        ref_index_section = f"\n\n{ref_index_guide}" if ref_index_guide else ""
        ref_section = f"\n\n【按需加载的参考文档分片】\n{ref_content}" if ref_content else ""
        return f"""{base}

{ref_index_section}{ref_section}

【参数】{params.get('pkBo', 'N/A')} 
【单据数据】{json.dumps(document, ensure_ascii=False, indent=2)}
【审批信息】{json.dumps(approval, ensure_ascii=False, indent=2)}
【业务日志】{json.dumps(business_log, ensure_ascii=False, indent=2)}

【用户问题】{problem_desc}

请先确认数据是否正常加载，然后进行问题诊断。"""

    def _build_optimization_prompt(self, base, approval, business_log, problem_desc, ref_index_guide, ref_content):
        user_desc = f"\n【用户需求】{problem_desc}" if problem_desc else ""
        ref_index_section = f"\n\n{ref_index_guide}" if ref_index_guide else ""
        ref_section = f"\n\n【按需加载的参考文档分片】\n{ref_content}" if ref_content else ""
        return f"""{base}{user_desc}{ref_index_section}{ref_section}

【审批流程】
{json.dumps(approval, ensure_ascii=False, indent=2)}

【业务日志】
{json.dumps(business_log, ensure_ascii=False, indent=2)}

请分析审批流程效率并给出优化建议。"""

    def _build_jira_prompt(self, base, document, approval, jira_data, problem_desc, ref_index_guide, ref_content):
        jira_info = ""
        if jira_data:
            current = jira_data.get('currentIssue', {})
            matches = jira_data.get('matches', [])
            jira_info = f"当前工单: {current.get('summary', 'N/A')}\n相似工单: {len(matches)}个"
        user_desc = f"\n【用户问题】{problem_desc}" if problem_desc else ""
        ref_index_section = f"\n\n{ref_index_guide}" if ref_index_guide else ""
        ref_section = f"\n\n【按需加载的参考文档分片】\n{ref_content}" if ref_content else ""
        return f"""{base}{user_desc}{ref_index_section}{ref_section}

【单据数据】
{json.dumps(document, ensure_ascii=False, indent=2)}

【审批信息】
{json.dumps(approval, ensure_ascii=False, indent=2)}

【Jira工单】
{jira_info}

请结合业务数据和Jira工单进行分析。"""

    def resolve_openclaw_cli(self):
        """可移植地发现 openclaw CLI。

        技能包会安装到不同机器，不能写死 YonClaw 安装目录。这里优先尊重显式环境变量，
        然后扫描 PATH 中所有 openclaw/openclaw.cmd，选择版本号最高的可执行文件，避免旧版本 CLI
        因不认识新配置字段而导致智能分析失败。
        """
        env_candidates = [
            os.environ.get('YONCLAW_OPENCLAW_CLI'),
            os.environ.get('OPENCLAW_CLI')
        ]

        candidates = []
        for candidate in env_candidates:
            if candidate:
                candidates.append(candidate)

        candidates.extend(self.find_openclaw_cli_candidates_from_path())

        resolved = []
        seen = set()
        for candidate in candidates:
            normalized = os.path.normpath(str(candidate or '').strip().strip('"'))
            if not normalized:
                continue
            key = os.path.normcase(normalized)
            if key in seen or not os.path.exists(normalized):
                continue
            seen.add(key)
            resolved.append(normalized)

        if not resolved:
            return None

        scored = []
        for index, candidate in enumerate(resolved):
            version = self.get_openclaw_cli_version(candidate)
            scored.append((self.parse_version_tuple(version), 0 if candidate in env_candidates else 1, index, candidate))

        # 版本号越高越优先；显式环境变量在同版本时优先；最后保持发现顺序稳定。
        scored.sort(key=lambda item: (item[0], -item[1], -item[2]), reverse=True)
        return scored[0][3]

    def find_openclaw_cli_candidates_from_path(self):
        """枚举 PATH 中所有可能的 openclaw CLI，而不是只取 shutil.which 的第一个命中。"""
        names = ['openclaw.cmd', 'openclaw.exe', 'openclaw']
        candidates = []
        for path_dir in os.environ.get('PATH', '').split(os.pathsep):
            path_dir = path_dir.strip().strip('"')
            if not path_dir:
                continue
            for name in names:
                candidate = os.path.join(path_dir, name)
                if os.path.exists(candidate):
                    candidates.append(candidate)
        return candidates

    def get_openclaw_cli_version(self, openclaw_bin):
        """读取 openclaw CLI 版本；读取失败时返回空字符串，后续按最低版本处理。"""
        try:
            completed = subprocess.run(
                [openclaw_bin, '--version'],
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15,
                check=False
            )
            output = f"{completed.stdout or ''}\n{completed.stderr or ''}"
            match = re.search(r'OpenClaw\s+(\d+(?:\.\d+){0,3})', output)
            return match.group(1) if match else ''
        except Exception:
            return ''

    def parse_version_tuple(self, version):
        """将 2026.3.24 这类版本转成可排序元组。"""
        parts = []
        for item in str(version or '').split('.'):
            try:
                parts.append(int(item))
            except ValueError:
                parts.append(0)
        while len(parts) < 4:
            parts.append(0)
        return tuple(parts[:4])

    def invoke_openclaw_agent_via_cli(self, prompt_text, model):
        """通过 openclaw CLI 调用当前 YonClaw agent，作为 /v1/chat/completions 不可用时的稳定兜底。"""
        openclaw_bin = self.resolve_openclaw_cli()
        if not openclaw_bin:
            return None

        command = [
            openclaw_bin,
            'agent',
            '--agent',
            'main',
            '--message',
            prompt_text,
            '--json',
            '--timeout',
            '600'
        ]

        if model and model not in ('openclaw/main', 'main'):
            command.extend(['--model', model])

        try:
            completed = subprocess.run(
                command,
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=620,
                check=False
            )
        except subprocess.TimeoutExpired:
            raise TimeoutError('openclaw CLI 调用超时')
        except Exception:
            return None

        stdout = (completed.stdout or '').strip()
        stderr = (completed.stderr or '').strip()
        if completed.returncode != 0:
            # CLI 自身不可用（例如 PATH 旧版本读不懂新配置）时，不要中断分析；交给 Gateway HTTP 兜底。
            print(f'⚠️ openclaw CLI 调用失败，将回退 Gateway: {self.truncate_text(stderr or stdout or str(completed.returncode), 500)}')
            return None

        result = self.extract_json_object_from_text(stdout)
        if not isinstance(result, dict):
            raise RuntimeError(f'openclaw CLI 未返回合法 JSON: {self.truncate_text(stdout or stderr, 500)}')

        content = self.extract_content_from_openclaw_cli_response(result)
        if content:
            return {'content': content}

        raise RuntimeError(f'openclaw CLI 返回中未找到文本内容: {self.truncate_text(stdout, 500)}')

    def extract_json_object_from_text(self, text):
        """openclaw CLI 可能在 JSON 前后输出插件日志，这里从文本中截取第一个完整 JSON 对象。"""
        raw = str(text or '').strip()
        if not raw:
            return None

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        start = raw.find('{')
        if start < 0:
            return None

        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(raw)):
            char = raw[index]
            if in_string:
                if escape:
                    escape = False
                elif char == '\\':
                    escape = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    candidate = raw[start:index + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        return None

        return None

    def extract_content_from_openclaw_cli_response(self, result):
        """提取 openclaw agent --json 的回复文本。"""
        try:
            payloads = result.get('result', {}).get('payloads', [])
            if isinstance(payloads, list):
                texts = []
                for payload in payloads:
                    if isinstance(payload, dict):
                        text = payload.get('text')
                        if isinstance(text, str) and text.strip():
                            texts.append(text.strip())
                if texts:
                    return '\n\n'.join(texts)
        except Exception:
            pass

        return self.extract_content_from_gateway_response(result) or self.extract_content_from_openai_response(result)

    def invoke_openclaw_agent_via_gateway(self, prompt_text, gateway_url, gateway_token, model):
        """通过 Gateway OpenAI 兼容 API 调用大模型"""
        payload = json.dumps({
            'model': model,
            'messages': [
                {
                    'role': 'user',
                    'content': prompt_text
                }
            ],
            'max_tokens': 4000,
            'temperature': 0.7
        }).encode('utf-8')

        req = urllib.request.Request(
            gateway_url,
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {gateway_token}'
            },
            method='POST'
        )

        context = self.create_ssl_context()

        # 大模型调用超时设置为 5 分钟
        llm_timeout = 300

        try:
            with urllib.request.urlopen(req, context=context, timeout=llm_timeout) as response:
                response_data = response.read()
                response_text = self.decode_response_body(response_data, response.headers.get_content_charset())

            if not response_text:
                raise RuntimeError('Gateway API 未返回内容')

            # 尝试解析 JSON 响应（OpenAI 格式）
            try:
                result = json.loads(response_text)
            except json.JSONDecodeError:
                # 如果不是 JSON，直接返回文本内容
                return {'content': response_text}

            # 从 OpenAI 格式响应中提取文本
            content = self.extract_content_from_openai_response(result)
            if content:
                return {'content': content}

            return {'content': response_text}

        except urllib.error.HTTPError as error:
            error_body = ''
            if error.fp:
                try:
                    error_body = error.fp.read().decode('utf-8', errors='ignore')
                except Exception:
                    pass
            raise RuntimeError(f'Gateway API HTTP {error.code}: {error.reason} - {error_body}')
        except urllib.error.URLError as error:
            if 'timed out' in str(error.reason).lower() or isinstance(error.reason, TimeoutError):
                raise TimeoutError('Gateway API 调用超时')
            raise RuntimeError(f'Gateway API 网络错误: {error.reason}')
        except TimeoutError:
            raise
        except Exception as error:
            raise RuntimeError(f'Gateway API 调用失败: {error}')

    def extract_content_from_openai_response(self, result):
        """从 OpenAI 格式响应中提取文本内容"""
        if isinstance(result, dict):
            # OpenAI chat completions 格式
            choices = result.get('choices', [])
            if isinstance(choices, list) and len(choices) > 0:
                choice = choices[0]
                if isinstance(choice, dict):
                    message = choice.get('message', {})
                    if isinstance(message, dict):
                        content = message.get('content')
                        if content and isinstance(content, str):
                            return content

            # 尝试其他路径
            for path in [
                ['content'],
                ['result', 'content'],
                ['text'],
                ['result', 'text'],
            ]:
                value = result
                for key in path:
                    if isinstance(value, dict):
                        value = value.get(key)
                    else:
                        value = None
                        break

                if value and isinstance(value, str) and value.strip():
                    return value.strip()

        return None

    def extract_content_from_gateway_response(self, result):
        """从 Gateway 响应中提取文本内容"""
        if isinstance(result, dict):
            # 尝试各种可能的路径
            for path in [
                ['content'],
                ['result', 'content'],
                ['result', 'text'],
                ['message', 'content'],
                ['choices', 0, 'message', 'content'],
                ['output', 'content'],
                ['text'],
                ['result', 'payloads', 0, 'text'],
            ]:
                value = result
                for key in path:
                    if isinstance(value, dict):
                        value = value.get(key)
                    elif isinstance(value, list) and isinstance(key, int) and 0 <= key < len(value):
                        value = value[key]
                    else:
                        value = None
                        break

                if value and isinstance(value, str) and value.strip():
                    return value.strip()

        return None

    def normalize_openclaw_agent_output(self, output_text):
        try:
            payload = json.loads(output_text)
        except json.JSONDecodeError:
            payload = self.parse_possible_json_text(output_text)

        if isinstance(payload, dict):
            result_payload = payload.get('result')
            if isinstance(result_payload, dict):
                response_payloads = result_payload.get('payloads')
                if isinstance(response_payloads, list):
                    texts = [item.get('text', '') for item in response_payloads if isinstance(item, dict) and item.get('text')]
                    if texts:
                        return {'content': ' '.join(texts)}

        return payload if isinstance(payload, dict) else {'content': str(payload)}

    def handle_resolve_form_params(self):
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)

            env = params.get('env', [''])[0]
            source_url = params.get('url', [''])[0]

            if not env:
                self.send_error_response(400, '缺少 env 参数')
                return

            if not source_url:
                self.send_error_response(400, '缺少 url 参数')
                return

            if not self.headers.get('yht_access_token'):
                self.send_error_response(400, '缺少 yht_access_token 请求头')
                return

            parsed_source_url = urlparse(source_url)
            if parsed_source_url.scheme not in ('http', 'https'):
                self.send_error_response(400, 'url 必须是 http 或 https 地址')
                return

            normalized_env = self.normalize_environment(env)
            base_url = self.get_environment_base_url(normalized_env)
            if not base_url:
                self.send_error_response(400, f'不支持的环境: {env}')
                return

            if not source_url.startswith(base_url):
                self.send_error_response(400, '单据链接 URL 与所选环境不匹配')
                return

            redirect_info = self.resolve_form_redirect(source_url)
            redirect_url = redirect_info.get('redirectUrl')
            form_id = redirect_info.get('formId')
            form_instance_id = redirect_info.get('formInstanceId')
            error_message = redirect_info.get('errorMessage')

            if not redirect_url:
                self.send_error_response(502, '未获取到 302 目标地址')
                return

            if error_message:
                self.send_error_response(502, error_message)
                return

            if not form_id or not form_instance_id:
                self.send_error_response(502, '302 目标地址中缺少 formId 或 formInstanceId')
                return

            self.send_json_response(200, {
                'success': True,
                'data': {
                    'redirectUrl': redirect_url,
                    'formId': form_id,
                    'formInstanceId': form_instance_id
                }
            })
        except Exception as error:
            self.send_error_response(500, f'解析表单参数失败: {error}')

    def resolve_form_redirect(self, source_url):
        current_url = source_url
        last_url = source_url
        max_hops = 8
        last_error_message = ''

        for _ in range(max_hops):
            response_info = self.fetch_redirect_response(current_url)
            redirect_url = response_info.get('redirectUrl') or current_url
            last_url = redirect_url
            last_error_message = response_info.get('errorMessage', '') or last_error_message
            print(
                '[resolve-form-params] '
                f"status={response_info.get('statusCode')} "
                f"isRedirect={response_info.get('isRedirect')} "
                f"from={current_url} "
                f"to={redirect_url}"
            )
            form_id, form_instance_id = self.extract_form_params_from_url(redirect_url)

            if form_id and form_instance_id:
                return {
                    'redirectUrl': redirect_url,
                    'formId': form_id,
                    'formInstanceId': form_instance_id
                }

            body_form_id, body_form_instance_id, body_redirect_url = self.extract_form_params_from_text(
                response_info.get('bodyText', '')
            )
            if body_form_id and body_form_instance_id:
                return {
                    'redirectUrl': body_redirect_url or redirect_url,
                    'formId': body_form_id,
                    'formInstanceId': body_form_instance_id
                }

            if not last_error_message:
                last_error_message = self.detect_auth_error(
                    response_info.get('statusCode'),
                    redirect_url,
                    response_info.get('bodyText', '')
                )

            if not response_info.get('isRedirect') or not response_info.get('redirectUrl'):
                break

            current_url = response_info.get('redirectUrl')

        return {
            'redirectUrl': last_url,
            'formId': '',
            'formInstanceId': '',
            'errorMessage': last_error_message
        }

    def fetch_redirect_response(self, source_url):
        headers = self.collect_forward_headers()
        request = urllib.request.Request(source_url, headers=headers, method='GET')
        context = self.create_ssl_context()
        opener = urllib.request.build_opener(
            NoRedirectHandler,
            urllib.request.HTTPSHandler(context=context)
        )

        try:
            with opener.open(request, timeout=30) as response:
                if response.status in REDIRECT_STATUS_CODES:
                    return {
                        'isRedirect': True,
                        'statusCode': response.status,
                        'redirectUrl': self.resolve_redirect_url(source_url, response.headers.get('Location')),
                        'bodyText': '',
                        'errorMessage': ''
                    }
                response_body = response.read()
                body_text = self.decode_response_body(response_body, response.headers.get_content_charset())
                return {
                    'isRedirect': False,
                    'statusCode': response.status,
                    'redirectUrl': response.geturl(),
                    'bodyText': body_text,
                    'errorMessage': self.detect_auth_error(response.status, response.geturl(), body_text)
                }
        except urllib.error.HTTPError as error:
            if error.code in REDIRECT_STATUS_CODES:
                return {
                    'isRedirect': True,
                    'statusCode': error.code,
                    'redirectUrl': self.resolve_redirect_url(source_url, error.headers.get('Location')),
                    'bodyText': '',
                    'errorMessage': ''
                }
            error_body = ''
            if error.fp:
                try:
                    error_body = self.decode_response_body(
                        error.fp.read(),
                        error.headers.get_content_charset() if error.headers else None
                    )
                except Exception:
                    error_body = ''
            error_message = self.detect_auth_error(error.code, source_url, error_body)
            if error_message:
                return {
                    'isRedirect': False,
                    'statusCode': error.code,
                    'redirectUrl': source_url,
                    'bodyText': error_body,
                    'errorMessage': error_message
                }
            raise

    def extract_form_params_from_url(self, target_url):
        if not target_url:
            return '', ''

        parsed_url = urlparse(target_url)
        query_params = parse_qs(parsed_url.query)
        form_id = self.get_first_query_value(query_params, 'formId', 'formid', 'pk_bo', 'pkBo')
        form_instance_id = self.get_first_query_value(
            query_params,
            'formInstanceId',
            'forminstanceid',
            'pk_boins',
            'pkBoins'
        )

        if form_id and form_instance_id:
            return form_id, form_instance_id

        fragment_query = parsed_url.fragment.split('?', 1)[1] if '?' in parsed_url.fragment else parsed_url.fragment
        fragment_params = parse_qs(fragment_query)
        form_id = form_id or self.get_first_query_value(fragment_params, 'formId', 'formid', 'pk_bo', 'pkBo')
        form_instance_id = form_instance_id or self.get_first_query_value(
            fragment_params,
            'formInstanceId',
            'forminstanceid',
            'pk_boins',
            'pkBoins'
        )

        if form_id and form_instance_id:
            return form_id, form_instance_id

        nested_values = []
        for values in list(query_params.values()) + list(fragment_params.values()):
            nested_values.extend(values)

        for candidate in nested_values:
            nested_form_id, nested_form_instance_id = self.extract_form_params_from_text(candidate)
            if nested_form_id and nested_form_instance_id:
                return nested_form_id, nested_form_instance_id

        return form_id, form_instance_id

    def extract_form_params_from_text(self, text):
        if not text:
            return '', '', ''

        normalized_text = self.normalize_search_text(text)
        form_id = self.search_param_in_text(normalized_text, 'formId', 'formid', 'pk_bo', 'pkBo')
        form_instance_id = self.search_param_in_text(
            normalized_text,
            'formInstanceId',
            'forminstanceid',
            'pk_boins',
            'pkBoins'
        )
        if form_id and form_instance_id:
            return form_id, form_instance_id, ''

        for candidate_url in re.findall(r'https?://[^\s"\'<>]+', normalized_text):
            form_id, form_instance_id = self.extract_form_params_from_url(candidate_url)
            if form_id and form_instance_id:
                return form_id, form_instance_id, candidate_url

        return '', '', ''

    def search_param_in_text(self, text, *param_names):
        patterns = [
            r'{name}=([^&#"\'\\\s]+)',
            r'["\']{name}["\']\s*:\s*["\']([^"\']+)["\']',
            r'["\']{name}["\']\s*=\s*["\']([^"\']+)["\']',
            r'\b{name}\b\s*:\s*["\']([^"\']+)["\']',
            r'\b{name}\b\s*=\s*["\']([^"\']+)["\']'
        ]

        for param_name in param_names:
            for pattern in patterns:
                match = re.search(pattern.format(name=re.escape(param_name)), text, flags=re.IGNORECASE)
                if match:
                    return unquote(match.group(1))

        return ''

    def normalize_search_text(self, text):
        normalized_text = text
        for _ in range(2):
            decoded_text = unquote(normalized_text)
            if decoded_text == normalized_text:
                break
            normalized_text = decoded_text

        return normalized_text.replace('\\/', '/')

    def decode_response_body(self, body_bytes, charset):
        if not body_bytes:
            return ''

        encoding = charset or 'utf-8'
        try:
            return body_bytes.decode(encoding, errors='ignore')
        except LookupError:
            return body_bytes.decode('utf-8', errors='ignore')

    def detect_auth_error(self, status_code, final_url, body_text):
        normalized_url = (final_url or '').lower()
        normalized_body = (body_text or '').lower()

        if status_code in (401, 403):
            return 'yht_access_token 授权失效或无权限，请按当前环境重新填写后重试'

        auth_markers = [
            'login',
            '登录',
            '统一认证',
            'cas',
            'sso',
            'unauthorized',
            'forbidden',
            'access denied',
            '请登录',
            '重新登录'
        ]
        if any(marker in normalized_url for marker in ['login', 'cas', 'sso']):
            return '302 目标已跳转到登录页，当前环境的 yht_access_token 可能已失效，请重新填写后重试'

        if any(marker.lower() in normalized_body for marker in auth_markers):
            return '302 目标返回登录页或鉴权失败页面，当前环境的 yht_access_token 可能已失效，请重新填写后重试'

        return ''

    def resolve_redirect_url(self, source_url, redirect_url):
        if not redirect_url:
            return ''

        return urljoin(source_url, redirect_url)

    def collect_forward_headers(self):
        headers = {}
        for header in ['Accept', 'yht_access_token', 'x-xsrf-token', 'Content-Type']:
            value = self.headers.get(header)
            if value:
                headers[header] = value
        if 'Accept' not in headers:
            headers['Accept'] = 'application/json, text/plain, */*'
        return headers

    def normalize_similar_issue_candidates(self, candidates, issue_key):
        normalized_issue_key = str(issue_key or '').strip().lower()
        normalized_candidates = []

        for item in candidates:
            if not isinstance(item, dict):
                continue

            candidate_issue_key = str(item.get('issueKey', '') or '').strip()
            candidate_summary = str(item.get('summary', '') or '').strip()
            if not candidate_issue_key or not candidate_summary:
                continue

            if candidate_issue_key.lower() == normalized_issue_key:
                continue

            normalized_candidates.append({
                'issueKey': candidate_issue_key,
                'issueId': str(item.get('issueId', '') or '').strip(),
                'summary': candidate_summary,
                'status': str(item.get('status', '') or '-').strip() or '-',
                'type': str(item.get('type', '') or '-').strip() or '-'
            })

        return normalized_candidates

    def invoke_similar_issue_analysis(self, issue_key, current_summary, candidates):
        business_data = {
            'issueKey': issue_key,
            'currentSummary': current_summary,
            'candidates': candidates
        }

        try:
            return self.invoke_similar_issue_analysis_via_llm(business_data)
        except Exception as error:
            print(f'[IForm-AI] Similar issue smart analysis failed, fallback to local keyword matcher: {error}')
            return self.fallback_similar_issue_analysis(issue_key, current_summary, candidates)

    def invoke_similar_issue_analysis_via_llm(self, business_data):
        prompt_text = self.build_similar_issue_analysis_prompt(business_data)
        response_payload = self.invoke_openclaw_agent(prompt_text)
        return self.extract_similar_issue_analysis_result(response_payload)

    def build_similar_issue_analysis_instruction(self):
        return (
            '你是 Jira 相似场景工单匹配助手。请分析并结构化整理输入的 Jira 工单数据，只根据标题语义判断哪些候选工单与当前工单属于相似场景。'
            '不要返回当前工单自身。'
            '只有相似时才放入 matches。'
            'similarityScore 取值范围是 0 到 1。'
            'matchReason 用中文简要说明相似原因。'
            '如果候选工单不相似，就不要放入 matches。'
            '禁止编造输入中不存在的 issueKey、issueId、summary、status、type。'
            '只返回 JSON，不要输出 markdown，不要添加解释。'
        )

    def build_similar_issue_analysis_prompt(self, business_data):
        return (
            f"{self.build_similar_issue_analysis_instruction()}\n\n"
            "请按以下 JSON 结构返回：\n"
            "{\n"
            '  "matches": [\n'
            '    {\n'
            '      "issueKey": "",\n'
            '      "issueId": "",\n'
            '      "similarityScore": 0,\n'
            '      "matchReason": ""\n'
            '    }\n'
            '  ],\n'
            '  "conclusion": ""\n'
            "}\n\n"
            "业务数据：\n"
            f"{json.dumps(business_data, ensure_ascii=False, indent=2)}"
        )

    def extract_similar_issue_analysis_result(self, response_payload):
        if not isinstance(response_payload, dict):
            raise ValueError('LLM 返回结构不正确')

        if isinstance(response_payload.get('data'), dict):
            response_payload = response_payload.get('data')

        if isinstance(response_payload.get('output'), dict):
            response_payload = response_payload.get('output')

        if isinstance(response_payload.get('result'), dict):
            response_payload = response_payload.get('result')

        if isinstance(response_payload.get('content'), dict):
            response_payload = response_payload.get('content')

        if isinstance(response_payload.get('content'), str):
            response_payload = self.parse_possible_json_text(response_payload.get('content') or '')

        if isinstance(response_payload.get('message'), dict):
            response_payload = response_payload.get('message')

        if isinstance(response_payload.get('message'), str):
            response_payload = self.parse_possible_json_text(response_payload.get('message') or '')

        if isinstance(response_payload.get('text'), str):
            response_payload = self.parse_possible_json_text(response_payload.get('text') or '')

        matches = response_payload.get('matches')
        conclusion = response_payload.get('conclusion', '')
        if not isinstance(matches, list):
            raise ValueError('LLM 返回的 matches 字段格式不正确')

        return {
            'matches': matches,
            'conclusion': str(conclusion or '').strip()
        }

    def parse_possible_json_text(self, text):
        raw_text = str(text or '').strip()
        if not raw_text:
            return {}

        try:
            return json.loads(raw_text)
        except json.JSONDecodeError:
            pass

        fenced_match = re.search(r'```(?:json)?\s*(\{.*\})\s*```', raw_text, flags=re.DOTALL)
        if fenced_match:
            return json.loads(fenced_match.group(1))

        json_match = re.search(r'(\{.*\})', raw_text, flags=re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))

        raise ValueError('LLM 返回内容不是有效 JSON')

    def fallback_similar_issue_analysis(self, issue_key, current_summary, candidates):
        current_tokens = self.tokenize_similarity_text(current_summary)
        matches = []

        for candidate in candidates:
            candidate_summary = candidate.get('summary', '')
            candidate_tokens = self.tokenize_similarity_text(candidate_summary)
            score = self.calculate_token_similarity(current_tokens, candidate_tokens)
            if score < 0.35:
                continue

            matches.append({
                'issueKey': candidate.get('issueKey', ''),
                'issueId': candidate.get('issueId', ''),
                'similarityScore': round(score, 4),
                'matchReason': '已按标题关键词重合度返回本地匹配结果，供人工进一步确认'
            })

        matches.sort(key=lambda item: item.get('similarityScore', 0), reverse=True)
        return {
            'source': 'fallback',
            'strategy': 'keyword_overlap',
            'matches': matches,
            'conclusion': '当前结果来自本地关键词匹配，不代表智能体语义解析结论，请结合工单详情人工确认'
        }

    def tokenize_similarity_text(self, text):
        normalized_text = re.sub(r'[\W_]+', ' ', str(text or '').lower())
        tokens = [token for token in normalized_text.split() if len(token) >= 2]
        return set(tokens)

    def calculate_token_similarity(self, left_tokens, right_tokens):
        if not left_tokens or not right_tokens:
            return 0

        intersection = left_tokens & right_tokens
        union = left_tokens | right_tokens
        if not union:
            return 0

        return len(intersection) / len(union)

    def build_similar_issue_analysis_response(self, issue_key, candidates, analysis_result):
        matches = analysis_result.get('matches', []) if isinstance(analysis_result, dict) else []
        candidate_map = {item.get('issueKey', ''): item for item in candidates}
        normalized_matches = []

        for item in matches:
            if not isinstance(item, dict):
                continue

            candidate_issue_key = str(item.get('issueKey', '') or '').strip()
            if not candidate_issue_key or candidate_issue_key not in candidate_map:
                continue

            candidate = candidate_map[candidate_issue_key]
            similarity_score = item.get('similarityScore', 0)
            try:
                similarity_score = max(0, min(1, float(similarity_score)))
            except (TypeError, ValueError):
                similarity_score = 0

            normalized_matches.append({
                'issueKey': candidate_issue_key,
                'issueId': candidate.get('issueId', ''),
                'summary': candidate.get('summary', ''),
                'status': candidate.get('status', '-'),
                'type': candidate.get('type', '-'),
                'similarityScore': round(similarity_score, 4),
                'matchReason': str(item.get('matchReason', '') or '').strip() or '模型未返回匹配原因'
            })

        normalized_matches.sort(key=lambda item: item.get('similarityScore', 0), reverse=True)
        analysis_source = (
            str(analysis_result.get('source', '') or '').strip()
            if isinstance(analysis_result, dict)
            else ''
        ) or 'llm'
        return {
            'state': 'loaded',
            'issueKey': issue_key,
            'matches': normalized_matches,
            'analysis': {
                'source': analysis_source,
                'candidateCount': len(candidates),
                'matchedCount': len(normalized_matches),
                'conclusion': (
                    str(analysis_result.get('conclusion', '') or '').strip()
                    if isinstance(analysis_result, dict)
                    else ''
                ) or (f'找到 {len(normalized_matches)} 条相似场景工单' if normalized_matches else '未匹配到相似场景工单')
            }
        }

    def get_jira_cookie(self):
        jira_cookie = (self.headers.get('x-jira-cookie') or self.headers.get('Cookie') or '').strip()
        return self.normalize_jira_cookie_value(jira_cookie)

    def normalize_jira_cookie_value(self, raw_value):
        cookie_text = str(raw_value or '').strip()
        if not cookie_text:
            return ''

        if cookie_text.lower().startswith('cookie:'):
            cookie_text = cookie_text.split(':', 1)[1].strip()

        cookie_text = re.sub(r'[\r\n\t]+', ' ', cookie_text)
        cookie_text = re.sub(r';\s*;+', ';', cookie_text)
        segments = []
        for part in cookie_text.split(';'):
            item = part.strip()
            if not item or '=' not in item:
                continue

            name, value = item.split('=', 1)
            normalized_name = name.strip()
            normalized_value = value.strip()
            if not normalized_name or not normalized_value:
                continue

            segments.append(f'{normalized_name}={normalized_value}')

        return '; '.join(segments)

    def get_cookie_value_by_name(self, cookie_text, target_name):
        normalized_target = str(target_name or '').strip().lower()
        if not normalized_target:
            return ''

        for part in str(cookie_text or '').split(';'):
            item = part.strip()
            if not item or '=' not in item:
                continue

            name, value = item.split('=', 1)
            if name.strip().lower() == normalized_target:
                return value.strip()

        return ''

    def build_jira_headers(self, jira_cookie, extra_headers=None):
        headers = {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Cookie': jira_cookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'x-atlassian-token': 'no-check',
            'x-requested-with': 'XMLHttpRequest',
            'x-sitemesh-off': 'true',
            '__amdmodulename': 'jira/issue/utils/xsrf-token-header'
        }

        # 已移除 xsrf_token 避免401错误
        # 如需恢复，可取消下面注释
        # xsrf_token = self.get_cookie_value_by_name(jira_cookie, 'atlassian.xsrf.token')
        # if xsrf_token:
        #     headers['x-xsrf-token'] = xsrf_token

        if extra_headers:
            headers.update(extra_headers)
        return headers

    def handle_jira_http_error(self, error):
        error_body = ''
        if error.fp:
            try:
                error_body = self.decode_response_body(
                    error.fp.read(),
                    error.headers.get_content_charset() if error.headers else None
                )
            except Exception:
                error_body = ''

        if error.code in (401, 403):
            message = self.build_jira_auth_error_message(error, error_body)
            self.send_error_response(error.code, message)
            return

        message = f'Jira 请求失败: HTTP {error.code}'
        if error.reason:
            message = f'{message} {error.reason}'

        if self.looks_like_jira_login_page(error_body):
            message = 'Jira 请求返回登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试'

        self.send_error_response(error.code, message)

    def build_jira_auth_error_message(self, error, error_body=''):
        if self.looks_like_jira_login_page(error_body):
            return 'Jira 请求返回登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试'

        headers = error.headers or {}
        login_reason = (
            headers.get('X-Seraph-LoginReason')
            or headers.get('x-seraph-loginreason')
            or ''
        ).strip()
        location = (headers.get('Location') or headers.get('location') or '').strip()

        if login_reason:
            return f'Jira 鉴权失败，X-Seraph-LoginReason={login_reason}。请确认当前 Cookie 是否来自已登录且仍有效的 Jira 页面'

        if location and ('login' in location.lower() or 'signin' in location.lower()):
            return 'Jira 已重定向到登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试'

        message = f'Jira 系统 Cookie 无效或无权限，请重新填写后重试（HTTP {error.code}'
        if error.reason:
            message = f'{message} {error.reason}'
        return f'{message}）'

    def looks_like_jira_login_page(self, body_text):
        normalized_body = (body_text or '').lower()
        html_markers = ['<!doctype html', '<html', '<form', '<title']
        login_markers = ['ajs-login', 'login-form', 'id="login-form"', '/login.jsp', '登录', '请登录']
        return any(marker in normalized_body for marker in html_markers) and any(marker in normalized_body for marker in login_markers)

    def build_jira_issue_search_referer(self, jql):
        jira_base_url = self.get_jira_base_url()
        referer = f'{jira_base_url}/issues/'
        if jql:
            referer = f'{referer}?jql={urllib.parse.quote(jql)}'
        return referer

    def build_jira_issue_browse_referer(self, issue_key):
        issue_key = (issue_key or '').strip()
        if not issue_key:
            return self.build_jira_issue_search_referer('')
        jira_base_url = self.get_jira_base_url()
        return f'{jira_base_url}/browse/{urllib.parse.quote(issue_key)}'

    def create_ssl_context(self):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context

    def normalize_environment(self, env):
        mapping = {
            'core1': 'c1',
            'core2': 'c2',
            'core3': 'c3',
            'core4': 'c4'
        }
        return mapping.get(env, env)

    def get_environment_base_url(self, env):
        normalized_env = self.normalize_environment(env)
        environments = RUNTIME_CONFIG.get('environments', {})
        environment_config = environments.get(normalized_env) or environments.get(env) or {}
        if not isinstance(environment_config, dict):
            return ''
        return str(environment_config.get('baseUrl', '') or '').strip()

    def get_jira_base_url(self):
        return get_jira_base_url_from_config()

    def get_first_query_value(self, query_params, *keys):
        lowered_params = {}
        for key, values in (query_params or {}).items():
            lowered_params.setdefault(str(key).lower(), values)

        for key in keys:
            values = lowered_params.get(str(key).lower(), [])
            if values:
                return values[0]

        return ''

    def send_json_response(self, code, payload):
        self.send_response(code)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))

    def send_error_response(self, code, message):
        self.send_json_response(code, {
            'success': False,
            'error': {
                'code': code,
                'message': message
            }
        })

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()


def main():
    refresh_runtime_config()
    os.chdir(DIRECTORY)

    with socketserver.TCPServer(("", PORT), ProxyHTTPRequestHandler) as httpd:
        url = f"http://localhost:{PORT}/templates/index.html"
        print(f"\n{'=' * 60}")
        print('[IForm-AI] 本地代理服务已启动')
        print(f"{'=' * 60}")
        print(f"访问地址: {url}")
        print(f"静态目录: {DIRECTORY}")
        print(f"运行时配置: {RUNTIME_CONFIG_PATH}")
        print(f"代理接口: http://localhost:{PORT}/api/proxy?env=test&path=/xxx")
        print(f"解析接口: http://localhost:{PORT}/api/resolve-form-params?env=test&url=https://...")
        print(f"Jira代理: {'已启用' if get_jira_base_url_from_config() else '未启用'}")
        print(f"{'=' * 60}\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\n服务已停止')


if __name__ == "__main__":
    main()
