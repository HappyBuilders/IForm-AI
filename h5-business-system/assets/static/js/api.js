/**
 * API Client - Business System Integration
 * Handles all API requests with authentication, caching, and error handling
 */

const api = {
    // Configuration
    config: {
        baseURL: '', // Set from api-config.md
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
    },
    
    // Request cache
    cache: new Map(),
    cacheTimeout: 60000, // 1 minute
    
    /**
     * Initialize API client with configuration
     * @param {Object} config - Configuration object
     */
    init(config = {}) {
        this.config = { ...this.config, ...config };
        
        // Load token from storage
        this.token = localStorage.getItem('auth_token');
        this.tokenExpiry = localStorage.getItem('token_expiry');
        
        // Check if token is expired
        if (this.tokenExpiry && new Date(this.tokenExpiry) <= new Date()) {
            this.clearAuth();
        }
    },
    
    /**
     * Get request headers
     * @returns {Object} Headers object
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        return headers;
    },
    
    /**
     * Build full URL
     * @param {string} endpoint - API endpoint
     * @returns {string} Full URL
     */
    buildURL(endpoint) {
        const baseURL = this.config.baseURL.replace(/\/$/, '');
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${baseURL}${path}`;
    },
    
    /**
     * Build query string from params
     * @param {Object} params - Query parameters
     * @returns {string} Query string
     */
    buildQueryString(params = {}) {
        const query = Object.entries(params)
            .filter(([_, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => {
                if (Array.isArray(value)) {
                    return value.map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join('&');
                }
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            })
            .join('&');
        
        return query ? `?${query}` : '';
    },
    
    /**
     * Make HTTP request
     * @param {string} method - HTTP method
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body
     * @param {Object} options - Request options
     * @returns {Promise} Response promise
     */
    async request(method, endpoint, data = null, options = {}) {
        const url = this.buildURL(endpoint) + this.buildQueryString(options.params);
        const cacheKey = `${method}:${url}:${JSON.stringify(data)}`;
        
        // Check cache for GET requests
        if (method === 'GET' && !options.noCache) {
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        const requestOptions = {
            method,
            headers: this.getHeaders(),
            ...options.fetchOptions,
        };
        
        if (data && method !== 'GET') {
            requestOptions.body = JSON.stringify(data);
        }
        
        // Show loading
        if (options.showLoading !== false) {
            loading.show();
        }
        
        try {
            const response = await this.fetchWithTimeout(url, requestOptions, this.config.timeout);
            const result = await this.handleResponse(response);
            
            // Cache GET responses
            if (method === 'GET' && !options.noCache) {
                this.cache.set(cacheKey, {
                    data: result,
                    timestamp: Date.now(),
                });
            }
            
            return result;
        } catch (error) {
            return this.handleError(error, method, endpoint, data, options);
        } finally {
            if (options.showLoading !== false) {
                loading.hide();
            }
        }
    },
    
    /**
     * Fetch with timeout
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @param {number} timeout - Timeout in ms
     * @returns {Promise} Fetch promise
     */
    fetchWithTimeout(url, options, timeout) {
        return Promise.race([
            fetch(url, options),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout')), timeout)
            ),
        ]);
    },
    
    /**
     * Handle HTTP response
     * @param {Response} response - Fetch response
     * @returns {Promise} Parsed response
     */
    async handleResponse(response) {
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        
        if (!response.ok) {
            throw {
                status: response.status,
                statusText: response.statusText,
                data,
            };
        }
        
        return data;
    },
    
    /**
     * Handle request error
     * @param {Error} error - Error object
     * @param {string} method - HTTP method
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request data
     * @param {Object} options - Request options
     * @returns {Promise} Retry or reject
     */
    async handleError(error, method, endpoint, data, options) {
        // Handle network errors
        if (error.message === 'Request timeout') {
            toast.error('请求超时，请重试');
            throw error;
        }
        
        if (error.message === 'Failed to fetch') {
            toast.error('网络连接失败，请检查网络');
            throw error;
        }
        
        // Handle HTTP errors
        if (error.status) {
            switch (error.status) {
                case 401:
                    // Unauthorized - clear auth and redirect to login
                    this.clearAuth();
                    toast.error('登录已过期，请重新登录');
                    router.navigate('/login');
                    break;
                    
                case 403:
                    toast.error('没有权限执行此操作');
                    break;
                    
                case 404:
                    toast.error('请求的资源不存在');
                    break;
                    
                case 422:
                    // Validation error
                    const messages = error.data?.error?.details?.map(d => d.message) || ['数据验证失败'];
                    toast.error(messages.join(', '));
                    break;
                    
                case 429:
                    toast.error('请求过于频繁，请稍后再试');
                    break;
                    
                case 500:
                case 502:
                case 503:
                case 504:
                    toast.error('服务器错误，请稍后重试');
                    break;
                    
                default:
                    toast.error(error.data?.error?.message || '请求失败');
            }
            
            // Retry on server errors (5xx)
            if (error.status >= 500 && options.retry !== false) {
                return this.retry(method, endpoint, data, options);
            }
            
            throw error;
        }
        
        throw error;
    },
    
    /**
     * Retry failed request
     * @param {string} method - HTTP method
     * @