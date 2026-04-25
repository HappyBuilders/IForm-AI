# Data Models

Define your business entities and their fields here.

## Entity Template

Use this template to document each entity:

```yaml
EntityName:
  description: "Brief description"
  endpoint: "/api/entityname"
  fields:
    - name: field_name
      type: string|number|boolean|date|array|object
      required: true|false
      label: "Display Name"
      description: "Field description"
      validation:
        - rule: required
        - rule: minLength: 3
        - rule: maxLength: 50
        - rule: pattern: "^[a-zA-Z0-9]+$"
      ui:
        component: input|textarea|select|date|switch|file
        placeholder: "Hint text"
        options: []  # For select component
```

## Example Entities

### User

```yaml
User:
  description: "系统用户"
  endpoint: "/api/users"
  fields:
    - name: id
      type: string
      required: true
      label: "用户ID"
      
    - name: username
      type: string
      required: true
      label: "用户名"
      validation:
        - rule: required
        - rule: minLength: 3
        - rule: maxLength: 20
      ui:
        component: input
        placeholder: "请输入用户名"
        
    - name: email
      type: string
      required: true
      label: "邮箱"
      validation:
        - rule: required
        - rule: email
      ui:
        component: input
        placeholder: "请输入邮箱"
        
    - name: phone
      type: string
      required: false
      label: "手机号"
      validation:
        - rule: pattern: "^1[3-9]\\d{9}$"
      ui:
        component: input
        placeholder: "请输入手机号"
        
    - name: status
      type: string
      required: true
      label: "状态"
      ui:
        component: select
        options:
          - value: active
            label: "启用"
          - value: inactive
            label: "禁用"
          - value: pending
            label: "待审核"
            
    - name: created_at
      type: date
      required: true
      label: "创建时间"
      ui:
        component: date
        format: "YYYY-MM-DD HH:mm"
        
    - name: avatar
      type: string
      required: false
      label: "头像"
      ui:
        component: file
        accept: "image/*"
```

### Order

```yaml
Order:
  description: "订单"
  endpoint: "/api/orders"
  fields:
    - name: id
      type: string
      required: true
      label: "订单号"
      
    - name: customer_name
      type: string
      required: true
      label: "客户名称"
      ui:
        component: input
        searchable: true
        
    - name: amount
      type: number
      required: true
      label: "金额"
      validation:
        - rule: required
        - rule: min: 0
      ui:
        component: input
        type: number
        prefix: "¥"
        
    - name: status
      type: string
      required: true
      label: "订单状态"
      ui:
        component: select
        options:
          - value: pending
            label: "待处理"
            color: "#faad14"
          - value: processing
            label: "处理中"
            color: "#1890ff"
          - value: completed
            label: "已完成"
            color: "#52c41a"
          - value: cancelled
            label: "已取消"
            color: "#ff4d4f"
            
    - name: items
      type: array
      required: true
      label: "订单明细"
      itemType: OrderItem
      ui:
        component: table
        
    - name: created_at
      type: date
      required: true
      label: "下单时间"
      ui:
        component: date
        sortable: true
```

### OrderItem

```yaml
OrderItem:
  description: "订单明细项"
  fields:
    - name: product_id
      type: string
      required: true
      label: "商品ID"
      
    - name: product_name
      type: string
      required: true
      label: "商品名称"
      
    - name: quantity
      type: number
      required: true
      label: "数量"
      validation:
        - rule: required
        - rule: min: 1
        - rule: integer
      ui:
        component: input
        type: number
        
    - name: unit_price
      type: number
      required: true
      label: "单价"
      ui:
        component: input
        type: number
        prefix: "¥"
        
    - name: total_price
      type: number
      required: true
      label: "小计"
      ui:
        component: text
        computed: "quantity * unit_price"
        prefix: "¥"
```

## Field Types

| Type | Description | UI Components |
|------|-------------|---------------|
| string | 文本字符串 | input, textarea, select |
| number | 数字（整数或小数） | input[type=number] |
| boolean | 布尔值 | switch, checkbox |
| date | 日期时间 | date, datetime |
| array | 数组 | table, list |
| object | 对象 | form, card |
| file | 文件 | file upload |
| image | 图片 | image upload, image preview |

## Validation Rules

| Rule | Description | Example |
|------|-------------|---------|
| required | 必填 | `required` |
| minLength | 最小长度 | `minLength: 3` |
| maxLength | 最大长度 | `maxLength: 50` |
| min | 最小值 | `min: 0` |
| max | 最大值 | `max: 100` |
| pattern | 正则匹配 | `pattern: "^[a-z]+$"` |
| email | 邮箱格式 | `email` |
| url | URL格式 | `url` |
| integer | 整数 | `integer` |

## Relationships

```yaml
Order:
  relationships:
    - type: belongsTo
      entity: User
      foreignKey: user_id
      
    - type: hasMany
      entity: OrderItem
      foreignKey: order_id
```
