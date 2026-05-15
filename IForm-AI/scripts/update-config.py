# -*- coding: utf-8 -*-
"""
IForm-AI 配置更新脚本
在启动 H5 服务前运行，自动获取当前 YonClaw 智能体配置并更新 runtime-config.json
"""

import glob
import json
import os
from urllib.parse import urlparse, urlunparse

# 配置文件路径（相对于本脚本所在目录）
CONFIG_FILE = os.path.join(os.path.dirname(__file__), '..', 'assets', 'static', 'config', 'runtime-config.json')
CONFIG_FILE = os.path.normpath(CONFIG_FILE)

# 默认配置（无法获取时使用）
DEFAULT_CONFIG = {
    "gatewayUrl": "http://127.0.0.1:29179/v1/chat/completions",
    "gatewayToken": "",
    "model": "openclaw/main"
}



def is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())



def normalize_gateway_url(value):
    """将 gatewayUrl 规范化为可调用的 chat completions 接口地址。"""
    raw_url = str(value or '').strip()
    if not raw_url:
        return ''

    parsed = urlparse(raw_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        return raw_url

    path = (parsed.path or '').strip()
    normalized_path = path.rstrip('/')

    if not normalized_path:
        normalized_path = '/v1/chat/completions'
    elif normalized_path == '/v1':
        normalized_path = '/v1/chat/completions'
    elif normalized_path.endswith('/v1/chat/completions'):
        normalized_path = normalized_path
    elif normalized_path.endswith('/chat/completions'):
        normalized_path = normalized_path
    else:
        normalized_path = normalized_path

    return urlunparse((
        parsed.scheme,
        parsed.netloc,
        normalized_path,
        parsed.params,
        parsed.query,
        parsed.fragment
    ))



def sanitize_yonclaw_config(raw_config):
    """仅保留 yonclaw 需要的字段，并统一为字符串。"""
    raw = raw_config if isinstance(raw_config, dict) else {}
    return {
        "gatewayUrl": normalize_gateway_url(raw.get("gatewayUrl", "")),
        "gatewayToken": str(raw.get("gatewayToken", "") or "").strip(),
        "model": str(raw.get("model", "") or "").strip()
    }



def merge_configs(*configs):
    """按顺序合并配置：后者仅在值非空时覆盖前者。"""
    merged = {
        "gatewayUrl": "",
        "gatewayToken": "",
        "model": ""
    }

    for config in configs:
        current = sanitize_yonclaw_config(config)
        for key, value in current.items():
            if is_non_empty_string(value):
                merged[key] = value

    return merged



def mask_sensitive_text(value):
    text = str(value or '').strip()
    if not text:
        return '(空)'
    if len(text) <= 8:
        return '*' * len(text)
    return f"{text[:4]}***{text[-2:]}"



def read_existing_runtime_yonclaw_config():
    """读取 runtime-config.json 里当前已有的 yonclaw 配置。"""
    try:
        if not os.path.exists(CONFIG_FILE):
            return {}

        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)

        result = sanitize_yonclaw_config(config.get('yonclaw', {}))
        if any(is_non_empty_string(v) for v in result.values()):
            print('✓ 已读取现有 runtime-config.json 中的 yonclaw 配置')
        return result
    except Exception:
        print('⚠️ 读取现有 runtime-config.json 中的 yonclaw 配置失败')
        return {}


def get_yonclaw_profile_roots():
    """返回当前系统可能存在的 YonClaw profiles 根目录。"""
    home_dir = os.path.expanduser('~')
    candidates = [
        os.path.join(home_dir, 'AppData', 'Roaming', 'yonclaw', 'profiles'),
        os.path.join(home_dir, 'Library', 'Application Support', 'yonclaw', 'profiles')
    ]

    roots = []
    seen = set()
    for candidate in candidates:
        normalized = os.path.normpath(candidate)
        key = os.path.normcase(normalized)
        if key in seen:
            continue
        seen.add(key)
        if os.path.isdir(normalized):
            roots.append(normalized)
    return roots



def get_yonclaw_config_candidates():
    """自动扫描本机所有 YonClaw profile 下的 openclaw.json。"""
    candidates = []
    for profiles_root in get_yonclaw_profile_roots():
        pattern = os.path.join(
            profiles_root,
            '*',
            'userData',
            'runtime',
            'openclaw',
            'openclaw.json'
        )
        candidates.extend(os.path.normpath(path) for path in glob.glob(pattern))

    # 按修改时间倒序，优先最近活跃的 profile
    candidates.sort(key=lambda path: os.path.getmtime(path) if os.path.exists(path) else 0, reverse=True)
    return candidates



def read_yonclaw_config_file(config_path):
    """从某个 openclaw.json 中提取 gateway 信息。"""
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        gateway = config.get('gateway', {}) if isinstance(config, dict) else {}
        auth = gateway.get('auth', {}) if isinstance(gateway, dict) else {}

        result = {
            'gatewayUrl': str(gateway.get('remoteUrl', '') or gateway.get('url', '') or '').strip(),
            'gatewayToken': str(auth.get('token', '') or '').strip(),
            'model': ''
        }

        if is_non_empty_string(result['gatewayUrl']) or is_non_empty_string(result['gatewayToken']):
            profile_dir = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(config_path)))))
            print(f'✓ 已从 YonClaw 配置文件读取认证信息: {profile_dir}')

        return result
    except Exception:
        print(f'⚠️ 读取 YonClaw 配置文件失败: {config_path}')
        return {}



def get_yonclaw_config_from_files():
    """从自动发现的 YonClaw 配置文件中读取可用配置。"""
    candidates = get_yonclaw_config_candidates()
    if not candidates:
        print('⚠️ 未发现可用的 YonClaw profile 配置文件')
        return {}

    merged = {}
    for config_path in candidates:
        merged = merge_configs(merged, read_yonclaw_config_file(config_path))
        if is_non_empty_string(merged.get('gatewayToken')):
            break

    return merged



def build_gateway_url_from_env():
    """优先从显式 URL 读取；否则根据 OPENCLAW_GATEWAY_PORT 组装本地 Gateway URL。"""
    explicit_url = str(os.environ.get('YONCLAW_GATEWAY_URL', '') or '').strip()
    if explicit_url:
        return normalize_gateway_url(explicit_url)

    gateway_port = str(os.environ.get('OPENCLAW_GATEWAY_PORT', '') or '').strip()
    if gateway_port:
        return normalize_gateway_url(f'http://127.0.0.1:{gateway_port}/v1/chat/completions')

    return ''



def get_gateway_config_from_env():
    """从环境变量获取运行时配置。"""
    result = {
        'gatewayUrl': build_gateway_url_from_env(),
        'gatewayToken': str(
            os.environ.get('YONCLAW_GATEWAY_TOKEN', '')
            or os.environ.get('OPENCLAW_GATEWAY_TOKEN', '')
            or ''
        ).strip(),
        'model': os.environ.get('YONCLAW_MODEL', '')
    }
    if any(is_non_empty_string(v) for v in result.values()):
        print('✓ 已从环境变量读取运行时配置')
    else:
        print('⚠️ 环境变量中未提供 YonClaw 运行时配置')
    return sanitize_yonclaw_config(result)



def get_gateway_config():
    """按固定优先级组装 yonclaw 配置。

    优先级（高 -> 低）：
    1. 环境变量
    2. 本机 profile 配置文件 openclaw.json
    3. 现有 runtime-config.json
    4. 默认值
    """
    env_config = get_gateway_config_from_env()
    file_config = get_yonclaw_config_from_files()
    existing_config = read_existing_runtime_yonclaw_config()

    merged = merge_configs(
        DEFAULT_CONFIG,
        existing_config,
        file_config,
        env_config
    )

    if is_non_empty_string(merged.get('gatewayToken')):
        print('✓ 已按优先级生成可用的 YonClaw 运行时配置')
    else:
        print('⚠️ 未获取到完整运行时配置，将保留默认值或现有值')

    return merged



def update_runtime_config(yonclaw_config):
    """更新 runtime-config.json 中的 yonclaw 节点，避免被空值覆盖。"""
    if not os.path.exists(CONFIG_FILE):
        print('❌ 运行时配置文件不存在')
        return False

    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)

    existing_yonclaw = sanitize_yonclaw_config(config.get('yonclaw', {}))
    next_yonclaw = merge_configs(DEFAULT_CONFIG, existing_yonclaw, yonclaw_config)
    config['yonclaw'] = next_yonclaw

    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('✓ 运行时配置已更新')
    print(f"  - gatewayUrl: {'已配置' if is_non_empty_string(next_yonclaw.get('gatewayUrl')) else '未配置'}")
    print(f"  - gatewayToken: {mask_sensitive_text(next_yonclaw.get('gatewayToken'))}")
    print(f"  - model: {next_yonclaw.get('model') or '(空)'}")
    return True



def main():
    """主函数"""
    print('=' * 50)
    print('🔄 IForm-AI 配置更新工具')
    print('=' * 50)
    print('ℹ️ 当前配置来源优先级：环境变量 > 本机 profile 配置文件 > 现有 runtime-config.json > 默认值')

    print('\n📥 获取 YonClaw 配置...')
    yonclaw_config = get_gateway_config()

    print('\n💾 更新 runtime-config.json...')
    success = update_runtime_config(yonclaw_config)

    if success:
        print('\n✅ 配置更新完成！可以启动 H5 服务了。')
    else:
        print('\n❌ 配置更新失败')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
