/**
 * UI Components - Reusable components for H5 Business System
 */

// Toast notifications
const toast = {
    container: null,
    
    init() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },
    
    show(message, type = 'info', duration = 3000) {
        this.init();
        
        const toastEl = document.createElement('div');
        toastEl.className = `toast toast-${type}`;
        toastEl.innerHTML = `
            <span class="toast-message">${message}</span>
        `;
        
        this.container.appendChild(toastEl);
        
        // Trigger animation
        requestAnimationFrame(() => {
            toastEl.classList.add('show');
        });
        
        // Auto remove
        setTimeout(() => {
            toastEl.classList.remove('show');
            setTimeout(() => {
                toastEl.remove();
            }, 300);
        }, duration);
    },
    
    success(message, duration) {
        this.show(message, 'success', duration);
    },
    
    error(message, duration) {
        this.show(message, 'error', duration);
    },
    
    warning(message, duration) {
        this.show(message, 'warning', duration);
    },
    
    info(message, duration) {
        this.show(message, 'info', duration);
    },
};

// Loading overlay
const loading = {
    el: null,
    
    init() {
        this.el = document.getElementById('loading-overlay');
    },
    
    show() {
        this.init();
        if (this.el) {
            this.el.classList.remove('hidden');
        }
    },
    
    hide() {
        if (this.el) {
            this.el.classList.add('hidden');
        }
    },
};

// Modal/Dialog
const modal = {
    show(options = {}) {
        const {
            title = '',
            content = '',
            confirmText = '确定',
            cancelText = '取消',
            showCancel = true,
            onConfirm = null,
            onCancel = null,
        } = options;
        
        const modalEl = document.createElement('div');
        modalEl.className = 'modal-overlay';
        modalEl.innerHTML = `
            <div class="modal">
                ${title ? `<div class="modal-header">${title}</div>` : ''}
                <div class="modal-content">${content}</div>
                <div class="modal-footer">
                    ${showCancel ? `<button class="btn-cancel">${cancelText}</button>` : ''}
                    <button class="btn-confirm">${confirmText}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalEl);
        
        // Trigger animation
        requestAnimationFrame(() => {
            modalEl.classList.add('show');
        });
        
        // Event handlers
        const close = () => {
            modalEl.classList.remove('show');
            setTimeout(() => modalEl.remove(), 300);
        };
        
        if (showCancel) {
            modalEl.querySelector('.btn-cancel').addEventListener('click', () => {
                close();
                if (onCancel) onCancel();
            });
        }
        
        modalEl.querySelector('.btn-confirm').addEventListener('click', () => {
            close();
            if (onConfirm) onConfirm();
        });
        
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) {
                close();
                if (onCancel) onCancel();
            }
        });
    },
    
    confirm(message, onConfirm, onCancel) {
        this.show({
            content: message,
            onConfirm,
            onCancel,
        });
    },
    
    alert(message, onConfirm) {
        this.show({
            content: message,
            showCancel: false,
            onConfirm,
        });
    },
};

// Pull to refresh
const pullToRefresh = {
    init(callback) {
        const container = document.querySelector('.list-container');
        if (!container) return;
        
        let startY = 0;
        let currentY = 0;
        let isPulling = false;
        const threshold = 80;
        
        container.addEventListener('touchstart', (e) => {
            if (container.scrollTop === 0) {
                startY = e.touches[0].clientY;
                isPulling = true;
            }
        }, { passive: true });
        
        container.addEventListener('touchmove', (e) => {
            if (!isPulling) return;
            
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            
            if (diff > 0 && container.scrollTop === 0) {
                e.preventDefault();
                
                const indicator = document.getElementById('pull-refresh');
                if (indicator) {
                    indicator.classList.remove('hidden');
                    indicator.style.transform = `translateY(${Math.min(diff / 2, threshold)}px)`;
                    
                    if (diff >= threshold) {
                        indicator.classList.add('ready');
                    } else {
                        indicator.classList.remove('ready');
                    }
                }
            }
        }, { passive: false });
        
        container.addEventListener('touchend', () => {
            if (!isPulling) return;
            
            isPulling = false;
            const diff = currentY - startY;
            
            const indicator = document.getElementById('pull-refresh');
            if (indicator) {
                if (diff >= threshold && callback) {
                    indicator.classList.add('loading');
                    callback().then(() => {
                        indicator.classList.remove('loading', 'ready');
                        indicator.style.transform = '';
                        indicator.classList.add('hidden');
                    });
                } else {
                    indicator.style.transform = '';
                    indicator.classList.add('hidden');
                }
            }
        });
    },
};

// Infinite scroll
const infiniteScroll = {
    init(callback) {
        const container = document.querySelector('.list-container');
        if (!container) return;
        
        let isLoading = false;
        
        container.addEventListener('scroll', utils.throttle(async () => {
            if (isLoading) return;
            
            const scrollBottom = container.scrollTop + container.clientHeight;
            const threshold = container.scrollHeight - 100;
            
            if (scrollBottom >= threshold) {
                isLoading = true;
                
                const loadMore = document.getElementById('load-more');
                if (loadMore) loadMore.classList.remove('hidden');
                
                await callback();
                
                isLoading = false;
            }
        }, 200));
    },
};

// Image lazy load
const lazyImage = {
    init() {
        const images = document.querySelectorAll('img[data-src]');
        
        const loadImage = (img) => {
            const src = img.dataset.src;
            if (src) {
                img.src = src;
                img.removeAttribute('data-src');
            }
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    loadImage(entry.target);
