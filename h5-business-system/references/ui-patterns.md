# UI Patterns

Common UI patterns for H5 business applications.

## 1. List Page Pattern

### Layout Structure

```
┌─────────────────────────────┐
│  ← Back    Page Title   [+] │  Header
├─────────────────────────────┤
│  [Search...] [Filter ▼]     │  Search Bar
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │ [Icon] Title        │    │
│  │ Description         │    │  List Item
│  │ Tag1 Tag2    Status │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ [Icon] Title        │    │
│  │ Description         │    │  List Item
│  │ Tag1 Tag2    Status │    │
│  └─────────────────────┘    │
│                             │
│         Loading...          │  Loading State
│                             │
├─────────────────────────────┤
│  < 1 2 3 ... 10 >           │  Pagination (or Load More)
└─────────────────────────────┘
```

### Implementation

```html
<!-- list-view.html template -->
<div class="page list-page">
  <header class="page-header">
    <button class="btn-back">←</button>
    <h1 class="page-title">列表标题</h1>
    <button class="btn-add">+</button>
  </header>
  
  <div class="search-bar">
    <input type="search" placeholder="搜索..." class="search-input">
    <button class="btn-filter">筛选 ▼</button>
  </div>
  
  <div class="list-container">
    <!-- List items rendered here -->
  </div>
  
  <div class="pagination">
    <!-- Pagination controls -->
  </div>
</div>
```

### Features
- Pull-to-refresh
- Infinite scroll (alternative to pagination)
- Empty state
- Loading skeleton
- Swipe actions (optional)

## 2. Detail Page Pattern

### Layout Structure

```
┌─────────────────────────────┐
│  ← Back    Page Title   [Edit]│  Header
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │     [Large Image]   │    │  Hero Section
│  │     Title           │    │
│  │     Subtitle        │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ Section 1           │    │
│  │ ─────────────────── │    │
│  │ Label:    Value     │    │  Info Section
│  │ Label:    Value     │    │
│  │ Label:    Value     │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ Section 2           │    │
│  │ ─────────────────── │    │  Related List
│  │ Item 1         >    │    │
│  │ Item 2         >    │    │
│  │ Item 3         >    │    │
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  [    Primary Action    ]   │  Bottom Action
└─────────────────────────────┘
```

### Implementation

```html
<div class="page detail-page">
  <header class="page-header">
    <button class="btn-back">←</button>
    <h1 class="page-title">详情</h1>
    <button class="btn-edit">编辑</button>
  </header>
  
  <div class="detail-content">
    <section class="hero-section">
      <!-- Hero content -->
    </section>
    
    <section class="info-section">
      <h2>基本信息</h2>
      <div class="info-grid">
        <div class="info-item">
          <label>字段1</label>
          <value>值1</value>
        </div>
        <!-- More items -->
      </div>
    </section>
    
    <section class="related-section">
      <h2>关联信息</h2>
      <!-- Related items -->
    </section>
  </div>
  
  <div class="bottom-action">
    <button class="btn-primary">主要操作</button>
  </div>
</div>
```

## 3. Form Page Pattern

### Layout Structure

```
┌─────────────────────────────┐
│  ← Back    Page Title   [Save]│  Header
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │ * 字段名称          │    │
│  │ ┌─────────────────┐ │    │
│  │ │                 │ │    │  Input Field
│  │ └─────────────────┘ │    │
│  │ 提示文字            │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │   字段名称          │    │
│  │ ┌─────────────────┐ │    │
│  │ │ 请选择 ▼        │ │    │  Select Field
│  │ └─────────────────┘ │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │   字段名称          │    │
│  │ ┌─────────────────┐ │    │
│  │ │                 │ │    │  Textarea
│  │ │                 │ │    │
│  │ └─────────────────┘ │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │   开关选项     [○━━]│    │  Switch
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │   上传图片          │    │
│  │ ┌────┐ ┌────┐ ┌───┐ │    │
│  │ │ +  │ │ 📷 │ │ 📷│ │    │  File Upload
│  │ └────┘ └────┘ └───┘ │    │
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  [      提交表单      ]     │  Submit Button
└─────────────────────────────┘
```

### Form Validation States

```
Normal:     ┌─────────────────┐
            │                 │
            └─────────────────┘

Focus:      ┌─────────────────┐
            │ |               │  (cursor blinking)
            └─────────────────┘
            (blue border)

Error:      ┌─────────────────┐
            │ invalid value   │
            └─────────────────┘
            (red border)
            ⚠️ 错误提示信息

Success:    ┌─────────────────┐
            │ valid value     │
            └─────────────────┘
            (green border) ✓
```

## 4. Dashboard Pattern

### Layout Structure

```
┌─────────────────────────────┐
│  Menu ☰   Dashboard    👤   │  Header
├─────────────────────────────┤
│                             │
│  ┌─────┐ ┌─────┐ ┌─────┐   │
│  │ KPI │ │ KPI │ │ KPI │   │  KPI Cards
│  │ 123 │ │ 456 │ │ 789 │   │
│  └─────┘ └─────┘ └─────┘   │
│                             │
│  ┌─────────────────────┐    │
│  │     [Chart]         │    │
│  │                     │    │  Chart Section
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ 快捷入口            │    │
│  │ ┌──┐ ┌──┐ ┌──┐ ┌──┐│    │  Quick Actions
│  │ │📋│ │📊│ │⚙️ │ │👥││    │
│  │ └──┘ └──┘ └──┘ └──┘│    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ 最近活动            │    │
│  │ ─────────────────── │    │  Recent Activity
│  │ ● 活动1        2分钟│    │
│  │ ● 活动2       1小时 │    │
│  │ ● 活动3       昨天  │    │
│  └─────────────────────┘    │
│                             │
└─────────────────────────────┘
```

## 5. Search & Filter Pattern

### Search Bar Variants

```
Simple:     ┌─────────────────────────────┐
            │ 🔍 搜索关键词...        [X] │
            └─────────────────────────────┘

With Filter:┌────────────────────┬────────┐
            │ 🔍 搜索...         │筛选 ▼ │
            └────────────────────┴────────┘

Advanced:   ┌─────────────────────────────┐
            │ 🔍 搜索...              [X] │
            ├─────────────────────────────┤
            │ [分类 ▼] [状态 ▼] [时间 ▼]  │
            └─────────────────────────────┘
```

### Filter Panel

```
┌─────────────────────────────┐
│  筛选条件              [X]  │
├─────────────────────────────┤
│ 分类                        │
│ ○ 全部  ● 分类A  ○ 分类B   │
│                             │
│ 状态                        │
│ [√] 启用  [ ] 禁用          │
│                             │
│ 时间范围                    │
│ [开始日期] ~ [结束日期]     │
│                             │
│ 价格区间                    │
│ [  100  ] ~ [  500  ]       │
│ ─○────────●──────────────── │
│                             │
├─────────────────────────────┤
│  [  重置  ]    [  确定  ]   │
└─────────────────────────────┘
```

## 6. Empty State