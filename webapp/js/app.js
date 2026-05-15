// =============================================
// Global Error Handler - prevents Telegram WebApp from closing on JS errors
// =============================================
window.addEventListener('error', function(e) {
    console.error('Global JS error:', e.message, e.filename, e.lineno);
    // Prevent Telegram from closing the WebApp
    e.preventDefault();
    return true;
});
window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    e.preventDefault();
});

// =============================================
// API Helper Functions
// =============================================

async function apiCall(method, endpoint, data = null) {
    try {
        const url = CONFIG.API_URL + endpoint;
        const config = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;  // axios очікує об'єкт, не JSON string
        }

        const response = await axios(url, config);
        return response.data;
    } catch (error) {
        console.error(`API Error [${method} ${endpoint}]:`, error);
        console.error('Error details:', error.response?.data);
        if (error.response?.status === 404) {
            throw new Error('Ресурс не знайдено');
        } else if (error.response?.status === 401) {
            throw new Error('Невалідна авторизація');
        } else if (error.response?.status === 400) {
            throw new Error(error.response.data?.detail || 'Помилка запиту');
        }
        throw error;
    }
}

function isAgeVerified(user) {
    return Boolean(user?.isAgeVerified ?? user?.is_age_verified);
}

function showAgeGate() {
    if (document.getElementById('ageGate')) {
        return;
    }

    const gate = document.createElement('div');
    gate.id = 'ageGate';
    gate.className = 'age-gate-backdrop';
    gate.innerHTML = `
        <div class="age-gate-card">
            <h3>🔞 Тільки 18+</h3>
            <p>Підтверди, що тобі 18+, щоб продовжити.</p>
            <button type="button" id="ageGateConfirm">Мені 18+</button>
        </div>
    `;

    document.body.appendChild(gate);

    const confirmButton = document.getElementById('ageGateConfirm');
    if (confirmButton) {
        confirmButton.addEventListener('click', confirmAgeVerification);
    }
}

function hideAgeGate() {
    const gate = document.getElementById('ageGate');
    if (gate) {
        gate.remove();
    }
}

async function confirmAgeVerification() {
    try {
        showLoading(true);
        const initData = window.Telegram?.WebApp?.initData || '';
        const result = await apiCall('POST', '/users/age-verify', { init_data: initData });
        if (result?.user) {
            localStorage.setItem('currentUser', JSON.stringify(result.user));
        }
        hideAgeGate();
        showToast('✅ Вік підтверджено');
    } catch (error) {
        console.error('Age verification failed:', error);
        showToast('❌ Не вдалося підтвердити вік');
    } finally {
        showLoading(false);
    }
}

function ensureAgeGate() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (isAgeVerified(currentUser)) {
        hideAgeGate();
        return;
    }
    showAgeGate();
}

function getCurrentTelegramId() {
    const telegramUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    return telegramUser.id || currentUser.telegramId || currentUser.telegram_id || null;
}

function getAdminHeaders() {
    const adminId = getCurrentTelegramId();
    return adminId ? { adminId } : {};
}

// Helper function to check if user is an admin
function isCurrentUserAdmin() {
    const userId = getCurrentTelegramId();
    if (!userId) return false;

    // Parse ADMIN_ID as comma-separated list (convert to string first)
    const adminIds = String(CONFIG.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);
    return adminIds.some(id => String(id) === String(userId));
}

function blockNonTelegramAccess() {
    document.body.innerHTML = `
        <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; font-family: sans-serif;">
            <div style="max-width: 420px; background: #fff6f6; border: 1px solid #ffd3d3; border-radius: 12px; padding: 24px;">
                <h2 style="margin: 0 0 8px;">Відкрий у Telegram</h2>
                <p style="margin: 0; color: #444;">Цей магазин працює тільки в Telegram WebApp.</p>
            </div>
        </div>
    `;
    document.body.dataset.tgBlocked = 'true';
}

// =============================================
// Main App Logic
// =============================================

let currentPage = 'home';
let deliveryEstimateTimeout = null;
let lastDeliveryEstimateAddress = '';
let lastDeliveryEstimate = null;

// Ініціалізація при завантаженні сторінки
document.addEventListener('DOMContentLoaded', async () => {
    // Ініціалізація Telegram користувача
    await initTelegramUser();

    if (document.body.dataset.tgBlocked === 'true') {
        return;
    }

    ensureAgeGate();

    // Завантаження збережених налаштувань
    localStorage.setItem('vaper_language', 'uk'); // Тільки українська
    const savedTheme = localStorage.getItem('vaper_theme') || 'light';

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        document.getElementById('darkTheme').classList.add('active');
        document.getElementById('lightTheme').classList.remove('active');
    }

    // Завантаження товарів
    await products.loadProducts();
    products.renderProducts();

    // Render dynamic category menu from CONFIG
    if (typeof renderCategoryMenu === 'function') {
        renderCategoryMenu();
    }

    // Оновлення UI кошика
    cart.updateCartUI();

    // Слухачі подій
    setupEventListeners();

    // Перевірка адміна та приховування кнопки
    checkAndHideAdminButton();

    // Ініціалізація каталогу - прихування меню рідин та списку товарів
    const productsView = document.getElementById('productsView');
    const brandMenu = document.getElementById('brandMenu');
    if (productsView) productsView.classList.add('products-view-hidden');
    if (brandMenu) brandMenu.classList.add('brand-menu-hidden');

    // Завантаження сторінки за замовчуванням
    navigateTo('home');
});

function setupEventListeners() {
    // Поле пошуку
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (e.target.value.trim()) {
                products.searchProducts(e.target.value);
            } else {
                products.filteredProducts = [...products.products];
            }
            products.renderProducts();
        });
    }

    // Кнопки навігації (з перевіркою наявності елементів)
    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) cartBtn.addEventListener('click', () => navigateTo('cart'));

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => navigateTo('settings'));

    const deliveryAddressInput = document.getElementById('deliveryAddress');
    if (deliveryAddressInput) {
        deliveryAddressInput.addEventListener('input', () => {
            scheduleDeliveryEstimate(deliveryAddressInput.value.trim());
        });
        deliveryAddressInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                deliveryAddressInput.blur();
            }
        });
        // Автоматично додаємо "Wroclaw" при завершенні введення
        deliveryAddressInput.addEventListener('blur', () => {
            const value = deliveryAddressInput.value.trim();
            if (value && !value.toLowerCase().includes('wroclaw')) {
                deliveryAddressInput.value = `${value}, Wroclaw`;
                // Запустити оцінку доставки з оновленою адресою
                scheduleDeliveryEstimate(deliveryAddressInput.value.trim());
            }
        });
    }

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!target.closest('input, textarea, select')) {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
                active.blur();
            }
        }
    });
}

// Render category menu in catalog page based on CONFIG.CATEGORIES
function renderCategoryMenu() {
    try {
        const container = document.getElementById('categoryMenu');
        if (!container || !Array.isArray(CONFIG.CATEGORIES)) return;

        container.innerHTML = CONFIG.CATEGORIES.map(cat => {
            const subtitle = Array.isArray(cat.subcats) && cat.subcats.length ? cat.subcats[0] : '';
            return `
                <div class="menu-item-large" onclick="selectCategory('${cat.id}')">
                    <div class="menu-icon-large">${cat.emoji || ''}</div>
                    <h3>${cat.name}</h3>
                    <p>${subtitle}</p>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('renderCategoryMenu error:', e);
    }
}

// Populate admin product category select when admin form is rendered
function populateAdminCategorySelect() {
    try {
        const sel = document.getElementById('adminProductCategory');
        if (!sel || !Array.isArray(CONFIG.CATEGORIES)) return;

        // Clear existing options except the first placeholder
        const placeholder = sel.querySelector('option[value=""]');
        sel.innerHTML = '';
        sel.appendChild(placeholder || document.createElement('option'));
        if (!placeholder) {
            sel.children[0].value = '';
            sel.children[0].textContent = '-- Вибери категорію --';
        }

        CONFIG.CATEGORIES.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}`;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('populateAdminCategorySelect error:', e);
    }
}

// Observe adminContent to populate admin selects when admin tabs are rendered
function observeAdminContentForForms() {
    const adminContent = document.getElementById('adminContent');
    if (!adminContent || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.addedNodes && m.addedNodes.length) {
                if (document.getElementById('adminProductCategory')) {
                    populateAdminCategorySelect();
                }
            }
        }
    });
    mo.observe(adminContent, { childList: true, subtree: true });
}

// Start observing adminContent after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    observeAdminContentForForms();
});

window.navigateTo = function (page) {
    // Приховування всіх сторінок
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });

    // Показування вибраної сторінки
    const pageElement = document.getElementById(page + 'Page');
    if (pageElement) {
        pageElement.classList.add('active');
    }

    // Оновлення активної кнопки навігації
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Знаходимо кнопку за onclick атрибутом
    const navBtns = document.querySelectorAll('.nav-btn');
    for (let btn of navBtns) {
        const onclick = btn.getAttribute('onclick') || '';
        // Перевіряємо чи в onclick міститься nossa сторінка
        if (onclick.includes(`navigateTo('${page}')`) ||
            (page === 'admin' && onclick.includes('checkAdmin'))) {
            btn.classList.add('active');
            break;
        }
    }

    currentPage = page;

    // Завантаження даних при переході на сторінку
    if (page === 'catalog') {
        // Скидаємо до категоріального меню
        const categoryMenu = document.getElementById('categoryMenu');
        const brandMenu = document.getElementById('brandMenu');
        const productsView = document.getElementById('productsView');

        if (categoryMenu) categoryMenu.style.display = 'grid';
        if (brandMenu) brandMenu.classList.add('brand-menu-hidden');
        if (productsView) productsView.classList.add('products-view-hidden');
    } else if (page === 'history') {
        loadOrderHistory();
    } else if (page === 'checkout') {
        displayCheckoutItems();
        setupPaymentMethodListeners();
    }

    // Прокручування до верху
    window.scrollTo(0, 0);
}

window.showLoading = function (show = true) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.style.display = 'flex';
    } else {
        loading.style.display = 'none';
    }
}

window.showToast = function (message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// Функція для швидкого додавання в кошик з каталогу
window.quickAddToCart = function (event, productId) {
    event.stopPropagation(); // Зупиняємо спливання події щоб не відкрити деталі

    const product = products.getProductById(productId);
    if (product) {
        cart.addItem(product, 1);
    }
}

// Пагінований рендеринг товарів в адмін панелі
let adminProductsPage = 0;
const ADMIN_PRODUCTS_PER_PAGE = 20;

window.renderAdminProductsList = function (page) {
    try {
    if (page !== undefined) adminProductsPage = page;

    const searchInput = document.getElementById('adminProductSearch');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let filtered = Array.isArray(products.products) ? products.products : [];
    if (query) {
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(query) ||
            (p.category && p.category.toLowerCase().includes(query))
        );
    }

    const totalPages = Math.ceil(filtered.length / ADMIN_PRODUCTS_PER_PAGE);
    if (adminProductsPage >= totalPages) adminProductsPage = Math.max(0, totalPages - 1);

    const start = adminProductsPage * ADMIN_PRODUCTS_PER_PAGE;
    const pageItems = filtered.slice(start, start + ADMIN_PRODUCTS_PER_PAGE);

    const productsList = document.getElementById('adminProductsList');
    if (!productsList) return;

    if (pageItems.length === 0) {
        productsList.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-light);">Товари не знайдені</p>';
    } else {
        const fragment = document.createDocumentFragment();
        pageItems.forEach(p => {
            const row = document.createElement('div');
            row.style.cssText = 'background:var(--light);padding:12px;border-radius:8px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;';

            // Ліва частина
            const left = document.createElement('div');
            left.style.flex = '1';

            // Зображення або емодзі
            if (p.imageUrl) {
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.src = p.imageUrl;
                img.style.cssText = 'width:50px;height:50px;object-fit:cover;border-radius:8px;margin-right:10px;vertical-align:middle;cursor:pointer;';
                img.onclick = () => editProductImage(p.id);
                img.onerror = function() { this.style.display = 'none'; };
                left.appendChild(img);
            } else {
                const emojiDiv = document.createElement('div');
                emojiDiv.style.cssText = 'width:50px;height:50px;background:var(--bg);border-radius:8px;margin-right:10px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;vertical-align:middle;';
                emojiDiv.textContent = p.emoji || '📦';
                emojiDiv.onclick = () => editProductImage(p.id);
                left.appendChild(emojiDiv);
            }

            // Назва
            const nameEl = document.createElement('strong');
            nameEl.textContent = (p.emoji ? p.emoji + ' ' : '📦 ') + p.name;
            left.appendChild(nameEl);

            // Мета-інфо
            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:12px;color:var(--text-light);';
            const stockColor = p.stockQuantity > 0 ? 'green' : 'red';
            meta.innerHTML = `${p.price} zł | ${p.category}${p.brand ? ' | ' + p.brand : ''}<br>📦 На складі: <strong style="color:${stockColor};">${p.stockQuantity} шт.</strong>`;
            left.appendChild(meta);

            // Права частина
            const right = document.createElement('div');
            right.style.cssText = 'display:flex;gap:8px;align-items:center;';

            const stockInput = document.createElement('input');
            stockInput.type = 'number';
            stockInput.value = p.stockQuantity;
            stockInput.min = '0';
            stockInput.style.cssText = 'width:70px;padding:6px;border:1px solid var(--border);border-radius:6px;text-align:center;';
            stockInput.oninput = function() { updateStock(p.id, this.value); };

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-small';
            delBtn.style.background = '#ff6b6b';
            delBtn.textContent = '🗑️';
            delBtn.onclick = () => deleteProduct(p.id);

            right.appendChild(stockInput);
            right.appendChild(delBtn);

            row.appendChild(left);
            row.appendChild(right);
            fragment.appendChild(row);
        });
        productsList.innerHTML = '';
        productsList.appendChild(fragment);
    }

    // Пагінація
    const paginationEl = document.getElementById('adminProductsPagination');
    if (paginationEl) {
        if (totalPages <= 1) {
            paginationEl.innerHTML = '';
        } else {
            let btns = '';
            for (let i = 0; i < totalPages; i++) {
                const active = i === adminProductsPage ? 'background:#007aff;color:#fff;' : 'background:var(--light);';
                btns += `<button onclick="renderAdminProductsList(${i})" style="${active}border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;">${i + 1}</button>`;
            }
            paginationEl.innerHTML = `<span style="font-size:13px;color:var(--text-light);align-self:center;">Сторінка:</span>${btns}<span style="font-size:12px;color:var(--text-light);align-self:center;">(${filtered.length} товарів)</span>`;
        }
    }
    } catch(e) {
        console.error('renderAdminProductsList error:', e);
        const productsList = document.getElementById('adminProductsList');
        if (productsList) productsList.innerHTML = '<p style="color:red;padding:20px;">Помилка завантаження: ' + e.message + '</p>';
    }
};

// Функція для адмін панелі
window.showAdminTab = function (tab) {
    try {
    const adminContent = document.getElementById('adminContent');
    if (!adminContent) { console.error('adminContent not found'); return; }

    if (tab === 'stats') {
        adminContent.innerHTML = `
            <div style="margin-top: 20px;">
                <h3 style="margin-bottom: 16px;">📊 Загальна статистика</h3>
                <div class="admin-stats">
                    <div class="stat-card">
                        <div class="stat-label">Товари</div>
                        <div class="stat-value" id="statProductsCount">—</div>
                        <div class="stat-meta">Всього позицій</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">В наявності</div>
                        <div class="stat-value" id="statProductsInStock">—</div>
                        <div class="stat-meta">Доступні зараз</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Немає</div>
                        <div class="stat-value" id="statProductsOut">—</div>
                        <div class="stat-meta">Закінчились</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Склад</div>
                        <div class="stat-value" id="statProductsStockTotal">—</div>
                        <div class="stat-meta">Загальний залишок</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Залишок по брендах</div>
                        <div class="stat-value" id="statStockBreakdownTotal">—</div>
                        <div class="stat-meta" id="statStockBreakdown">—</div>
                    </div>
                </div>

                <h3 style="margin: 20px 0 16px;">🧾 Замовлення</h3>
                <div class="admin-stats">
                    <div class="stat-card">
                        <div class="stat-label">Замовлень</div>
                        <div class="stat-value" id="statOrdersCount">—</div>
                        <div class="stat-meta">Всього</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Підтверджено</div>
                        <div class="stat-value" id="statOrdersConfirmed">—</div>
                        <div class="stat-meta">Статус confirmed</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Очікує</div>
                        <div class="stat-value" id="statOrdersPending">—</div>
                        <div class="stat-meta">Не підтверджені</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Виторг</div>
                        <div class="stat-value" id="statOrdersRevenue">—</div>
                        <div class="stat-meta">Сума</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Середній чек</div>
                        <div class="stat-value" id="statOrdersAvg">—</div>
                        <div class="stat-meta">На замовлення</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">За 24 год</div>
                        <div class="stat-value" id="statOrdersLast24">—</div>
                        <div class="stat-meta">Нові</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">За 7 днів</div>
                        <div class="stat-value" id="statOrdersLast7">—</div>
                        <div class="stat-meta">Нові</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Доставка</div>
                        <div class="stat-value" id="statOrdersDelivery">—</div>
                        <div class="stat-meta">Тип отримання</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Самовивіз</div>
                        <div class="stat-value" id="statOrdersPickup">—</div>
                        <div class="stat-meta">Тип отримання</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Оплата готівка</div>
                        <div class="stat-value" id="statOrdersCash">—</div>
                        <div class="stat-meta">Метод</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Оплата карта</div>
                        <div class="stat-value" id="statOrdersCard">—</div>
                        <div class="stat-meta">Метод</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Оплата USDT</div>
                        <div class="stat-value" id="statOrdersUsdt">—</div>
                        <div class="stat-meta">Метод</div>
                    </div>
                </div>

                <h3 style="margin: 20px 0 16px;">👥 Клієнти</h3>
                <div class="admin-stats">
                    <div class="stat-card">
                        <div class="stat-label">Клієнтів</div>
                        <div class="stat-value" id="statClientsCount">—</div>
                        <div class="stat-meta">Всього</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Активні</div>
                        <div class="stat-value" id="statClientsActive">—</div>
                        <div class="stat-meta">За 30 днів</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Замовлень</div>
                        <div class="stat-value" id="statClientsOrders">—</div>
                        <div class="stat-meta">В сумі</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">З замовленнями</div>
                        <div class="stat-value" id="statClientsWithOrders">—</div>
                        <div class="stat-meta">Клієнти</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Середньо</div>
                        <div class="stat-value" id="statClientsAvgOrders">—</div>
                        <div class="stat-meta">Замовлень на клієнта</div>
                    </div>
                </div>

                <h3 style="margin: 20px 0 16px;">🎟️ Промокоди</h3>
                <div class="admin-stats">
                    <div class="stat-card">
                        <div class="stat-label">Промокоди</div>
                        <div class="stat-value" id="statPromosCount">—</div>
                        <div class="stat-meta">Всього</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Активні</div>
                        <div class="stat-value" id="statPromosActive">—</div>
                        <div class="stat-meta">Діють зараз</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Використано</div>
                        <div class="stat-value" id="statPromosUsed">—</div>
                        <div class="stat-meta">Разів</div>
                    </div>
                </div>
            </div>
        `;

        loadAdminStats();
    } else if (tab === 'products') {
        console.log('📦 showAdminTab products START');

        // Спочатку показуємо простий текст для діагностики
        adminContent.innerHTML = '<p id="productsDebug" style="padding:20px;color:red;font-size:18px;">⏳ Завантаження товарів...</p>';

        // Будуємо HTML через DOM щоб уникнути проблем з template literal
        const wrapper = document.createElement('div');
        wrapper.style.marginTop = '20px';

        // Форма додавання товару
        wrapper.innerHTML = [
            '<h3 style="margin-bottom:16px;">➕ Додати новий товар</h3>',
            '<div style="background:var(--light);padding:24px;border-radius:16px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Назва товару:</label>',
            '<input type="text" id="adminProductName" placeholder="Назва товару" style="font-size:16px;padding:14px;"></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Ціна (zł):</label>',
            '<input type="number" id="adminProductPrice" placeholder="120" min="1" step="0.01" style="font-size:16px;padding:14px;"></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Категорія:</label>',
            '<select id="adminProductCategory" onchange="toggleBrandField()" style="font-size:16px;padding:14px;">',
            '<option value="">-- Вибери категорію --</option></select></div>',
            '<div class="form-group" id="subcategoryGroup" style="display:none;"><label style="font-size:15px;font-weight:600;">Підкатегорія:</label>',
            '<select id="adminProductSubcategory" style="font-size:16px;padding:14px;"><option value="">-- Вибери підкатегорію --</option></select></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Емодзі (необов\'язково):</label>',
            '<input type="text" id="adminProductEmoji" placeholder="🍓" maxlength="2" style="font-size:20px;padding:14px;text-align:center;"></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">URL фото (необов\'язково):</label>',
            '<input type="url" id="adminProductImageUrl" placeholder="https://example.com/image.jpg" style="font-size:14px;padding:14px;"></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Кількість товару:</label>',
            '<input type="number" id="adminProductStock" placeholder="50" min="0" style="font-size:16px;padding:14px;"></div>',
            '<div class="form-group"><label style="font-size:15px;font-weight:600;">Опис:</label>',
            '<textarea id="adminProductDesc" placeholder="Детальний опис товару..." style="font-size:15px;padding:14px;min-height:120px;"></textarea></div>',
            '<button type="button" onclick="addNewProduct()" class="btn btn-primary btn-full" style="font-size:17px;padding:16px;font-weight:600;">✅ Додати товар</button>',
            '</div>',
            '<h3>📦 Наявні товари</h3>',
            '<div style="margin-bottom:10px;"><input type="text" id="adminProductSearch" placeholder="Пошук товарів..." oninput="renderAdminProductsList()" style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;"></div>',
            '<div id="adminProductsList"></div>',
            '<div id="adminProductsPagination" style="display:flex;justify-content:center;gap:8px;margin-top:12px;flex-wrap:wrap;"></div>'
        ].join('');

        adminContent.innerHTML = '';
        adminContent.appendChild(wrapper);

        // Показ списку товарів з пагінацією та пошуком
        console.log('📦 HTML inserted, calling renderAdminProductsList, products count:', products.products ? products.products.length : 'undefined');
        adminProductsPage = 0;
        renderAdminProductsList();
        console.log('📦 showAdminTab products DONE');

    } else if (tab === 'orders') {
        adminContent.innerHTML = `
            <div style="margin-top: 20px;">
                <h3>📋 Останні замовлення</h3>
                <div id="adminOrdersList"></div>
            </div>
        `;

        // Завантаження замовлень
        loadAdminOrders();

    } else if (tab === 'clients') {
        adminContent.innerHTML = `
            <div style="margin-top: 20px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                    <h3 style="margin: 0;">👥 Всі клієнти</h3>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <select id="clientsSortSelect" onchange="loadAdminClients(this.value)" style="padding: 8px 12px; background: var(--light); border: 1px solid var(--border); border-radius: 6px; font-size: 14px; cursor: pointer;">
                            <option value="lastOrder">⏰ Останнє замовлення</option>
                            <option value="newest">✨ Найновіші</option>
                            <option value="mostOrders">📦 Найбільше замовлень</option>
                            <option value="name">👤 По імені (А-Я)</option>
                        </select>
                        <button onclick="exportClientsToBot()" class="btn-small" style="padding: 8px 12px; background: #27ae60;">📤 Експорт</button>
                        <button onclick="refreshClientProfiles()" class="btn-small" style="padding: 8px 12px;">🔄 Оновити профілі</button>
                    </div>
                </div>
                <div id="adminClientsList" style="margin-top: 16px;"></div>
            </div>
        `;

        // Завантаження клієнтів
        loadAdminClients();

    } else if (tab === 'messages') {
        adminContent.innerHTML = `
            <div style="margin-top: 20px;">
                <h3>💬 Надіслати повідомлення клієнту</h3>
                <form style="background: var(--light); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Вибрати клієнта:</label>
                        <select id="messageClientSelect" onchange="selectClient(this.value)" style="font-size: 16px; padding: 14px;">
                            <option value="">-- Завантаження клієнтів... --</option>
                        </select>
                        <small style="display: block; margin-top: 6px; color: var(--text-light); font-size: 12px;">Або введіть ID вручну нижче</small>
                    </div>
                    <div class="form-group">
                        <label>Або Telegram ID клієнта:</label>
                        <input type="text" id="messageClientId" placeholder="677058436">
                        <small style="display: block; margin-top: 6px; color: var(--text-light); font-size: 12px;">Знайди ID в замовленні або списку клієнтів</small>
                    </div>
                    <div class="form-group">
                        <label>Текст повідомлення:</label>
                        <textarea id="messageText" placeholder="Ваше замовлення готове..." required style="min-height: 120px;"></textarea>
                    </div>
                    <button type="button" onclick="sendMessageToClient()" class="btn btn-primary btn-full">✉️ Відправити</button>
                </form>

                <h3>📣 Розсилка всім</h3>
                <form style="background: var(--light); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Текст розсилки:</label>
                        <textarea id="broadcastMessage" placeholder="Оновлення, акції, важливе повідомлення..." required style="min-height: 120px;"></textarea>
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="broadcastIncludeAdmin">
                        <label for="broadcastIncludeAdmin" style="margin: 0;">Включити адміна</label>
                    </div>
                    <button type="button" onclick="sendBroadcastMessage()" class="btn btn-primary btn-full">📣 Відправити всім</button>
                    <div id="broadcastResult" style="margin-top: 8px; font-size: 12px; color: var(--text-light);"></div>
                </form>

                <h3>📋 Швидкі повідомлення</h3>
                <div style="display: grid; gap: 10px; margin-top: 16px;">
                    <button onclick="insertQuickMessage('Ваше замовлення готове до відправки! 📦')" class="btn" style="text-align: left;">
                        📦 Замовлення готове
                    </button>
                    <button onclick="insertQuickMessage('Дякуємо за замовлення! Очікуйте на доставку. 🚚')" class="btn" style="text-align: left;">
                        🚚 Дякуємо за замовлення
                    </button>
                    <button onclick="insertQuickMessage('На жаль, цього товару зараз немає в наявності. Можемо запропонувати альтернативу.')" class="btn" style="text-align: left;">
                        ❌ Немає в наявності
                    </button>
                    <button onclick="insertQuickMessage('Ваш товар очікує на самовивіз за адресою: __________')" class="btn" style="text-align: left;">
                        📍 Готовий до самовивозу
                    </button>
                </div>
            </div>
        `;

        // Завантаження клієнтів для селекту
        loadClientsForMessages();

    } else if (tab === 'promocodes') {
        adminContent.innerHTML = `
            <div style="margin-top: 20px;">
                <h3>🎟️ Управління промокодами</h3>
                <form style="background: var(--light); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Код промокода:</label>
                        <input type="text" id="adminPromoCode" placeholder="PROMO123" required>
                    </div>
                    <div class="form-group">
                        <label>Тип знижки:</label>
                        <select id="adminPromoType" required>
                            <option value="percent">Відсотки (%)</option>
                            <option value="fixed">Фіксована сума (zł)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Значення знижки:</label>
                        <input type="number" id="adminPromoValue" placeholder="10" min="1" required>
                    </div>
                    <button type="button" onclick="addNewPromo()" class="btn btn-primary btn-full">Додати промокод</button>
                </form>

                <h3>Активні промокоди</h3>
                <div id="adminPromosList"></div>
            </div>
        `;

        // Завантаження промокодів
        loadAdminPromos();
    }
    } catch(e) {
        console.error('showAdminTab error:', e);
        showToast('❌ Помилка: ' + e.message);
    }
}

function updateStatValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function formatMoney(value) {
    return `${value.toFixed(2)} zł`;
}

function renderAdminProductsStats() {
    const list = Array.isArray(products.products) ? products.products : [];
    const total = list.length;
    const inStock = list.filter(p => (p.stockQuantity || 0) > 0).length;
    const out = list.filter(p => (p.stockQuantity || 0) <= 0).length;
    const stockTotal = list.reduce((sum, p) => sum + (p.stockQuantity || 0), 0);
    const stockBreakdown = buildStockBreakdown(list);

    updateStatValue('statProductsCount', total);
    updateStatValue('statProductsInStock', inStock);
    updateStatValue('statProductsOut', out);
    updateStatValue('statProductsStockTotal', stockTotal);
    updateStatValue('statStockBreakdownTotal', stockBreakdown.totalText);

    const breakdownElement = document.getElementById('statStockBreakdown');
    if (breakdownElement) {
        breakdownElement.innerHTML = stockBreakdown.lines.length
            ? stockBreakdown.lines.join('<br>')
            : 'Немає даних';
    }
}

function buildStockBreakdown(list) {
    const liquidByBrand = {};
    let disposablesStock = 0;

    list.forEach(product => {
        const stock = Number(product.stockQuantity) || 0;
        if (product.category === 'рідина') {
            const brand = product.brand || 'Інше';
            liquidByBrand[brand] = (liquidByBrand[brand] || 0) + stock;
        } else if (product.category === 'одноразки') {
            disposablesStock += stock;
        }
    });

    const brandLines = Object.entries(liquidByBrand)
        .sort((a, b) => b[1] - a[1])
        .map(([brand, stock]) => `${brand} - ${stock}`);

    if (disposablesStock > 0 || Object.keys(liquidByBrand).length === 0) {
        brandLines.push(`Одноразки - ${disposablesStock}`);
    }

    const totalStock = brandLines.reduce((sum, line) => {
        const match = line.match(/\-\s*(\d+)/);
        return sum + (match ? Number(match[1]) : 0);
    }, 0);

    return {
        totalText: `${totalStock} шт.`,
        lines: brandLines
    };
}

function renderAdminOrdersStats(orders) {
    const list = Array.isArray(orders) ? orders : [];
    const normalizeMethod = (value) => {
        const raw = (value ?? '').toString().trim().toLowerCase();
        if (!raw) return '';
        if (raw.includes('usdt')) return 'usdt';
        if (raw.includes('card') || raw.includes('karta') || raw.includes('карта')) return 'card';
        if (raw.includes('cash') || raw.includes('gotiv') || raw.includes('гот')) return 'cash';
        return raw;
    };
    const total = list.length;
    const confirmed = list.filter(o => o.isConfirmed || o.status === 'confirmed').length;
    const pending = list.filter(o => !(o.isConfirmed || o.status === 'confirmed')).length;
    const revenue = list.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
    const avg = total ? revenue / total : 0;
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const last24 = list.filter(o => {
        const createdAt = new Date(o.createdAt).getTime();
        return Number.isFinite(createdAt) && createdAt >= dayAgo;
    }).length;
    const last7 = list.filter(o => {
        const createdAt = new Date(o.createdAt).getTime();
        return Number.isFinite(createdAt) && createdAt >= weekAgo;
    }).length;
    const delivery = list.filter(o => (o.deliveryType || o.delivery_type) === 'delivery').length;
    const pickup = list.filter(o => (o.deliveryType || o.delivery_type) === 'pickup').length;
    const cash = list.filter(o => normalizeMethod(o.paymentMethod ?? o.payment_method) === 'cash').length;
    const card = list.filter(o => normalizeMethod(o.paymentMethod ?? o.payment_method) === 'card').length;
    const usdt = list.filter(o => normalizeMethod(o.paymentMethod ?? o.payment_method) === 'usdt').length;

    updateStatValue('statOrdersCount', total);
    updateStatValue('statOrdersConfirmed', confirmed);
    updateStatValue('statOrdersPending', pending);
    updateStatValue('statOrdersRevenue', formatMoney(revenue));
    updateStatValue('statOrdersAvg', formatMoney(avg));
    updateStatValue('statOrdersLast24', last24);
    updateStatValue('statOrdersLast7', last7);
    updateStatValue('statOrdersDelivery', delivery);
    updateStatValue('statOrdersPickup', pickup);
    updateStatValue('statOrdersCash', cash);
    updateStatValue('statOrdersCard', card);
    updateStatValue('statOrdersUsdt', usdt);
}

function renderAdminClientsStats(clients) {
    const list = Array.isArray(clients) ? clients : [];
    const total = list.length;
    const ordersTotal = list.reduce((sum, client) => sum + (client.orders?.length || 0), 0);
    const clientsWithOrders = list.filter(client => (client.orders?.length || 0) > 0).length;
    const avgOrders = total ? ordersTotal / total : 0;
    const monthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const active = list.filter(client => {
        const orders = Array.isArray(client.orders) ? client.orders : [];
        return orders.some(order => {
            const createdAt = new Date(order.createdAt).getTime();
            return Number.isFinite(createdAt) && createdAt >= monthAgo;
        });
    }).length;

    updateStatValue('statClientsCount', total);
    updateStatValue('statClientsOrders', ordersTotal);
    updateStatValue('statClientsActive', active);
    updateStatValue('statClientsWithOrders', clientsWithOrders);
    updateStatValue('statClientsAvgOrders', avgOrders.toFixed(1));
}

function renderAdminPromosStats(promos) {
    const list = Array.isArray(promos) ? promos : [];
    const total = list.length;
    const active = list.filter(promo => promo.is_active).length;
    const used = list.reduce((sum, promo) => sum + (promo.used_count || 0), 0);

    updateStatValue('statPromosCount', total);
    updateStatValue('statPromosActive', active);
    updateStatValue('statPromosUsed', used);
}

async function loadAdminStats() {
    try {
        showLoading(true);
        const ordersUrl = CONFIG.API_URL + '/orders/admin/all';
        const clientsUrl = CONFIG.API_URL + '/users/all';
        const adminHeaders = getAdminHeaders();
        const [ordersResult, clientsResult, promosResult] = await Promise.allSettled([
            axios.get(ordersUrl, { headers: adminHeaders }),
            axios.get(clientsUrl, { headers: adminHeaders }),
            apiCall('GET', '/promocodes')
        ]);

        const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.data : [];
        const clients = clientsResult.status === 'fulfilled' ? clientsResult.value.data : [];
        const promos = promosResult.status === 'fulfilled' ? promosResult.value : [];

        renderAdminProductsStats();
        renderAdminOrdersStats(orders || []);
        renderAdminClientsStats(clients || []);
        renderAdminPromosStats(promos || []);

        const failures = [ordersResult, clientsResult, promosResult].filter(r => r.status === 'rejected');
        if (failures.length === 3) {
            showToast('❌ Помилка завантаження статистики');
        } else if (failures.length > 0) {
            showToast('⚠️ Частина статистики не завантажена');
        }
    } catch (error) {
        console.error('Error loading admin stats:', error);
        showToast('❌ Помилка завантаження статистики');
    } finally {
        showLoading(false);
    }
}

window.toggleBrandField = function () {
    const category = document.getElementById('adminProductCategory').value;
    const subcategoryGroup = document.getElementById('subcategoryGroup');
    
    // Для всіх категорій показуємо поле підкатегорії
    if (category) {
        subcategoryGroup.style.display = 'block';
        
        // Заповнюємо список підкатегорій на основі вибраної категорії
        const selectedCat = CONFIG.CATEGORIES.find(c => c.id === category);
        const subcategorySelect = document.getElementById('adminProductSubcategory');
        
        if (selectedCat && selectedCat.subcats) {
            subcategorySelect.innerHTML = `<option value="">-- Вибери підкатегорію --</option>` +
                selectedCat.subcats.map(sub => `<option value="${sub}">${sub}</option>`).join('');
            subcategorySelect.required = true;
        }
    } else {
        subcategoryGroup.style.display = 'none';
    }
}

window.addNewProduct = async function () {
    const name = document.getElementById('adminProductName').value.trim();
    const price = parseFloat(document.getElementById('adminProductPrice').value);
    const category = document.getElementById('adminProductCategory').value;
    const subcategory = document.getElementById('adminProductSubcategory').value;
    const emoji = document.getElementById('adminProductEmoji').value.trim();
    const imageUrl = document.getElementById('adminProductImageUrl').value.trim();
    const imageFile = document.getElementById('adminProductImageFile').files[0];
    const stockQuantity = parseInt(document.getElementById('adminProductStock').value) || 0;
    const description = document.getElementById('adminProductDesc').value.trim();

    if (!name || !price || !category || !subcategory || !description) {
        showToast('Заповни всі поля!');
        return;
    }

    if (stockQuantity < 0) {
        showToast('Кількість не може бути від\'ємною!');
        return;
    }

    showLoading(true);

    try {
        let finalImageUrl = imageUrl || null;

        // Якщо файл вибран, завантажу на сервер
        if (imageFile) {
            console.log('📸 File selected:', imageFile.name, imageFile.size);
            const formData = new FormData();
            formData.append('image', imageFile);

            console.log('📤 Uploading to /api/upload...');
            const uploadResponse = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            console.log('Response status:', uploadResponse.status);
            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                console.error('Upload failed:', errorText);
                throw new Error('Помилка завантаження файлу');
            }

            const uploadData = await uploadResponse.json();
            console.log('✅ Upload response:', uploadData);
            finalImageUrl = uploadData.url;
        }

        const selectedCat = CONFIG.CATEGORIES.find(c => c.id === category);
        const finalEmoji = emoji || selectedCat?.emoji || '📦';

        const newProduct = await apiCall('POST', '/products', {
            name,
            price,
            category: selectedCat?.name || category,
            subcategory,
            emoji: finalEmoji,
            image_url: finalImageUrl,
            stock_quantity: stockQuantity,
            description,
            in_stock: true
        });

        products.products.push(newProduct);
        showToast('✅ Товар додано успішно!');

        // Очистка форми
        document.getElementById('adminProductName').value = '';
        document.getElementById('adminProductPrice').value = '';
        document.getElementById('adminProductCategory').value = '';
        document.getElementById('adminProductSubcategory').value = '';
        document.getElementById('adminProductEmoji').value = '';
        document.getElementById('adminProductImageUrl').value = '';
        document.getElementById('adminProductImageFile').value = '';
        document.getElementById('adminProductStock').value = '';
        document.getElementById('adminProductDesc').value = '';
        document.getElementById('previewImage').innerHTML = '';
        document.getElementById('subcategoryGroup').style.display = 'none';

        showAdminTab('products');
    } catch (error) {
        showToast(`❌ Помилка: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Debounce для уникнення зайвих запитів
let stockUpdateTimeout = null;

window.updateStock = async function (productId, newStock) {
    // Спочатку оновлюємо локально для миттєвого відображення
    const product = products.products.find(p => p.id === productId);
    if (product) {
        product.stockQuantity = parseInt(newStock);
        product.inStock = parseInt(newStock) > 0;
    }

    // Очищаємо попередній таймер
    if (stockUpdateTimeout) {
        clearTimeout(stockUpdateTimeout);
    }

    // Встановлюємо новий таймер для відправки на сервер
    stockUpdateTimeout = setTimeout(async () => {
        try {
            const stock = parseInt(newStock);
            if (stock < 0) {
                showToast('Кількість не може бути від\'ємною!');
                return;
            }

            await apiCall('PUT', `/products/${productId}/stock`, { stock_quantity: stock });
            showToast('✅ Кількість оновлено!');
        } catch (error) {
            console.error('Error updating stock:', error);
            showToast(`❌ Помилка: ${error.message}`);
        }
    }, 1000); // Чекаємо 1 секунду після останнього введення
}

window.editProductImage = function (productId) {
    const imageUrl = prompt('Введи URL фотографії:');
    if (!imageUrl) return;

    window.updateProductImage(productId, imageUrl);
}

window.updateProductImage = async function (productId, imageUrl) {
    try {
        await apiCall('PUT', `/products/${productId}/image`, { imageUrl });

        // Оновлюємо локальні дані
        const product = products.products.find(p => p.id === productId);
        if (product) {
            product.imageUrl = imageUrl;
        }

        showToast('✅ Фото оновлено!');
        showAdminTab('products');
    } catch (error) {
        console.error('Error updating image:', error);
        showToast(`❌ Помилка: ${error.message}`);
    }
}

window.deleteProduct = async function (productId) {
    if (!confirm('Ти впевнений що хочеш видалити цей товар?')) return;

    showLoading(true);

    try {
        console.log('Deleting product:', productId);
        await apiCall('DELETE', `/products/${productId}`);
        products.products = products.products.filter(p => p.id !== productId);
        showToast('✅ Товар успішно видалено!');
        showAdminTab('products');
    } catch (error) {
        console.error('Delete error:', error);
        showToast(`❌ Помилка видалення: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

async function loadAdminOrders() {
    try {
        console.log('📦 Loading admin orders...');
        const url = CONFIG.API_URL + '/orders/admin/all';
        console.log('📡 Fetching from:', url);
        const adminHeaders = getAdminHeaders();
        const response = await axios.get(url, { headers: adminHeaders });
        console.log('✅ Orders received:', response.data);
        const orders = response.data;
        const ordersList = document.getElementById('adminOrdersList');

        if (orders.length === 0) {
            ordersList.innerHTML = '<p>Замовлень не знайдено</p>';
            return;
        }

        ordersList.innerHTML = orders.map(order => {
            // Парсимо items з JSON
            let itemsText = '';
            try {
                const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
                itemsText = items.map(item => {
                    const productId = item.product_id || item.productId || item.id;
                    const productName = item.name || item.product_name || item.title || (productId ? products.getProductById(productId)?.name : null);
                    const label = productName || (productId ? `Товар #${productId}` : 'Товар');
                    return `${label} x${item.quantity || 1}`;
                }).join(', ');
            } catch (e) {
                itemsText = 'Товари не вказані';
            }

            const isConfirmed = order.isConfirmed || order.status === 'confirmed';
            const orderId = order.id || order.orderId || order.order_id;
            const telegramId = order.telegramId || order.telegram_id || order.userId || order.user_id || order.user?.telegramId || order.user?.telegram_id;

            // Обчислюємо стоимість доставки якщо чомусь вона не в order
            let deliveryFeeDisplay = '';
            if (order.deliveryAddress) {
                // Для доставки показуємо інформацію про вартість
                deliveryFeeDisplay = `<br>🚚 <strong>Доставка</strong>: уточніть у замовника`;
            }

            return `
            <div style="background: var(--light); padding: 16px; border-radius: 8px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div style="margin-bottom: 8px;">
                            <strong>#${order.orderNumber}</strong>
                            <span style="padding: 4px 12px; background: var(--primary); color: white; border-radius: 6px; font-size: 11px; margin-left: 8px;">
                                ${(order.status || 'pending').toUpperCase()}
                            </span>
                        </div>
                        <div style="font-size: 13px; color: var(--text-light); margin-bottom: 8px;">
                            👤 <strong>Клієнт</strong><br>
                            🆔 ID: ${telegramId || 'невідомо'}
                            ${telegramId ? `<button onclick="showClientDetails('${telegramId}')" style="margin-left: 8px; padding: 4px 8px; background: #4a90e2; color: white; border: none; border-radius: 6px; font-size: 11px; cursor: pointer;">🔗 Відкрити клієнта</button>` : ''}
                        </div>
                        <div style="font-size: 12px; color: var(--text-light);">
                            📦 Товари: ${itemsText || 'Товари не вказані'}${deliveryFeeDisplay}<br>
                            💳 Оплата: ${getPaymentMethodName(order.paymentMethod)}<br>
                            💰 Сума: <strong>${(order.totalPrice || 0).toFixed(2)} zł</strong><br>
                            📅 ${new Date(order.createdAt).toLocaleString('uk-UA')}<br>
                            ${order.deliveryAddress ? `🚚 Адреса: ${order.deliveryAddress}` : ''}
                            ${order.pickupLocation ? `📍 Самовивіз: ${order.pickupLocation}` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                                ${isConfirmed
                    ? '<span style="padding: 8px 14px; background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); color: white; border-radius: 8px; font-size: 12px; font-weight: 500; box-shadow: 0 2px 8px rgba(46, 204, 113, 0.3);">✅ Підтверджено</span>'
                    : (orderId
                        ? `<button style="padding: 8px 14px; background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; box-shadow: 0 2px 8px rgba(39, 174, 96, 0.3); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(39, 174, 96, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(39, 174, 96, 0.3)';" onclick="confirmAdminOrder(${orderId})">✅ Підтвердити</button>`
                        : '<span style="padding: 8px 14px; background: #e67e22; color: white; border-radius: 8px; font-size: 12px; font-weight: 500;">⚠️ Немає ID</span>')
                }
                            <button style="padding: 8px 14px; background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; box-shadow: 0 2px 8px rgba(243, 156, 18, 0.3); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(243, 156, 18, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(243, 156, 18, 0.3)';" onclick="setDeliveryFee(${orderId})">🚚 Доставка</button>
                            <button style="padding: 8px 14px; background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(255, 107, 107, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(255, 107, 107, 0.3)';" onclick="deleteOrder(${orderId})">🗑️ Видалити</button>
                        </div>
                    </div>
                </div>
            </div>
        `}).join('');
    } catch (error) {
        console.error('Error loading orders:', error);
        document.getElementById('adminOrdersList').innerHTML = `<p>❌ Помилка завантаження: ${error.message}</p>`;
    }
}

// Завантаження клієнтів для селекту повідомлень
async function loadClientsForMessages() {
    try {
        const adminId = getCurrentTelegramId();
        const response = await axios.get(CONFIG.API_URL + '/users/all', {
            headers: { adminId: adminId }
        });
        const clients = response.data || [];
        const sel = document.getElementById('messageClientSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Вибери клієнта --</option>';
        clients.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.telegramId;
            opt.textContent = (u.username ? '@' + u.username : (u.firstName || 'Клієнт')) + ' (ID: ' + u.telegramId + ')';
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('loadClientsForMessages error:', e);
    }
}

window.selectClient = function(telegramId) {
    const input = document.getElementById('messageClientId');
    if (input && telegramId) input.value = telegramId;
}

async function loadAdminPromos() {
    try {
        const promos = await apiCall('GET', '/promocodes');
        const promosList = document.getElementById('adminPromosList');

        if (promos.length === 0) {
            promosList.innerHTML = '<p>Промокодів не знайдено</p>';
            return;
        }

        promosList.innerHTML = promos.map(promo => `
            <div style="background: var(--light); padding: 12px; border-radius: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div>
                    <strong>${promo.code}</strong>
                    <div style="font-size: 12px; color: var(--text-light);">
                        ${promo.discount_type === 'percent' ? promo.discount_value + '%' : promo.discount_value + ' zł'}
                        | Використано: ${promo.used_count}/${promo.max_uses || '∞'}
                        | ${promo.is_active ? '✅ Активно' : '❌ Неактивно'}
                    </div>
                </div>
                <button class="btn-small" style="background: #ff6b6b;" onclick="deletePromo('${promo.code}')">🗑️</button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading promos:', error);
        document.getElementById('adminPromosList').innerHTML = '<p>❌ Помилка завантаження</p>';
    }
}

window.addNewPromo = async function () {
    const code = document.getElementById('adminPromoCode').value.trim().toUpperCase();
    const discountType = document.getElementById('adminPromoType').value;
    const discountValue = parseFloat(document.getElementById('adminPromoValue').value);

    if (!code || !discountValue) {
        showToast('Заповни всі поля!');
        return;
    }

    showLoading(true);

    try {
        await apiCall('POST', '/promocodes', {
            code,
            discount_type: discountType,
            discount_value: discountValue,
            max_uses: null,
            min_purchase: 0,
            is_active: true
        });

        showToast('✅ Промокод додано!');

        // Очистка форми
        document.getElementById('adminPromoCode').value = '';
        document.getElementById('adminPromoValue').value = '';

        showAdminTab('promocodes');
    } catch (error) {
        showToast(`❌ Помилка: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Функції для клієнтів в адмін панелі
window.loadAdminClients = async function (sortBy = 'lastOrder') {
    try {
        console.log('📥 Loading clients from API...');
        const url = CONFIG.API_URL + '/users/all';
        const adminHeaders = getAdminHeaders();
        const response = await axios.get(url, { headers: adminHeaders });
        let clients = response.data;
        console.log('✅ Clients loaded:', clients);

        // Sort clients based on selected option
        if (clients && Array.isArray(clients)) {
            clients = clients.sort((a, b) => {
                switch (sortBy) {
                    case 'lastOrder':
                        // Sort by last order date (newest first)
                        const dateA = a.orders?.[0]?.createdAt ? new Date(a.orders[0].createdAt) : new Date(0);
                        const dateB = b.orders?.[0]?.createdAt ? new Date(b.orders[0].createdAt) : new Date(0);
                        return dateB - dateA;

                    case 'newest':
                        // Sort by registration date (newest first)
                        const regDateA = new Date(a.createdAt || 0);
                        const regDateB = new Date(b.createdAt || 0);
                        return regDateB - regDateA;

                    case 'mostOrders':
                        // Sort by number of orders (most first)
                        const ordersA = a.orders?.length || 0;
                        const ordersB = b.orders?.length || 0;
                        return ordersB - ordersA;

                    case 'name':
                        // Sort by name (A-Z)
                        const nameA = (a.firstName || a.first_name || 'Невідомий').toLowerCase();
                        const nameB = (b.firstName || b.first_name || 'Невідомий').toLowerCase();
                        return nameA.localeCompare(nameB);

                    default:
                        return 0;
                }
            });
        }

        // Restore sort selection if switching tabs
        const sortSelect = document.getElementById('clientsSortSelect');
        if (sortSelect && sortSelect.value !== sortBy) {
            sortSelect.value = sortBy;
        }

        const clientsList = document.getElementById('adminClientsList');

        if (!clients || clients.length === 0) {
            clientsList.innerHTML = '<p>Клієнтів не знайдено</p>';
            return;
        }

        clientsList.innerHTML = clients.map(client => {
            const username = client.username ? `@${client.username}` : '';
            const firstName = client.first_name || client.firstName || 'Невідомий';
            const ordersCount = client.orders?.length || 0;
            const lastOrder = client.orders?.[0];

            return `
            <div onclick="showClientDetails('${client.telegramId}')" style="background: var(--light); padding: 16px; border-radius: 8px; margin-bottom: 12px; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='var(--light)'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">
                            👤 ${firstName} ${username}
                        </div>
                        <div style="font-size: 13px; color: var(--text-light);">
                            🆔 ${client.telegramId}<br>
                            📦 Замовлень: <strong>${ordersCount}</strong>
                            ${lastOrder ? `<br>📅 Останнє: ${new Date(lastOrder.createdAt).toLocaleDateString('uk-UA')}` : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="event.stopPropagation(); deleteClient('${client.telegramId}')" title="Видалити клієнта" style="background: #ff6b6b; color: white; border: none; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-width: 110px; justify-content: center;">🗑️ Видалити</button>
                        <div style="font-size: 20px;">→</div>
                    </div>
                </div>
            </div>
        `}).join('');
    } catch (error) {
        console.error('Error loading clients:', error);
        document.getElementById('adminClientsList').innerHTML = `<p>❌ Помилка завантаження: ${error.message}</p>`;
    }
}

window.showClientDetails = async function (telegramId) {
    try {
        showLoading(true);

        // Ensure telegramId is a string
        const clientId = String(telegramId);
        console.log('🔍 Loading client details for ID:', clientId);

        const url = CONFIG.API_URL + `/users/${clientId}/orders`;
        const adminHeaders = getAdminHeaders();

        console.log('📡 Fetching from URL:', url);
        console.log('📋 Headers:', adminHeaders);

        const response = await axios.get(url, { headers: adminHeaders });
        const orders = response.data;

        console.log('✅ Orders loaded:', orders);

        // Get client info from the list
        const clientsListUrl = CONFIG.API_URL + '/users/all';
        const clientsResponse = await axios.get(clientsListUrl, { headers: adminHeaders });
        const clients = clientsResponse.data;
        const client = clients.find(c => String(c.telegramId) === clientId);

        console.log('✅ Client found:', client);

        if (!client) {
            console.warn('⚠️ Client not found in list');
        }

        const username = client?.username ? `@${client.username}` : '';
        const firstName = client?.first_name || client?.firstName || 'Невідомий';

        document.getElementById('clientModalTitle').textContent = `${firstName} ${username}`;

        const modalContent = document.getElementById('clientModalContent');

        if (!orders || orders.length === 0) {
            modalContent.innerHTML = `
                <div style="margin-bottom: 16px; padding: 12px; background: var(--light); border-radius: 8px;">
                    <p style="margin: 0;">У клієнта немає замовлень</p>
                </div>
                <div style="display: flex; gap: 8px; flex-direction: column;">
                    <button onclick="openClientChat('${clientId}')" style="width: 100%; padding: 12px; background: #4a90e2; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
                        💬 Написати клієнту
                    </button>
                    <button onclick="deleteClient('${clientId}')" style="width: 100%; padding: 12px; background: #ff6b6b; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
                        🗑️ Видалити клієнта з бази
                    </button>
                </div>
            `;
        } else {
            modalContent.innerHTML = `
                <div style="margin-bottom: 16px; padding: 12px; background: var(--light); border-radius: 8px;">
                    <strong>Загальна статистика:</strong><br>
                    📦 Всього замовлень: ${orders.length}<br>
                    💰 Загальна сума: ${orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0).toFixed(2)} zł
                </div>
                <h4 style="margin-bottom: 12px;">Історія замовлень:</h4>
                ${orders.map(order => `
                    <div style="background: var(--light); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                            <strong>#${order.orderNumber}</strong>
                            <span style="padding: 3px 8px; background: var(--primary); color: white; border-radius: 4px; font-size: 10px; margin-left: 8px;">
                                ${order.status}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-light);">
                            💰 ${(order.totalPrice || 0).toFixed(2)} zł<br>
                            💳 ${getPaymentMethodName(order.paymentMethod)}<br>
                            📅 ${new Date(order.createdAt).toLocaleString('uk-UA')}<br>
                            ${order.deliveryAddress ? `🚚 ${order.deliveryAddress}<br>` : ''}
                            ${order.pickupLocation ? `📍 ${order.pickupLocation}<br>` : ''}
                        </div>
                    </div>
                `).join('')}
                <div style="display: flex; gap: 8px; flex-direction: column; margin-top: 16px;">
                    <button onclick="openClientChat('${clientId}')" style="width: 100%; padding: 12px; background: #4a90e2; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
                        💬 Написати клієнту
                    </button>
                    <button onclick="deleteClient('${clientId}')" style="width: 100%; padding: 12px; background: #ff6b6b; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px;">
                        🗑️ Видалити клієнта з бази
                    </button>
                </div>
            `;
        }

        document.getElementById('clientDetailsModal').style.display = 'flex';
    } catch (error) {
        console.error('❌ Error loading client details:', error);
        console.error('Error response:', error.response?.data);
        const errorMsg = error.response?.data?.error || error.message || 'Невідома помилка';
        showToast(`❌ Помилка завантаження: ${errorMsg}`);
    } finally {
        showLoading(false);
    }
}

window.closeClientModal = function () {
    document.getElementById('clientDetailsModal').style.display = 'none';
}

window.openClientChat = function (telegramId) {
    try {
        const url = `tg://user?id=${telegramId}`;
        console.log('🔗 Opening chat with:', telegramId);

        // Try Telegram Web App API first
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openLink(url);
        } else {
            // Fallback to direct link
            window.open(url);
        }
    } catch (error) {
        console.error('Error opening client chat:', error);
        showToast('❌ Помилка: не вдалося відкрити чат з клієнтом');
    }
}

window.deleteClient = async function (telegramId) {
    if (!confirm(`⚠️ Ви впевнені що хочете видалити цього клієнта та всі його дані? Це не можна відмінити!`)) {
        return;
    }

    try {
        showLoading(true);
        const url = CONFIG.API_URL + `/users/${telegramId}`;
        const adminHeaders = getAdminHeaders();
        const response = await axios.delete(url, { headers: adminHeaders });

        console.log('✅ Client deleted:', response.data);
        showToast('✅ Клієнт видалено з бази даних');

        // Закрити modal
        closeClientModal();

        // Перезавантажити список клієнтів
        setTimeout(() => {
            loadAdminClients();
        }, 500);
    } catch (error) {
        console.error('Error deleting client:', error);
        const errorMsg = error.response?.data?.error || error.message;
        showToast(`❌ Помилка видалення: ${errorMsg}`);
    } finally {
        showLoading(false);
    }
}

// Export all clients to Telegram
window.exportClientsToBot = async function () {
    if (!confirm('📤 Експортувати всіх клієнтів в Telegram?')) {
        return;
    }

    try {
        showLoading(true);
        const url = CONFIG.API_URL + '/admin/export-clients';
        const adminHeaders = getAdminHeaders();

        const response = await axios.post(url, {}, { headers: adminHeaders });

        console.log('✅ Export response:', response.data);
        showToast(`✅ Експортовано ${response.data.count} клієнтів!`);
    } catch (error) {
        console.error('Error exporting clients:', error);
        const errorMsg = error.response?.data?.error || error.message;
        showToast(`❌ Помилка експорту: ${errorMsg}`);
    } finally {
        showLoading(false);
    }
}

// Функції для меню каталогу з вибором категорії
window.selectCategory = function (categoryId) {
    const categoryMenu = document.getElementById('categoryMenu');
    const productsView = document.getElementById('productsView');

    // Знаходимо категорію в CONFIG
    const category = CONFIG.CATEGORIES.find(c => c.id === categoryId);
    if (!category) {
        console.error('Category not found:', categoryId);
        return;
    }

    categoryMenu.style.display = 'none';
    productsView.classList.remove('products-view-hidden');

    // Фільтруємо товари по категорії
    const filtered = products.products.filter(p => 
        p.category === category.name || p.category === categoryId
    );
    const finalList = filtered.length ? filtered : products.products;
    products.filteredProducts = products.sortByAvailability(finalList);
    products.renderProducts();
}

window.selectSubcategory = function (subcategory) {
    const productsView = document.getElementById('productsView');
    
    // Фільтруємо товари по підкатегорії
    const filtered = products.products.filter(p => 
        p.subcategory === subcategory || p.brand === subcategory
    );
    const finalList = filtered.length ? filtered : products.products;
    products.filteredProducts = products.sortByAvailability(finalList);
    products.renderProducts();
}

window.goBackToCategory = function () {
    const categoryMenu = document.getElementById('categoryMenu');
    const productsView = document.getElementById('productsView');

    productsView.classList.add('products-view-hidden');
    categoryMenu.style.display = 'grid';
}

window.goBackToCatalog = function () {
    const categoryMenu = document.getElementById('categoryMenu');
    const productsView = document.getElementById('productsView');

    categoryMenu.style.display = 'grid';
    productsView.classList.add('products-view-hidden');
}

// Приховуємо кнопку адмін панелі для не-адміна
window.checkAndHideAdminButton = function () {
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) {
        const isAdmin = isCurrentUserAdmin();
        adminBtn.style.display = isAdmin ? 'flex' : 'none';
    }
}

// =============================================
// API Functions (from api.js)
// =============================================

// Функція для отримання даних користувача від Telegram
window.initTelegramUser = async function () {
    if (!window.Telegram?.WebApp) {
        console.warn('Telegram Web App not available');
        blockNonTelegramAccess();
        return;
    }

    const webApp = window.Telegram.WebApp;

    // Чекаємо поки WebApp буде готовий
    webApp.ready();

    // Додаємо невеликий delay щоб переконатися що всі дані завантажені
    await new Promise(resolve => setTimeout(resolve, 100));

    const user = webApp.initDataUnsafe?.user;

    if (!user) {
        console.warn('No Telegram user in initDataUnsafe');
        blockNonTelegramAccess();
        return;
    }

    console.log('✅ Telegram user initialized:', user);

    // Зберігання даних користувача
    localStorage.setItem('telegramUser', JSON.stringify(user));

    try {
        // Створення або отримання користувача на backend
        const userData = await apiCall('GET', `/users/${user.id}`);
        localStorage.setItem('currentUser', JSON.stringify(userData));
    } catch (error) {
        console.error('Error initializing user:', error);
        // Якщо помилка, все одно зберігаємо базові дані
        localStorage.setItem('currentUser', JSON.stringify({
            telegram_id: user.id,
            id: user.id,
            username: user.username,
            first_name: user.first_name
        }));
    }

    // Налаштування Telegram Web App (ready вже викликано вище)
    webApp.expand();
    webApp.headerColor = '#ff6b6b';
    webApp.backgroundColor = '#ffffff';

    // Re-check admin button visibility after user data is loaded
    if (typeof checkAndHideAdminButton === 'function') {
        checkAndHideAdminButton();
    }
}

// Управління доставкою/самовивізом
window.toggleDeliveryLocation = function () {
    const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value;
    const deliveryAddressGroup = document.getElementById('deliveryAddressGroup');
    const pickupLocationGroup = document.getElementById('pickupLocationGroup');
    const deliveryAddressInput = document.getElementById('deliveryAddress');
    const pickupLocationInput = document.getElementById('pickupLocation');

    if (deliveryType === 'delivery') {
        localStorage.setItem('vaper_delivery_type', 'delivery');
        deliveryAddressGroup.style.display = 'block';
        pickupLocationGroup.style.display = 'none';
        if (deliveryAddressInput) deliveryAddressInput.removeAttribute('readonly');
        if (pickupLocationInput) pickupLocationInput.value = '';
        scheduleDeliveryEstimate(deliveryAddressInput?.value.trim() || '');
    } else if (deliveryType === 'pickup') {
        localStorage.setItem('vaper_delivery_type', 'pickup');
        deliveryAddressGroup.style.display = 'none';
        pickupLocationGroup.style.display = 'block';
        if (deliveryAddressInput) deliveryAddressInput.value = '';
        if (pickupLocationInput) {
            pickupLocationInput.setAttribute('readonly', 'true');
            // Автоматично встановлюємо фіксовану адресу самовивізу
            pickupLocationInput.value = 'Wroclaw, Район Nadodrze (Для детальної адреси звяжіться з власником)';
            showToast('✅ Адреса самовивізу встановлена!');
        }
        clearDeliveryEstimate();
    }
}

window.requestLocation = function () {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            showToast('📍 Локація отримана! Визначаю адресу...');

            try {
                const response = await axios.get('/api/reverse-geocode', {
                    params: { lat, lon }
                });

                const address = response.data.displayName || `${lat}, ${lon}`;
                document.getElementById('deliveryAddress').value = address;
                showToast('✅ Адреса визначена!');
                scheduleDeliveryEstimate(address);
            } catch (error) {
                console.error('Error reverse geocoding:', error);
                // Fallback до координат
                document.getElementById('deliveryAddress').value = `${lat}, ${lon}`;
                showToast('⚠️ Адреса визначена за координатами');
                scheduleDeliveryEstimate(`${lat}, ${lon}`);
            }
        });
    } else {
        showToast('❌ Геолокація не підтримується');
    }
}

function setDeliveryEstimateMessage(message, isError = false) {
    const estimateEl = document.getElementById('deliveryEstimate');
    const summaryEl = document.getElementById('deliveryEstimateSummary');
    const targets = [estimateEl, summaryEl].filter(Boolean);

    targets.forEach(target => {
        if (!message) {
            target.textContent = '';
            target.style.display = 'none';
            target.classList.remove('error');
            return;
        }

        target.textContent = message;
        target.style.display = 'block';
        target.classList.toggle('error', isError);
    });
}

function clearDeliveryEstimate() {
    lastDeliveryEstimateAddress = '';
    lastDeliveryEstimate = null;
    localStorage.removeItem('vaper_delivery_fee_estimate');
    localStorage.removeItem('vaper_delivery_address');
    setDeliveryEstimateMessage('');
    cart.updateCartSummary();
    if (typeof window.displayCheckoutItems === 'function') {
        window.displayCheckoutItems();
    }
}

function buildDeliveryEstimateText(estimate) {
    const fee = Number(estimate?.fee);
    if (!Number.isFinite(fee)) {
        return null;
    }
    return `🚚 Орієнтовна доставка: ${fee.toFixed(2)} zł. Але потрібно уточнити у адміна.`;
}

async function requestDeliveryEstimate(address) {
    if (!address || address.length < 5) {
        clearDeliveryEstimate();
        return;
    }

    if (address === lastDeliveryEstimateAddress && lastDeliveryEstimate) {
        const cachedText = buildDeliveryEstimateText(lastDeliveryEstimate);
        if (cachedText) {
            setDeliveryEstimateMessage(cachedText);
        }
        cart.updateCartSummary();
        if (typeof window.displayCheckoutItems === 'function') {
            window.displayCheckoutItems();
        }
        return;
    }

    setDeliveryEstimateMessage('Рахую приблизну ціну доставки...');

    try {
        const response = await apiCall('GET', `/delivery/estimate?address=${encodeURIComponent(address)}`);
        if (response?.out_of_area) {
            lastDeliveryEstimateAddress = '';
            lastDeliveryEstimate = null;
            localStorage.removeItem('vaper_delivery_fee_estimate');
            localStorage.removeItem('vaper_delivery_address');
            setDeliveryEstimateMessage(response.message || 'Доставка тільки по Вроцлаву. Уточніть у власника.', true);
            cart.updateCartSummary();
            if (typeof window.displayCheckoutItems === 'function') {
                window.displayCheckoutItems();
            }
            return;
        }

        lastDeliveryEstimateAddress = address;
        lastDeliveryEstimate = response;
        if (Number.isFinite(response?.fee)) {
            localStorage.setItem('vaper_delivery_fee_estimate', response.fee);
            localStorage.setItem('vaper_delivery_address', address);
        }
        const text = buildDeliveryEstimateText(response) || 'Не вдалося отримати ціну доставки.';
        setDeliveryEstimateMessage(text, !buildDeliveryEstimateText(response));
        cart.updateCartSummary();
        if (typeof window.displayCheckoutItems === 'function') {
            window.displayCheckoutItems();
        }
    } catch (error) {
        console.error('Delivery estimate error:', error);
        setDeliveryEstimateMessage('Не вдалося розрахувати доставку. Уточніть у адміна.', true);
        localStorage.removeItem('vaper_delivery_fee_estimate');
        localStorage.removeItem('vaper_delivery_address');
        cart.updateCartSummary();
        if (typeof window.displayCheckoutItems === 'function') {
            window.displayCheckoutItems();
        }
    }
}

function scheduleDeliveryEstimate(address) {
    const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value;
    if (deliveryType !== 'delivery') {
        clearDeliveryEstimate();
        return;
    }

    if (deliveryEstimateTimeout) {
        clearTimeout(deliveryEstimateTimeout);
    }

    deliveryEstimateTimeout = setTimeout(() => {
        requestDeliveryEstimate(address);
    }, 600);
}

// Функції для управління замовленнями
window.confirmOrder = async function () {
    const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value;
    const deliveryAddress = document.getElementById('deliveryAddress')?.value.trim();
    const pickupLocation = document.getElementById('pickupLocation')?.value.trim();
    const customerNotes = document.getElementById('customerNotes').value.trim();
    const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value;

    console.log('📋 Checkout form data:', { deliveryType, deliveryAddress, pickupLocation, paymentMethod, cartItems: cart.items.length });

    if (!deliveryType) {
        showToast('Вибери спосіб отримання!');
        return;
    }

    if (deliveryType === 'delivery' && !deliveryAddress) {
        showToast('Введи адресу доставки!');
        return;
    }

    if (deliveryType === 'pickup' && !pickupLocation) {
        showToast('Надішли локацію самовивізу!');
        return;
    }

    if (!paymentMethod) {
        showToast('Вибери спосіб оплати!');
        return;
    }

    if (cart.items.length === 0) {
        showToast('Твій кошик порожній!');
        return;
    }

    // Перевірка вартості доставки - критично важливо!
    if (deliveryType === 'delivery') {
        const deliveryEstimateRaw = parseFloat(localStorage.getItem('vaper_delivery_fee_estimate') || 0);
        const lastDeliveryAddress = localStorage.getItem('vaper_delivery_address');
        
        // Якщо адреса введена, але ціна не розрахована
        if (deliveryAddress !== lastDeliveryAddress || !Number.isFinite(deliveryEstimateRaw) || deliveryEstimateRaw <= 0) {
            showToast('⏳ Чекай, поки розрахується вартість доставки... Або обнови адресу.');
            return;
        }
    }

    showLoading(true);

    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const telegramUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
        console.log('🧑 Current user from localStorage:', currentUser);
        console.log('📱 Telegram user from localStorage:', telegramUser);

        const discount = parseFloat(localStorage.getItem('vaper_discount') || 0);
        const promocode = localStorage.getItem('vaper_promocode');
        const deliveryEstimateRaw = parseFloat(localStorage.getItem('vaper_delivery_fee_estimate') || 0);
        const deliveryEstimate = deliveryType === 'delivery' && Number.isFinite(deliveryEstimateRaw) && deliveryEstimateRaw > 0
            ? deliveryEstimateRaw
            : 0;

        // Fallback до прямого читання з Telegram WebApp якщо localStorage порожній
        let telegram_id = currentUser.telegramId || currentUser.telegram_id || telegramUser.id;

        if (!telegram_id && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            telegram_id = window.Telegram.WebApp.initDataUnsafe.user.id;
            console.log('⚠️ Telegram ID not in localStorage, using direct WebApp access:', telegram_id);

            // Оновлюємо localStorage для наступних разів
            const webAppUser = window.Telegram.WebApp.initDataUnsafe.user;
            localStorage.setItem('telegramUser', JSON.stringify(webAppUser));
        }

        console.log('📱 Using telegram_id:', telegram_id);

        if (!telegram_id) {
            showToast('❌ Не вдалося отримати Telegram ID. Спробуй перезапустити бот.');
            return;
        }

        // Також оновлюємо telegramUser якщо був fallback
        const finalTelegramUser = (telegramUser.id ? telegramUser : (window.Telegram?.WebApp?.initDataUnsafe?.user || {}));

        const orderData = {
            telegram_id: telegram_id,
            init_data: window.Telegram?.WebApp?.initData || '',
            user_data: {
                first_name: finalTelegramUser.first_name || currentUser.firstName || currentUser.first_name || 'Клієнт',
                last_name: finalTelegramUser.last_name || currentUser.lastName || currentUser.last_name || '',
                username: finalTelegramUser.username || currentUser.username || ''
            },
            items: cart.items.map(item => ({
                product_id: item.id,
                quantity: item.quantity,
                price: item.price
            })),
            payment_method: paymentMethod,
            delivery_type: deliveryType,
            delivery_address: deliveryType === 'delivery' ? deliveryAddress : null,
            pickup_location: deliveryType === 'pickup' ? pickupLocation : null,
            customer_notes: customerNotes || null,
            promocode: promocode || null,
            delivery_estimate: deliveryEstimate,
            total_price: cart.getTotal() - discount + deliveryEstimate
        };

        console.log('📤 Sending order to backend:', orderData);

        // Запит до backend використовуємо fetch замість apiCall для більшого контролю
        const orderResponse = await fetch(CONFIG.API_URL + '/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        if (!orderResponse.ok) {
            const errorData = await orderResponse.json();
            throw new Error(errorData.detail || errorData.error || `HTTP ${orderResponse.status}`);
        }

        const order = await orderResponse.json();
        console.log('✅ Order created:', order);

        // Очистка даних замовлення
        cart.clear();
        localStorage.removeItem('vaper_discount');
        localStorage.removeItem('vaper_promocode');
        document.getElementById('promoInput').value = '';

        // Показання підтвердження
        showOrderConfirmation(order, orderData);

    } catch (error) {
        console.error('❌ Order error:', error);
        console.error('Error details:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.detail || error.response?.data?.error || error.message;
        showToast(`❌ Помилка: ${errorMsg}`);
    } finally {
        showLoading(false);
    }
}

window.getPaymentMethodName = function (method) {
    const methods = {
        'cash': '💰 Готівка',
        'card': '💳 Укр. Карта',
        'usdt': '₿ USDT'
    };
    return methods[method] || method;
}

// Підтвердження замовлення адміном
window.confirmAdminOrder = async function (orderId) {
    if (!orderId) {
        showToast('❌ Немає ID замовлення');
        return;
    }

    if (!confirm('Підтвердити це замовлення?')) {
        return;
    }

    showLoading(true);

    try {
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/orders/${orderId}/confirm`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            }
        });

        if (response.ok) {
            showToast('✅ Замовлення підтверджено!');
            // Перезавантажити список замовлень
            loadAdminOrders();
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося підтвердити'}`);
        }
    } catch (error) {
        console.error('Error confirming order:', error);
        showToast('❌ Помилка підтвердження');
    } finally {
        showLoading(false);
    }
}

// Видалення замовлення адміном
window.deleteOrder = async function (orderId) {
    if (!orderId) {
        showToast('❌ Немає ID замовлення');
        return;
    }

    if (!confirm('⚠️ Ви впевнені що хочете видалити це замовлення? Це не можна відмінити!')) {
        return;
    }

    showLoading(true);

    try {
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/orders/${orderId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            }
        });

        if (response.ok) {
            showToast('✅ Замовлення видалено!');
            // Перезавантажити список замовлень
            loadAdminOrders();
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося видалити'}`);
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        showToast('❌ Помилка видалення');
    } finally {
        showLoading(false);
    }
}

function showOrderConfirmation(order, orderData) {
    const confirmationDetails = document.getElementById('confirmationDetails');

    const deliveryInfo = orderData?.delivery_type === 'delivery'
        ? `🚚 Доставка на адресу: ${orderData?.delivery_address}`
        : `📍 Самовивіз з: ${orderData?.pickup_location}`;

    const isCardPayment = (order.paymentMethod || order.payment_method) === 'card';
    const totalUah = Math.round(order.totalPrice * currentExchangeRate * 100) / 100;
    const priceDisplay = isCardPayment
        ? `${order.totalPrice.toFixed(2)} zł (${totalUah.toFixed(2)} грн)`
        : `${order.totalPrice.toFixed(2)} zł`;

    confirmationDetails.innerHTML = `
        <div class="confirmation-detail-item">
            <span>Номер замовлення:</span>
            <strong>#${order.orderNumber}</strong>
        </div>
        <div class="confirmation-detail-item">
            <span>Статус:</span>
            <strong>${order.status}</strong>
        </div>
        <div class="confirmation-detail-item">
            <span>Сума:</span>
            <strong>${priceDisplay}</strong>
        </div>
        <div class="confirmation-detail-item">
            <span>Спосіб оплати:</span>
            <strong>${getPaymentMethodName(order.paymentMethod)}</strong>
        </div>
        <div class="confirmation-detail-item">
            <span>Доставка:</span>
            <strong>${deliveryInfo}</strong>
        </div>
        <div class="confirmation-detail-item">
            <span>Дата:</span>
            <strong>${new Date(order.createdAt).toLocaleString('uk-UA')}</strong>
        </div>
    `;

    // Зберігання замовлення в історії
    const history = JSON.parse(localStorage.getItem('vaper_orders') || '[]');
    history.unshift(order);
    localStorage.setItem('vaper_orders', JSON.stringify(history));

    navigateTo('confirmation');
}

window.contactOwner = function () {
    // Відкриває переписку з менеджером у Telegram
    window.open('https://t.me/+380680162091', '_blank');
}

// Функції для управління користувачем
window.checkAdmin = async function () {
    console.log('🔐 Admin button clicked');
    const telegramUser = JSON.parse(localStorage.getItem('telegramUser') || '{}');
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

    console.log('📱 Telegram user:', telegramUser);
    console.log('👤 Current user:', currentUser);

    // Перевірка всіх можливих ID
    const userId = telegramUser.id || currentUser.telegramId || currentUser.telegram_id;
    const isAdmin = isCurrentUserAdmin();

    console.log('Admin check:', {
        userId,
        ADMIN_ID: CONFIG.ADMIN_ID,
        isAdmin,
        telegramUser,
        currentUser
    });

    if (isAdmin) {
        console.log('✅ Admin access granted, navigating to admin page');
        navigateTo('admin');
        showAdminTab('orders'); // Показати замовлення за замовчуванням
    } else {
        console.log('❌ Admin access denied');
        showToast(`❌ У тебе немає доступу! (ID: ${userId}, потрібен: ${CONFIG.ADMIN_ID})`);
    }
}

window.setTheme = function (theme) {
    localStorage.setItem('vaper_theme', theme);
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }

    // Оновлення кнопок теми
    document.getElementById('lightTheme').classList.toggle('active', theme === 'light');
    document.getElementById('darkTheme').classList.toggle('active', theme === 'dark');

    try {
        const telegramId = currentUser.telegramId || currentUser.telegram_id;
        apiCall('PUT', `/users/${telegramId}`, {
            theme: theme
        });
    } catch (error) {
        console.error('Error changing theme:', error);
    }

    showToast(`Тема змінена на ${theme === 'dark' ? '🌙 темну' : '☀️ світлу'}`);
}

// Завантаження історії замовлень
window.loadOrderHistory = async function () {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const telegramId = currentUser.telegramId || currentUser.telegram_id;

        console.log('📦 Loading order history for user:', currentUser);
        console.log('📦 Using telegramId:', telegramId);

        if (!telegramId) {
            console.log('❌ No telegramId found');
            document.getElementById('historyEmpty').style.display = 'block';
            document.getElementById('historyList').style.display = 'none';
            return;
        }

        const orders = await apiCall('GET', `/orders/user/${telegramId}`);
        console.log('📦 Orders received:', orders);
        console.log('📦 Orders count:', orders?.length);

        const historyList = document.getElementById('historyList');

        if (!orders || orders.length === 0) {
            console.log('📦 No orders found');
            document.getElementById('historyEmpty').style.display = 'block';
            document.getElementById('historyList').style.display = 'none';
            return;
        }

        document.getElementById('historyEmpty').style.display = 'none';
        historyList.style.display = 'block';

        historyList.innerHTML = orders.map(order => `
            <div style="background: var(--light); padding: 16px; border-radius: 12px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <strong>#${order.orderNumber}</strong>
                    <span style="padding: 4px 12px; background: var(--primary); color: white; border-radius: 6px; font-size: 12px;">
                        ${order.status.toUpperCase()}
                    </span>
                </div>
                <div style="color: var(--text-light); font-size: 14px;">
                    <div>Дата: ${new Date(order.createdAt).toLocaleString('uk-UA')}</div>
                        <div>Сума: <strong>${order.totalPrice.toFixed(2)} zł${(order.paymentMethod || order.payment_method) === 'card' ? ` (${(Math.round(order.totalPrice * currentExchangeRate * 100) / 100).toFixed(2)} грн)` : ''}</strong></div>
                        <div>Оплата: ${getPaymentMethodName(order.paymentMethod)}</div>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyEmpty').style.display = 'block';
        document.getElementById('historyList').style.display = 'none';
    }
}

// Відображення товарів у checkout
window.displayCheckoutItems = function () {
    const checkoutItemsContainer = document.getElementById('checkoutItems');

    if (!cart.items || cart.items.length === 0) {
        checkoutItemsContainer.innerHTML = '<p style="color: var(--text-light); text-align: center;">Кошик порожній</p>';
        return;
    }

    const subtotal = cart.getTotal();
    const discount = parseFloat(localStorage.getItem('vaper_discount') || 0);
    const deliveryType = localStorage.getItem('vaper_delivery_type');
    const estimateRaw = parseFloat(localStorage.getItem('vaper_delivery_fee_estimate') || 0);
    const deliveryEstimate = deliveryType === 'delivery' && Number.isFinite(estimateRaw) && estimateRaw > 0
        ? estimateRaw
        : 0;
    const total = Math.max(subtotal - discount + deliveryEstimate, 0);
    const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value;
    const totalUah = Math.round(total * currentExchangeRate * 100) / 100;
    const totalText = paymentMethod === 'card'
        ? `${total.toFixed(2)} zł (${totalUah.toFixed(2)} грн)`
        : `${total.toFixed(2)} zł`;

    checkoutItemsContainer.innerHTML = `
        <div style="background: var(--light); padding: 16px; border-radius: 12px; margin-bottom: 16px;">
            <h3 style="margin-bottom: 12px; font-size: 16px;">📦 Товари у замовленні:</h3>
            ${cart.items.map(item => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
                    <div>
                        <strong>${item.emoji ? item.emoji + ' ' : ''}${item.name}</strong>
                        <div style="font-size: 12px; color: var(--text-light);">x${item.quantity}</div>
                    </div>
                    <strong>${(item.price * item.quantity).toFixed(2)} zł</strong>
                </div>
            `).join('')}
            <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 2px solid var(--border); font-size: 18px; font-weight: bold;">
                <span>Разом:</span>
                <span>${totalText}</span>
            </div>
        </div>
    `;
}

// Глобальна змінна для курсу обміну
let currentExchangeRate = 11.6; // Default value
window.currentExchangeRate = currentExchangeRate;

// Функція для завантаження актуального курсу
async function loadExchangeRate() {
    try {
        const response = await axios.get('/api/exchange-rate');
        if (response.data && Number.isFinite(response.data.rate)) {
            currentExchangeRate = response.data.rate;
            window.currentExchangeRate = currentExchangeRate;
            console.log(`💱 Exchange rate loaded: 1 PLN = ${response.data.rate} UAH ${response.data.cached ? '(cached)' : '(fresh)'}`);
            if (window.cart?.updateCartSummary) {
                window.cart.updateCartSummary();
            }
            if (typeof window.displayCheckoutItems === 'function') {
                window.displayCheckoutItems();
            }
        }
    } catch (error) {
        console.warn('Failed to load exchange rate, using default:', error);
        currentExchangeRate = 11.6;
        window.currentExchangeRate = currentExchangeRate;
    }
}

// Функція для обробки вибору методу оплати та відображення конвертації
window.setupPaymentMethodListeners = async function () {
    // Завантажуємо курс перед встановленням listeners
    await loadExchangeRate();

    const paymentRadios = document.querySelectorAll('input[name="payment"]');
    const currencyExchangeDiv = document.getElementById('currencyExchange');
    const exchangeText = document.getElementById('exchangeText');

    if (!paymentRadios.length || !currencyExchangeDiv) return;

    paymentRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'card') {
                const subtotal = cart.getTotal();
                const totalUah = Math.round(subtotal * currentExchangeRate * 100) / 100;
                exchangeText.textContent = `${subtotal.toFixed(2)} zł = ${totalUah.toFixed(2)} грн`;
                currencyExchangeDiv.style.display = 'block';
            } else {
                currencyExchangeDiv.style.display = 'none';
            }

            if (window.cart?.updateCartSummary) {
                window.cart.updateCartSummary();
            }
            if (typeof window.displayCheckoutItems === 'function') {
                window.displayCheckoutItems();
            }
        });
    });

    const checked = document.querySelector('input[name="payment"]:checked');
    if (checked) {
        checked.dispatchEvent(new Event('change'));
    }
}

// Відправка повідомлення клієнту з WebApp
window.sendMessageToClient = async function () {
    const clientId = document.getElementById('messageClientId').value.trim();
    const message = document.getElementById('messageText').value.trim();

    if (!clientId || !message) {
        showToast('Заповніть всі поля!');
        return;
    }

    showLoading(true);

    try {
        const adminHeaders = getAdminHeaders();

        const response = await fetch(`${CONFIG.API_URL}/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            },
            body: JSON.stringify({
                clientId: clientId,
                message: message
            })
        });

        if (response.ok) {
            showToast('✅ Повідомлення відправлено!');
            document.getElementById('messageClientId').value = '';
            document.getElementById('messageText').value = '';
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося відправити'}`);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('❌ Помилка відправки');
    } finally {
        showLoading(false);
    }
}

// Вставка швидкого повідомлення
window.insertQuickMessage = function (text) {
    document.getElementById('messageText').value = text;
}

// Перенесення замовлень між користувачами
window.refreshClientProfiles = async function () {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/users/refresh-telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            }
        });

        if (response.ok) {
            const data = await response.json();
            showToast(`✅ Оновлено: ${data.updatedCount}`);
            await loadAdminClients();
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося оновити'}`);
        }
    } catch (error) {
        console.error('Error refreshing clients:', error);
        showToast('❌ Помилка оновлення');
    } finally {
        showLoading(false);
    }
}

window.sendBroadcastMessage = async function () {
    const message = document.getElementById('broadcastMessage')?.value.trim();
    const includeAdmin = document.getElementById('broadcastIncludeAdmin')?.checked || false;
    const resultEl = document.getElementById('broadcastResult');

    if (!message) {
        showToast('Введіть текст розсилки');
        return;
    }

    if (!confirm('Відправити повідомлення всім користувачам?')) {
        return;
    }

    showLoading(true);

    try {
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/messages/broadcast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            },
            body: JSON.stringify({
                message,
                includeAdmin
            })
        });

        if (response.ok) {
            const data = await response.json();
            showToast(`✅ Відправлено: ${data.sentCount}`);
            if (resultEl) {
                resultEl.textContent = `Успішно: ${data.sentCount}, помилки: ${data.failedCount}`;
            }
            document.getElementById('broadcastMessage').value = '';
            document.getElementById('broadcastIncludeAdmin').checked = false;
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося відправити'}`);
            if (resultEl) {
                resultEl.textContent = `Помилка: ${error.error || 'Не вдалося відправити'}`;
            }
        }
    } catch (error) {
        console.error('Error sending broadcast:', error);
        showToast('❌ Помилка розсилки');
        if (resultEl) {
            resultEl.textContent = 'Помилка розсилки';
        }
    } finally {
        showLoading(false);
    }
}

window.setDeliveryFee = async function (orderId) {
    if (!orderId) {
        showToast('❌ Немає ID замовлення');
        return;
    }

    const feeRaw = prompt('Введи суму доставки (zł):');
    if (feeRaw === null) {
        return;
    }

    const fee = parseFloat(feeRaw);
    if (!Number.isFinite(fee) || fee <= 0) {
        showToast('❌ Невірна сума доставки');
        return;
    }

    const note = prompt('Коментар (необовʼязково):') || '';

    showLoading(true);

    try {
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/orders/${orderId}/delivery-fee`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...adminHeaders
            },
            body: JSON.stringify({
                deliveryFee: fee,
                note: note.trim()
            })
        });

        if (response.ok) {
            showToast('✅ Доставку встановлено');
            loadAdminOrders();
        } else {
            const error = await response.json();
            showToast(`❌ Помилка: ${error.error || 'Не вдалося встановити доставку'}`);
        }
    } catch (error) {
        console.error('Error setting delivery fee:', error);
        showToast('❌ Помилка встановлення доставки');
    } finally {
        showLoading(false);
    }
}

window.deletePromo = async function (code) {
    if (!code) {
        return;
    }

    if (!confirm(`Видалити промокод ${code}?`)) {
        return;
    }

    showLoading(true);

    try {
        await apiCall('DELETE', `/promocodes/${encodeURIComponent(code)}`);
        showToast('✅ Промокод видалено');
        showAdminTab('promocodes');
    } catch (error) {
        showToast(`❌ Помилка: ${error.message}`);
    } finally {
        showLoading(false);
    }
}
