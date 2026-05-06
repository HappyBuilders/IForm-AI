# -*- coding: utf-8 -*-
"""
IForm-AI 配置更新脚本
在启动 H5 服务前运行，自动获取当前 YonClaw 智能体配置并更新 runtime-config.json
"""

import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

# 配置文件路径（相对于本脚本所在目录）
CONFIG_FILE = os.path.join(os.path.dirname(__file__), '..', 'assets', 'static', 'config', 'runtime-config.json')
CONFIG_FILE = os.path.normpath(CONFIG_FILE)

# YonClaw 配置文件路径
OPENCLAW_CONFIG_FILE = os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming', 'yonclaw', 'profiles', 'profile-c7373b7835e20fbde372b2531d53b8e35d8f06d4cc12ff2f0da53f0475b9e856', 'userData', 'runtime', 'openclaw', 'openclaw.json')
OPENCLAW_CONFIG_FILE = os.path.normpath(OPENCLAW_CONFIG_FILE)

# 默认配置（无法获取时使用）
DEFAULT_CONFIG = {
    "gatewayUrl": "http://127.0.0.1:29179/v1/chat/completions",
    "gatewayToken": "",
    "model": "openclaw/main"
}


def get_yonclaw_config_token():
    """从 YonClaw 配置文件获取 gateway token"""
    try:
        if os.path.exists(OPENCLAW_CONFIG_FILE):
            with open(OPENCLAW_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                gateway = config.get('gateway', {})
                auth = gateway.get('auth', {})
                token = auth.get('token', '')
                if token:
                    print("✓ 已获取本机 YonClaw 认证信息")
                    return token
    except Exception:
        print("⚠️ 读取本机 YonClaw 配置失败")
    return None


def get_gateway_config():
    """从 YonClaw Gateway 获取当前智能体配置"""
    
    # 尝试从本地 Gateway 获取配置
    gateway_url = "http://127.0.0.1:29179/v1/config"
    
    try:
        req = urllib.request.Request(gateway_url)
        req.add_header('Accept', 'application/json')
        
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            return {
                "gatewayUrl": data.get("gatewayUrl", DEFAULT_CONFIG["gatewayUrl"]),
                "gatewayToken": data.get("gatewayToken", DEFAULT_CONFIG["gatewayToken"]),
                "model": data.get("model", DEFAULT_CONFIG["model"])
            }
    except Exception:
        print("⚠️ 无法从 Gateway 获取配置")
    
    # 尝试从 YonClaw 配置文件获取 token
    yonclaw_token = get_yonclaw_config_token()
    
    # 尝试从环境变量获取
    config = {
        "gatewayUrl": os.environ.get("YONCLAW_GATEWAY_URL", DEFAULT_CONFIG["gatewayUrl"]),
        "gatewayToken": os.environ.get("YONCLAW_GATEWAY_TOKEN", yonclaw_token or DEFAULT_CONFIG["gatewayToken"]),
        "model": os.environ.get("YONCLAW_MODEL", DEFAULT_CONFIG["model"])
    }
    
    if config["gatewayToken"]:
        print("✓ 已获取运行时配置")
        return config
    
    # 尝试从当前进程获取（YonClaw 内运行时有此变量）
    if hasattr(sys, 'yonclaw_config'):
        return sys.yonclaw_config
    
    print("⚠️ 未获取到完整运行时配置，将使用默认本地调试配置")
    return DEFAULT_CONFIG


def check_gateway_status():
    """检查 Gateway 是否可用"""
    try:
        req = urllib.request.Request("http://127.0.0.1:29179/v1/status")
        req.add_header('Accept', 'application/json')
        with urllib.request.urlopen(req, timeout=2):
            return True
    except:
        return False


def update_runtime_config(yonclaw_config):
    """更新 runtime-config.json 中的 yonclaw 节点"""
    
    # 读取现有配置
    if not os.path.exists(CONFIG_FILE):
        print("❌ 运行时配置文件不存在")
        return False
    
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 更新 yonclaw 节点
    config['yonclaw'] = yonclaw_config
    
    # 写回配置
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    
    print("✓ 运行时配置已更新")
    
    return True


def main():
    """主函数"""
    print("=" * 50)
    print("🔄 IForm-AI 配置更新工具")
    print("=" * 50)
    
    # 检查 Gateway 状态
    gateway_online = check_gateway_status()
    if gateway_online:
        print("✓ Gateway 在线")
    else:
        print("⚠️ Gateway 离线，将使用本地配置")
    
    # 获取配置
    print("\n📥 获取 YonClaw 配置...")
    yonclaw_config = get_gateway_config()
    
    # 更新配置
    print("\n💾 更新 runtime-config.json...")
    success = update_runtime_config(yonclaw_config)
    
    if success:
        print("\n✅ 配置更新完成！可以启动 H5 服务了。")
    else:
        print("\n❌ 配置更新失败")
        sys.exit(1)


if __name__ == '__main__':
    main()