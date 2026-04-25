/**
 * Build Script for H5 Business System
 * Handles building, bundling, and deployment
 */

const fs = require('fs');
const path = require('path');

// Build configuration
const config = {
    srcDir: path.join(__dirname, '..', 'assets'),
    distDir: path.join(__dirname, '..', 'dist'),
    publicPath: '/',
};

// Ensure directory exists
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Copy directory recursively
function copyDir(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Minify CSS (basic)
function minifyCSS(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/;\s*}/g, '}')
        .replace(/\s*{\s*/g, '{')
        .replace(/;\s*/g, ';')
        .trim();
}

// Minify JS (basic)
function minifyJS(js) {
    return js
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Build function
function build() {
    console.log('🚀 Starting build...\n');
    
    // Clean dist directory
    console.log('📁 Cleaning dist directory...');
    if (fs.existsSync(config.distDir)) {
        fs.rmSync(config.distDir, { recursive: true });
    }
    ensureDir(config.distDir);
    
    // Copy static assets
    console.log('📦 Copying static assets...');
    copyDir(
        path.join(config.srcDir, 'static'),
        path.join(config.distDir, 'static')
    );
    
    // Process templates
    console.log('📝 Processing templates...');
    const templatesDir = path.join(config.srcDir, 'templates');
    const templates = fs.readdirSync(templatesDir);
    
    templates.forEach(template => {
        if (template.endsWith('.html')) {
            const content = fs.readFileSync(
                path.join(templatesDir, template),
                'utf-8'
            );
            
            // Replace template variables
            const processed = content
                .replace(/\{\{page_title\}\}/g, 'H5 Business System')
                .replace(/\{\{page_css\}\}/g, '')
                .replace(/\{\{page_content\}\}/g, '<div id="app"></div>')
                .replace(/\{\{page_js\}\}/g, '');
            
            fs.writeFileSync(
                path.join(config.distDir, template),
                processed
            );
        }
    });
    
    // Create index.html from base.html
    console.log('🏠 Creating index.html...');
    const baseTemplate = fs.readFileSync(
        path.join(config.srcDir, 'templates', 'base.html'),
        'utf-8'
    );
    
    const indexContent = baseTemplate
        .replace(/\{\{page_title\}\}/g, 'H5 Business System')
        .replace(/\{\{page_css\}\}/g, '')
        .replace(/\{\{page_content\}\}/g, `
            <div class="page home-page">
                <header class="page-header">
                    <h1 class="page-title">H5 Business System</h1>
                </header>
                <div class="page-content">
                    <div class="home-menu">
                        <div class="menu-item" onclick="router.navigate('/list')">
                            <div class="menu-icon">📋</div>
                            <div class="menu-title">数据列表</div>
                        </div>
                        <div class="menu-item" onclick="router.navigate('/dashboard')">
                            <div class="menu-icon">📊</div>
                            <div class="menu-title">数据看板</div>
                        </div>
                        <div class="menu-item" onclick="router.navigate('/profile')">
                            <div class="menu-icon">👤</div>
                            <div class="menu-title">个人中心</div>
                        </div>
                    </div>
                </div>
            </div>
        `)
        .replace(/\{\{page_js\}\}/g, `
            <script>
                // Home page initialization
                document.addEventListener('DOMContentLoaded', function() {
                    console.log('H5 Business System loaded');
                });
            </script>
        `);
    
    fs.writeFileSync(path.join(config.distDir, 'index.html'), indexContent);
    
    // Create config file
    console.log('⚙️  Creating config file...');
    const appConfig = {
        name: 'H5 Business System',
        version: '1.0.0',
        api: {
            baseURL: 'https://api.your-business-system.com',
            timeout: 30000,
        },
        features: {
            pullToRefresh: true,
            infiniteScroll: true,
            offlineCache: true,
        },
    };
    
    fs.writeFileSync(
        path.join(config.distDir, 'config.json'),
        JSON.stringify(appConfig, null, 2)
    );
    
    // Create README
    console.log('📖 Creating README...');
    const readme = `# H5 Business System

## 项目结构

\`\`\`
dist/
├── index.html          # 入口页面
├── config.json         # 配置文件
├── static/
│   ├── css/           # 样式文件
│   ├── js/            # JavaScript文件
│   └── images/        # 图片资源
└── [其他页面].html
\`\`\`

## 部署说明

1. 将 \`dist\` 目录下的所有文件上传到Web服务器
2. 配置API地址（修改 \`config.json\` 中的 \`api.baseURL\`）
3. 确保服务器支持HTTPS（推荐）
4. 配置CORS允许跨域访问

## 开发说明

- 模板文件位于 \`assets/templates/\`
- 样式文件位于 \`assets/static/css/\`
- JavaScript文件位于 \`assets/static/js/\`
- 运行 \`node scripts/build.js\` 重新构建

## 浏览器支持

- iOS Safari 12+
- Android Chrome 80+
- 微信内置浏览器
`;
    
    fs.writeFileSync(path.join(config.distDir, 'README.md'), readme);
    
    console.log('\n✅ Build completed successfully!');
    console.log(`\n📂 Output directory: ${config.distDir}`);
    console.log('\nNext steps:');
    console.log('  1. Update config.json with your API endpoint');
    console.log('  2. Deploy the dist/ folder to your web server');
    console.log('  3. Test on mobile devices');
}

// Run build
build();
