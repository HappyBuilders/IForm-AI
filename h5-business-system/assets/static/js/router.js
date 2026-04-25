/**
 * Simple Router - Client-side routing for H5 Business System
 */

const router = {
    routes: {},
    currentRoute: null,
    beforeHooks: [],
    afterHooks: [],
    
    /**
     * Initialize router
     */
    init() {
        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            this.handleRoute(location.pathname + location.search, false);
        });
        
        // Handle initial route
        this.handleRoute(location.pathname + location.search, false);
    },
    
    /**
     * Register route
     * @param {string} path - Route path
     * @param {Function} handler - Route handler
     */
    register(path, handler) {
        this.routes[path] = handler;
    },
    
    /**
     * Register before hook
     * @param {Function} hook - Hook function
     */
    beforeEach(hook) {
        this.beforeHooks.push(hook);
    },
    
    /**
     * Register after hook
     * @param {Function} hook - Hook function
     */
    afterEach(hook) {
        this.afterHooks.push(hook);
    },
    
    /**
     * Navigate to route
     * @param {string} path - Target path
     * @param {boolean} pushState - Whether to push state
     */
    navigate(path, pushState = true) {
        // Run before hooks
        for (const hook of this.beforeHooks) {
            const result = hook(path, this.currentRoute);
            if (result === false) return; // Cancel navigation
        }
        
        if (pushState) {
            history.pushState(null, '', path);
        }
        
        this.handleRoute(path, pushState);
        
        // Run after hooks
        for (const hook of this.afterHooks) {
            hook(path, this.currentRoute);
        }
    },
    
    /**
     * Go back
     */
    back() {
        history.back();
    },
    
    /**
     * Replace current route
     * @param {string} path - Target path
     */
    replace(path) {
        history.replaceState(null, '', path);
        this.handleRoute(path, false);
    },
    
    /**
     * Handle route change
     * @param {string} path - Current path
     * @param {boolean} pushState - Whether state was pushed
     */
    handleRoute(path, pushState) {
        // Parse path and query
        const [pathname, search] = path.split('?');
        const query = utils.parseQuery(search ? `?${search}` : '');
        
        // Find matching route
        const route = this.findRoute(pathname);
        
        if (route) {
            this.currentRoute = {
                path: pathname,
                query,
                params: route.params,
            };
            
            // Execute route handler
            route.handler(this.currentRoute);
        } else {
            // 404 - show not found
            this.showNotFound();
        }
    },
    
    /**
     * Find matching route
     * @param {string} pathname - Path to match
     * @returns {Object|null} Matched route
     */
    findRoute(pathname) {
        // Exact match
        if (this.routes[pathname]) {
            return {
                handler: this.routes[pathname],
                params: {},
            };
        }
        
        // Dynamic route matching
        for (const [routePath, handler] of Object.entries(this.routes)) {
            const params = this.matchPath(pathname, routePath);
            if (params) {
                return { handler, params };
            }
        }
        
        return null;
    },
    
    /**
     * Match dynamic path
     * @param {string} pathname - Actual path
     * @param {string} routePath - Route pattern
     * @returns {Object|null} Extracted params
     */
    matchPath(pathname, routePath) {
        // Convert route pattern to regex
        const paramNames = [];
        const regexPattern = routePath
            .replace(/:([^/]+)/g, (match, name) => {
                paramNames.push(name);
                return '([^/]+)';
            })
            .replace(/\*/g, '(.*)');
        
        const regex = new RegExp(`^${regexPattern}$`);
        const match = pathname.match(regex);
        
        if (!match) return null;
        
        const params = {};
        paramNames.forEach((name, index) => {
            params[name] = match[index + 1];
        });
        
        return params;
    },
    
    /**
     * Show 404 page
     */
    showNotFound() {
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div class="page not-found-page">
                    <div class="empty-state">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <h2>页面不存在</h2>
                        <p>您访问的页面不存在或已被删除</p>
                        <button class="btn-primary" onclick="router.navigate('/')">返回首页</button>
                    </div>
                </div>
            `;
        }
    },
    
    /**
     * Load page content
     * @param {string} templateName - Template name
     * @param {Object} data - Template data
     */
    async loadPage(templateName, data = {}) {
        try {
            const response = await fetch(`templates/${templateName}.html`);
            let template = await response.text();
            
            // Replace template variables
            Object.entries(data).forEach(([key, value]) => {
                template = template.replace(
                    new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
                    value
                );
            });
            
            const app = document.getElementById('app');
            if (app) {
                app.innerHTML = template;
            }
        } catch (error) {
            console.error('Failed to load page:', error);
            toast.error('页面加载失败');
        }
    },
};

// Initialize router on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    router.init();
});
