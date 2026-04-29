#!/usr/bin/env python3
"""
IForm-AI H5 System - local HTTP server with lightweight proxy support.
"""

import http.server
import json
import os
import re
import socketserver
import ssl
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, unquote

PORT = 18080
DIRECTORY = Path(__file__).parent.parent / "assets"
RUNTIME_CONFIG_PATH = DIRECTORY / "static" / "config" / "runtime-config.json"

REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}

# 异步任务存储
LLM_TASKS = {}  # task_id -> {'status': 'pending|running|completed|failed', 'result': None, 'error': None}


def load_runtime_config():
    default_config = {
        'environments': {},
        'jira': {
            'enabled': False,
            'baseUrl': ''
        },
        'yonclaw': {
            'gatewayUrl': 'http://127.0.0.1:18789/api/agent',
            'gatewayToken': '',
            'model': 'yonyou-default/MiniMax-M2.5',
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
            'model': str(yonclaw_config.get('model', 'yonyou-default/MiniMax-M2.5') or '').strip(),
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

        if self.path.startswith('/api/proxy'):
            self.handle_proxy_request()
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/jira/issue-table'):
            self.handle_jira_issue_table()
            return

        if self.path.startswith('/api/jira/similar-issues-analysis'):
            self.handle_jira_similar_issues_analysis()
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
                'issue_key': issue_key,
                'current_summary': current_summary,
                'candidates': normalized_candidates
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
                    'taskId': task_id
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
            issue_key = task_data['issue_key']
            current_summary = task_data['current_summary']
            candidates = task_data['candidates']

            analysis_result = self.invoke_similar_issue_analysis(issue_key, current_summary, candidates)
            response_payload = self.build_similar_issue_analysis_response(
                issue_key,
                candidates,
                analysis_result
            )

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

    def handle_jira_similar_analysis_status(self, task_id):
        """查询相似工单分析任务状态"""
        task = LLM_TASKS.get(task_id)

        if not task:
            self.send_error_response(404, '任务不存在或已过期')
            return

        if task['status'] == 'completed':
            self.send_json_response(200, {
                'success': True,
                'data': {
                    'state': 'loaded',
                    'issueKey': task['task_data']['issue_key'],
                    'taskId': task_id,
                    'status': 'completed',
                    'matches': task['result']['data'].get('matches', []),
                    'analysis': task['result']['data'].get('analysis', {})
                }
            })
        elif task['status'] == 'failed':
            self.send_error_response(500, task.get('error', '分析失败'))
        else:
            self.send_json_response(200, {
                'success': True,
                'data': {
                    'state': 'processing',
                    'issueKey': task['task_data']['issue_key'],
                    'taskId': task_id,
                    'status': task['status']
                }
            })

    def handle_llm_analyze(self):
        """异步调用 YonClaw 大模型进行数据分析"""
        try:
            content_length = int(self.headers.get('Content-Length', '0') or '0')
            body_bytes = self.rfile.read(content_length) if content_length > 0 else b''
            body_text = self.decode_response_body(body_bytes, 'utf-8')
            payload = json.loads(body_text or '{}')

            prompt = str(payload.get('prompt', '') or '').strip()
            data = payload.get('data', {})

            if not prompt:
                self.send_error_response(400, '缺少 prompt 参数')
                return

            full_prompt = f"{prompt}\n\n待分析数据：\n{json.dumps(data, ensure_ascii=False, indent=2)}"

            # 生成任务ID
            import uuid
            task_id = str(uuid.uuid4())

            # 立即返回任务ID
            LLM_TASKS[task_id] = {
                'status': 'pending',
                'result': None,
                'error': None,
                'prompt': full_prompt
            }

            # 启动后台线程执行
            import threading
            thread = threading.Thread(
                target=self._run_llm_task,
                args=(task_id, full_prompt),
                daemon=True
            )
            thread.start()

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

        if not gateway_url or not gateway_token:
            raise RuntimeError('Gateway URL 或 Token 未配置，请检查 yonclaw.gatewayUrl 和 yonclaw.gatewayToken')

        return self.invoke_openclaw_agent_via_gateway(prompt_text, gateway_url, gateway_token, model)

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

        for item in candidates[:30]:
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
            'matches': matches[:10],
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
        jira_cookie = (self.headers.get('x-jira-cookie') or '').strip()
        if jira_cookie.lower().startswith('cookie:'):
            return jira_cookie.split(':', 1)[1].strip()
        return jira_cookie

    def build_jira_headers(self, jira_cookie, extra_headers=None):
        headers = {
            'Accept': '*/*',
            'Cookie': jira_cookie,
            'x-atlassian-token': 'no-check',
            'x-requested-with': 'XMLHttpRequest',
            '__amdmodulename': 'jira/issue/utils/xsrf-token-header'
        }
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
            self.send_error_response(error.code, 'Jira 系统 Cookie 无效或无权限，请重新填写后重试')
            return

        message = f'Jira 请求失败: HTTP {error.code}'
        if error.reason:
            message = f'{message} {error.reason}'

        if self.looks_like_jira_login_page(error_body):
            message = 'Jira 请求返回登录页，当前 Jira 系统 Cookie 可能已失效，请重新填写后重试'

        self.send_error_response(error.code, message)

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
