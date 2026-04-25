#!/usr/bin/env python3
"""
IForm-AI H5 System - 简易HTTP服务器
用于本地开发和测试
"""

import http.server
import socketserver
import os
import webbrowser
from pathlib import Path

PORT = 8080
DIRECTORY = Path(__file__).parent.parent / "assets"

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)
    
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

def main():
    os.chdir(DIRECTORY)
    
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        url = f"http://localhost:{PORT}/templates/index.html"
        print(f"\n{'='*50}")
        print(f"🚀 IForm-AI 服务器已启动!")
        print(f"{'='*50}")
        print(f"📍 本地访问: {url}")
        print(f"📂 服务目录: {DIRECTORY}")
        print(f"{'='*50}\n")
        
        # 自动打开浏览器
        webbrowser.open(url)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n👋 服务器已关闭")

if __name__ == "__main__":
    main()
