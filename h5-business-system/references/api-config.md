# API Configuration

Document your business system API endpoints here.

## Base Configuration

```yaml
base_url: "https://api.your-business-system.com"
timeout: 30000  # milliseconds
retry_attempts: 3
content_type: "application/json"
```

## Authentication

### Method: Token-Based (Bearer)

```javascript
// Token is stored in localStorage after login
const token = localStorage.getItem('auth_token');
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

### Login Endpoint

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_at": "2024-12-31T23:59:59Z",
    "user": {
      "id": "user_001",
      "name": "张三",
      "role": "admin"
    }
  }
}
```

## API Endpoints

### 1. 数据列表查询

```http
GET /api/{entity}/list
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | integer | No | Page number (default: 1) |
| pageSize | integer | No | Items per page (default: 20) |
| keyword | string | No | Search keyword |
| sortBy | string | No | Sort field |
| sortOrder | string | No | asc or desc |
| filters | object | No | Filter conditions |

**Response:**
```json
{
  "success": true,
  "data": {
    "list": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### 2. 数据详情查询

```http
GET /api/{entity}/detail/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "item_001",
    "name": "...",
    // ... other fields
  }
}
```

### 3. 数据创建

```http
POST /api/{entity}/create
Content-Type: application/json

{
  // Entity fields
}
```

### 4. 数据更新

```http
PUT /api/{entity}/update/{id}
Content-Type: application/json

{
  // Updated fields
}
```

### 5. 数据删除

```http
DELETE /api/{entity}/delete/{id}
```

## Error Handling

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad Request | Show validation errors |
| 401 | Unauthorized | Redirect to login |
| 403 | Forbidden | Show permission denied |
| 404 | Not Found | Show not found message |
| 500 | Server Error | Show error and retry |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

## Rate Limiting

```yaml
rate_limit:
  requests_per_minute: 60
  burst_limit: 10
```

Handle 429 status code with exponential backoff retry.
