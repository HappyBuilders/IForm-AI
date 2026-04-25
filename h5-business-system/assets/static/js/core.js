/**
 * Core Utilities - Common functions for H5 Business System
 */

// Utility functions
const utils = {
    /**
     * Format date
     * @param {string|Date} date - Date to format
     * @param {string} format - Format pattern
     * @returns {string} Formatted date string
     */
    formatDate(date, format = 'YYYY-MM-DD HH:mm') {
        if (!date) return '-';
        
        const d = new Date(date);
        if (isNaN(d.getTime())) return '-';
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    },
    
    /**
     * Format number with commas
     * @param {number} num - Number to format
     * @param {number} decimals - Decimal places
     * @returns {string} Formatted number
     */
    formatNumber(num, decimals = 0) {
        if (num === null || num === undefined) return '-';
        
        const n = parseFloat(num);
        if (isNaN(n)) return '-';
        
        const parts = n.toFixed(decimals).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        
        return parts.join('.');
    },
    
    /**
     * Format currency
     * @param {number} amount - Amount
     * @param {string} symbol - Currency symbol
     * @returns {string} Formatted currency
     */
    formatCurrency(amount, symbol = '¥') {
        if (amount === null || amount === undefined) return '-';
        return `${symbol}${this.formatNumber(amount, 2)}`;
    },
    
    /**
     * Debounce function
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in ms
     * @returns {Function} Debounced function
     */
    debounce(fn, delay = 300) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },
    
    /**
     * Throttle function
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Limit in ms
     * @returns {Function} Throttled function
     */
    throttle(fn, limit = 300) {
        let inThrottle = false;
        return function(...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },
    
    /**
     * Deep clone object
     * @param {Object} obj - Object to clone
     * @returns {Object} Cloned object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    },
    
    /**
     * Check if element is in viewport
     * @param {Element} el - DOM element
     * @returns {boolean} Is in viewport
     */
    isInViewport(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    },
    
    /**
     * Generate unique ID
     * @returns {string} Unique ID
     */
    generateId() {
        return `_${Math.random().toString(36).substr(2, 9)}`;
    },
    
    /**
     * Parse query string
     * @param {string} query - Query string
     * @returns {Object} Parsed params
     */
    parseQuery(query = window.location.search) {
        const params = {};
        const searchParams = new URLSearchParams(query);
        
        for (const [key, value] of searchParams) {
            if (params[key]) {
                if (Array.isArray(params[key])) {
                    params[key].push(value);
                } else {
                    params[key] = [params[key], value];
                }
            } else {
                params[key] = value;
            }
        }
        
        return params;
    },
    
    /**
     * Build query string
     * @param {Object} params - Parameters object
     * @returns {string} Query string
     */
    buildQuery(params) {
        const searchParams = new URLSearchParams();
        
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                if (Array.isArray(value)) {
                    value.forEach(v => searchParams.append(key, v));
                } else {
                    searchParams.append(key, value);
                }
            }
        });
        
        const query = searchParams.toString();
        return query ? `?${query}` : '';
    },
    
    /**
     * Validate form data
     * @param {Object} data - Form data
     * @param {Object} rules - Validation rules
     * @returns {Object} Validation result
     */
    validate(data, rules) {
        const errors = {};
        
        Object.entries(rules).forEach(([field, fieldRules]) => {
            const value = data[field];
            
            fieldRules.forEach(rule => {
                if (rule.required && (!value || (typeof value === 'string' && !value.trim()))) {
                    errors[field] = rule.message || `${field} is required`;
                }
                
                if (rule.minLength && value && value.length < rule.minLength) {
                    errors[field] = rule.message || `${field} must be at least ${rule.minLength} characters`;
                }
                
                if (rule.maxLength && value && value.length > rule.maxLength) {
                    errors[field] = rule.message || `${field} must be at most ${rule.maxLength} characters`;
                }
                
                if (rule.pattern && value && !rule.pattern.test(value)) {
                    errors[field] = rule.message || `${field} format is invalid`;
                }
                
                if (rule.email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                    errors[field] = rule.message || 'Invalid email format';
                }
                
                if (rule.phone && value && !/^1[3-9]\d{9}$/.test(value)) {
                    errors[field] = rule.message || 'Invalid phone number';
                }
            });
        });
        
        return {
            valid: Object.keys(errors).length === 0,
            errors,
        };
    },
    
    /**
     * Local storage wrapper with JSON support
     */
    storage: {
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        },
        
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        
        remove(key) {
            localStorage.removeItem(key);
        },
        
        clear() {
            localStorage.clear();
        },
    },
    
    /**
     * Session storage wrapper
     */
    session: {
        get(key, defaultValue = null) {
            try {
                const item = sessionStorage.getItem(key);
                return item ?