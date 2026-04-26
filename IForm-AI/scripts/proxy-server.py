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

ENVIRONMENTS = {
    'test': 'https://bip-test.yonyoucloud.com',
    'daily': 'https://bip-daily.yonyoucloud.com',
    'pre': 'https://bip-pre.yonyoucloud.com',
    'core1': 'https://c1.yonyoucloud.com',
    'core2': 'https://c2.yonyoucloud.com',
    'core3': 'https://c3.yonyoucloud.com',
    'core4': 'https://c4.yonyoucloud.com',
    'c1': 'https://c1.yonyoucloud.com',
    'c2': 'https://c2.yonyoucloud.com',
    'c3': 'https://c3.yonyoucloud.com',
    'c4': 'https://c4.yonyoucloud.com',
}

REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
JIRA_BASE_URL = 'https://gfjira.yyrd.com'


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

        if self.path.startswith('/api/proxy'):
            self.handle_proxy_request()
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/jira/issue-table'):
            self.handle_jira_issue_table()
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

            base_url = ENVIRONMENTS.get(self.normalize_environment(env))
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
                'Origin': JIRA_BASE_URL,
                'Referer': referer
            })

            request = urllib.request.Request(
                f'{JIRA_BASE_URL}/rest/issueNav/1/issueTable',
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
            detail_url = f'{JIRA_BASE_URL}/secure/AjaxIssueEditAction!default.jspa?{query}'

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
            base_url = ENVIRONMENTS.get(normalized_env)
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
        referer = f'{JIRA_BASE_URL}/issues/'
        if jql:
            referer = f'{referer}?jql={urllib.parse.quote(jql)}'
        return referer

    def build_jira_issue_browse_referer(self, issue_key):
        issue_key = (issue_key or '').strip()
        if not issue_key:
            return self.build_jira_issue_search_referer('')
        return f'{JIRA_BASE_URL}/browse/{urllib.parse.quote(issue_key)}'

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
        print(f"代理接口: http://localhost:{PORT}/api/proxy?env=test&path=/xxx")
        print(f"解析接口: http://localhost:{PORT}/api/resolve-form-params?env=test&url=https://...")
        print(f"{'=' * 60}\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\n服务已停止')


if __name__ == "__main__":
    main()
