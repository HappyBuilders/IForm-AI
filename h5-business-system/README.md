# H5 Business System Skill

一个完整的H5移动业务系统开发框架，用于快速构建与现有业务系统API对接的移动应用。

## 📁 项目结构

```
h5-business-system/
├── SKILL.md                          # Skill主文档
├── README.md                         # 项目说明
├── scripts/                          # 脚本工具
│   ├── api-client.js                 # API客户端（参考实现）
│   ├── data-transformer.js           # 数据转换器
│   └── build.js                      # 构建脚本
├── references/                       # 参考文档
│   ├── api-config.md                 # API配置文档
│   ├── data-models.md                # 数据模型定义
│   └── ui-patterns.md                # UI设计模式
└── assets/                           # 静态资源
    ├── templates/                    # HTML模板
    │   ├── base.html                 # 基础模板
    │   ├── list-view.html            # 列表页模板
    │   ├── detail-view.html          # 详情页模板
    │   └── form-view.html            # 表单页模板
    └── static/                       # 静态文件
        ├── css/                      # 样式文件
        │   ├── reset.css             # CSS重置
        │   ├── variables.css         # CSS变量
        │   ├── layout.css            # 布局样式
        │   └── components.css        # 组件样式
        ├── js/                       # JavaScript文件
        │   ├── core.js               # 核心工具
        │   ├── api.js                # API集成
        │   ├── components.js         # UI组件
        │   └── router.js             # 路由管理
        └── images/                   # 图片资源
```

## 🚀 快速开始

### 1. 配置API

编辑 `references/api-config.md`，配置你的业务系统API：

```yaml
base_url: "https://api.your-business-system.com"
timeout: 30000
```

### 2. 定义数据模型

编辑 `references/data-models.md`，定义业务实体：

```yaml
EntityName:
  description: "实体描述"
  endpoint: "/api/entity"
  fields:
    - name: field_name
      type: string
      required: true
      label: "字段名称"
```

### 3. 构建项目

```bash
cd h5-business-system
node scripts/build.js
```

### 4. 部署

将生成的 `dist/` 目录部署到Web服务器。

## 📱 页面类型

### 列表页 (list-view)
- 支持搜索、筛选、排序
- 支持下拉刷新
- 支持无限滚动加载
- 空状态处理

### 详情页 (detail-view)
- 展示单条数据详情
- 支持编辑跳转
- 分组信息展示

### 表单页 (form-view)
- 创建/编辑数据
- 表单验证
- 字段类型支持：文本、数字、日期、选择器、开关等

## 🎨 UI组件

### 基础组件
- **Button** - 按钮（主要、次要、危险、幽灵）
- **Card** - 卡片容器
- **Badge** - 徽标
- **Tag** - 标签

### 反馈组件
- **Toast** - 轻提示
- **Loading** - 加载遮罩
- **Modal** - 对话框
- **Empty State** - 空状态

### 功能组件
- **Pull to Refresh** - 下拉刷新
- **Infinite Scroll** - 无限滚动
- **Lazy Image** - 图片懒加载

## 🔧 核心功能

### API客户端 (api.js)
- 自动Token管理
- 请求/响应拦截器
- 错误处理和重试
- 请求缓存
- 加载状态管理

### 路由管理 (router.js)
- 客户端路由
- 动态路由参数
- 路由守卫
- 历史管理

### 工具函数 (core.js)
- 日期格式化
- 数字/货币格式化
- 防抖/节流
- 深拷贝
- 表单验证
- LocalStorage封装

## 📝 使用示例

### 创建列表页

```javascript
// 在 router.js 中注册路由
router.register('/orders', async (route) => {
    await router.loadPage('list-view', {
        list_title: '订单列表',
        entity: 'orders'
    });
});
```

### 调用API

```javascript
// 获取列表数据
const result = await api.get('/orders/list', {
    page: 1,
    pageSize: 20,
    keyword: 'search term'
});

// 创建数据
const result = await api.post('/orders/create', {
    customer_name: '张三',
    amount: 1000
});

// 更新数据
const result = await api.put('/orders/update/123', {
    status: 'completed'
});

// 删除数据
const result = await api.delete('/orders/delete/123');
```

### 使用UI组件

```javascript
// Toast提示
toast.success('操作成功');
toast.error('操作失败');
toast.warning('警告信息');
toast.info('提示信息');

// 加载状态
loading.show();
loading.hide();

// 确认对话框
modal.confirm('确定删除吗？', () => {
    // 确认回调
}, () => {
    // 取消回调
});

// Alert对话框
modal.alert('操作完成', () => {
    // 确认回调
});
```

## 🎨 样式系统

### CSS变量

```css
/* 主色调 */
--color-primary: #1890ff;
--color-success: #52c41a;
--color-warning: #faad14;
--color-error: #ff4d4f;

/* 文字颜色 */
--color-text-primary: #262626;
--color-text-secondary: #595959;
--color-text-tertiary: #8c8c8c;

/* 间距 */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 12px;
--spacing-lg: 16px;
--spacing-xl: 20px;

/* 圆角 */
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-full: 9999px;
```

### 响应式断点

- 默认: 14px基础字体
- ≥375px: 15px基础字体
- ≥414px: 16px基础字体

## 🔐 认证

支持多种认证方式：
- Token认证 (Bearer)
- Session认证 (Cookie)
- OAuth 2.0

Token自动管理：
- 自动存储到localStorage
- 自动附加到请求头
- 自动检测过期

## 📦 构建输出

构建后生成 `dist/` 目录：

```
dist/
├── index.html              # 入口页面
├── config.json             # 配置文件
├── README.md               # 部署说明
├── static/                 # 静态资源
│   ├── css/               # 样式文件
│   ├── js/                # JavaScript文件
│   └── images/            # 图片资源
└── [其他页面].html        # 生成的页面
```

## 🌐 浏览器支持

- iOS Safari 12+
- Android Chrome 80+
- 微信内置浏览器
- 其他现代浏览器

## 📋 开发计划

### Phase 1: 基础框架 ✅
- [x] 项目结构搭建
- [x] 基础样式系统
- [x] API客户端
- [x] 路由系统
- [x] 核心UI组件

### Phase 2: 页面模板 ✅
- [x] 列表页模板
- [x] 详情页模板
- [x] 表单页模板
- [x] 基础模板

### Phase 3: 高级功能
- [ ] 图表组件
- [ ] 地图集成
- [ ] 扫码功能
- [ ] 拍照上传
- [ ] 离线缓存

### Phase 4: 优化
- [ ] 性能优化
- [ ] PWA支持
- [ ] 主题切换
- [ ] 多语言支持

## 🤝 贡献

欢迎提交Issue和PR！

## 📄 许可证

MIT License
