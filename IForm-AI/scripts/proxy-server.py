#!/usr/bin/env python3
"""
IForm-AI H5 System - local HTTP server with lightweight proxy support.
"""

import http.server
import json
import os
import socketserver
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, yht_access_token, x-xsrf-token')
        self.send_header('Access-Control-Max-Age', '86400')

    def do_GET(self):
        if self.path.startswith('/api/resolve-form-params'):
            self.handle_resolve_form_params()
            return

        if self.path.startswith('/api/proxy'):
            self.handle_proxy_request()
            return

        super().do_GET()

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

            redirect_url = self.fetch_redirect_location(source_url)
            if not redirect_url:
                self.send_error_response(502, '未获取到 302 目标地址')
                return

            redirect_params = parse_qs(urlparse(redirect_url).query)
            form_id = self.get_first_query_value(redirect_params, 'formId')
            form_instance_id = self.get_first_query_value(redirect_params, 'formInstanceId')

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

    def fetch_redirect_location(self, source_url):
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
                    return response.headers.get('Location')
                return response.geturl()
        except urllib.error.HTTPError as error:
            if error.code in REDIRECT_STATUS_CODES:
                return error.headers.get('Location')
            raise

    def collect_forward_headers(self):
        headers = {}
        for header in ['Accept', 'yht_access_token', 'x-xsrf-token', 'Content-Type']:
            value = self.headers.get(header)
            if value:
                headers[header] = value
        if 'Accept' not in headers:
            headers['Accept'] = 'application/json, text/plain, */*'
        return headers

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

    def get_first_query_value(self, query_params, key):
        values = query_params.get(key, [])
        return values[0] if values else ''

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
