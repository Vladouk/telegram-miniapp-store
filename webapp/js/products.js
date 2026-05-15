// Products Management
class ProductManager {
    constructor() {
        this.products = CONFIG.PRODUCTS_SAMPLE;
        this.filteredProducts = [...this.products];
        this.currentFilter = 'all';
    }

    // Сортування товарів: недоступні внизу, доступні вверху
    sortByAvailability(products) {
        return [...products].sort((a, b) => {
            // Товари з stockQuantity > 0 йдуть вверху (1)
            // Товари з stockQuantity <= 0 йдуть внизу (0)
            const aInStock = a.stockQuantity > 0 ? 0 : 1;  // 0 для доступних (вверху), 1 для недоступних (внизу)
            const bInStock = b.stockQuantity > 0 ? 0 : 1;
            return aInStock - bInStock;
        });
    }

    async loadProducts() {
        try {
            const response = await apiCall('GET', '/products');
            if (Array.isArray(response) && response.length > 0) {
                this.products = response;
                this.filteredProducts = this.sortByAvailability(response);
            } else {
                this.products = CONFIG.PRODUCTS_SAMPLE;
                this.filteredProducts = this.sortByAvailability(this.products);
            }
        } catch (error) {
            console.error('Error loading products:', error);
            // Використання sample даних
            console.log('Using sample products');
            this.products = CONFIG.PRODUCTS_SAMPLE;
            this.filteredProducts = this.sortByAvailability(this.products);
        }
    }

    filterByCategory(category) {
        this.currentFilter = category;

        let filtered;
        if (category === 'all') {
            filtered = [...this.products];
        } else if (category === 'nicotine-free') {
            filtered = this.products.filter(p => p.nicotine_free);
        } else {
            filtered = this.products.filter(p => p.category === category);
        }

        this.filteredProducts = this.sortByAvailability(filtered);
        return this.filteredProducts;
    }

    searchProducts(query) {
        const q = query.toLowerCase();
        const filtered = this.products.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            (p.name_en && p.name_en.toLowerCase().includes(q)) ||
            (p.description_en && p.description_en.toLowerCase().includes(q))
        );
        this.filteredProducts = this.sortByAvailability(filtered);
        return this.filteredProducts;
    }

    getProductById(id) {
        return this.products.find(p => p.id === id);
    }

    renderProducts(container = null) {
        // Якщо контейнер не вказаний, вибираємо на основі активної сторінки
        if (!container) {
            const productsView = document.getElementById('productsView');
            if (productsView && productsView.style.display !== 'none') {
                container = 'productsList';
            } else {
                container = 'productsList';
            }
        }

        const element = document.getElementById(container);
        if (!element) return;

        element.innerHTML = '';

        if (this.filteredProducts.length === 0) {
            element.innerHTML = '<p style="text-align: center; padding: 40px; grid-column: 1/-1;">Товари не знайдені</p>';
            return;
        }

        this.filteredProducts.forEach(product => {
            const productCard = document.createElement('div');
            productCard.className = 'product-card';

            const isOutOfStock = product.stockQuantity <= 0;
            if (isOutOfStock) {
                productCard.classList.add('is-out');
                productCard.style.cursor = 'not-allowed';
            } else {
                productCard.onclick = () => showProductDetail(product.id);
            }

            const imageHtml = product.imageUrl && product.imageUrl !== `https://via.placeholder.com/200?text=${encodeURIComponent(product.name)}`
                ? `<img src="${product.imageUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;" onerror="this.parentElement.innerHTML='${product.emoji || '📦'}'; this.parentElement.style.fontSize='60px';">`
                : `${product.emoji || '📦'}`;

            productCard.innerHTML = `
                <div class="product-image">${imageHtml}</div>
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-category">${product.category}</div>
                    ${product.nicotine_free ? '<div style="color: #27ae60; font-weight: 600;">🚫 Без нікотину</div>' : ''}
                    ${isOutOfStock ? '<div style="color: #e74c3c; font-weight: 600;">❌ Немає в наявності</div>' : ''}
                    ${!isOutOfStock && product.stockQuantity < 10 ? `<div style="color: #f39c12; font-size: 12px;">Залишилось ${product.stockQuantity} шт.</div>` : ''}
                    <div class="product-price-row">
                        <div class="product-price">${product.price} грн</div>
                        ${!isOutOfStock ? `<button class="add-to-cart-btn" onclick="window.quickAddToCart(event, ${product.id})">+</button>` : ''}
                    </div>
                </div>
            `;

            element.appendChild(productCard);
        });
    }
}

// Інстанціювання
const products = new ProductManager();
window.products = products;

// Функція для відображення деталей товару
window.showProductDetail = async function (productId) {
    try {
        // Оновлюємо інформацію про товар з backend для актуальної інформації про склад
        const freshProduct = await apiCall('GET', `/products/${productId}`);

        // Оновлюємо локальний об'єкт товару
        const localProduct = products.getProductById(productId);
        if (localProduct && freshProduct) {
            localProduct.stockQuantity = freshProduct.stockQuantity;
        }

        const product = freshProduct || localProduct;
        if (!product) return;

        const isOutOfStock = product.stockQuantity <= 0;
        const maxQuantity = Math.min(product.stockQuantity || 99, 99);

        const imageHtml = product.imageUrl && product.imageUrl !== `https://via.placeholder.com/200?text=${encodeURIComponent(product.name)}`
            ? `<img src="${product.imageUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;" onerror="this.parentElement.innerHTML='${product.emoji || '📦'}'; this.parentElement.style.fontSize='80px';">`
            : `${product.emoji || '📦'}`;

        const productDetail = document.getElementById('productDetail');
        productDetail.innerHTML = `
        <button class="product-back" onclick="navigateTo('catalog')" aria-label="Назад">←</button>
        <div class="product-detail-image">${imageHtml}</div>
        <h2>${product.name}</h2>
        <div class="product-detail-meta">
            <span>${product.category}</span>
            ${product.brand ? `<span>🏷️ ${product.brand}</span>` : ''}
            ${product.nicotine_free ? '<span>🚫 Без нікотину</span>' : ''}
            ${isOutOfStock ? '<span style="color: #e74c3c;">❌ Немає в наявності</span>' : ''}
            ${!isOutOfStock && product.stockQuantity < 10 ? `<span style="color: #f39c12;">⚠️ Залишилось ${product.stockQuantity} шт.</span>` : ''}
            ${!isOutOfStock && product.stockQuantity >= 10 ? '<span style="color: #27ae60;">✅ В наявності</span>' : ''}
        </div>
        <p class="product-detail-description">${product.description}</p>
        <div class="product-detail-price">${product.price} грн</div>
        ${!isOutOfStock ? `
            <div class="quantity-selector">
                <button class="quantity-btn" onclick="decreaseQuantity()">−</button>
                <input type="number" id="quantityInput" class="quantity-input" value="1" min="1" max="${maxQuantity}">
                <button class="quantity-btn" onclick="increaseQuantity(${maxQuantity})">+</button>
            </div>
            <button onclick="addToCartFromDetail(${product.id})" class="btn btn-primary btn-full">
                🛒 Додати в кошик
            </button>
        ` : `
            <button disabled class="btn btn-full" style="background: #bdc3c7; cursor: not-allowed;">
                ❌ Товар закінчився
            </button>
        `}
    `;

        navigateTo('product');
    } catch (error) {
        console.error('Error loading product details:', error);
        const product = products.getProductById(productId);
        if (product) {
            // Якщо помилка при оновленні, показуємо локальні дані
            const isOutOfStock = product.stockQuantity <= 0;
            const maxQuantity = Math.min(product.stockQuantity || 99, 99);

            const imageHtml = product.imageUrl && product.imageUrl !== `https://via.placeholder.com/200?text=${encodeURIComponent(product.name)}`
                ? `<img src="${product.imageUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;" onerror="this.parentElement.innerHTML='${product.emoji || '📦'}'; this.parentElement.style.fontSize='80px';">`
                : `${product.emoji || '📦'}`;

            const productDetail = document.getElementById('productDetail');
            productDetail.innerHTML = `
                <button class="product-back" onclick="navigateTo('catalog')" aria-label="Назад">←</button>
                <div class="product-detail-image">${imageHtml}</div>
                <h2>${product.name}</h2>
                <div class="product-detail-meta">
                    <span>${product.category}</span>
                    ${product.brand ? `<span>🏷️ ${product.brand}</span>` : ''}
                    ${product.nicotine_free ? '<span>🚫 Без нікотину</span>' : ''}
                    ${isOutOfStock ? '<span style="color: #e74c3c;">❌ Немає в наявності</span>' : ''}
                    ${!isOutOfStock && product.stockQuantity < 10 ? `<span style="color: #f39c12;">⚠️ Залишилось ${product.stockQuantity} шт.</span>` : ''}
                    ${!isOutOfStock && product.stockQuantity >= 10 ? '<span style="color: #27ae60;">✅ В наявності</span>' : ''}
                </div>
                <p class="product-detail-description">${product.description}</p>
                <div class="product-detail-price">${product.price} грн</div>
                ${!isOutOfStock ? `
                    <div class="quantity-selector">
                        <button class="quantity-btn" onclick="decreaseQuantity()">−</button>
                        <input type="number" id="quantityInput" class="quantity-input" value="1" min="1" max="${maxQuantity}">
                        <button class="quantity-btn" onclick="increaseQuantity(${maxQuantity})">+</button>
                    </div>
                    <button onclick="addToCartFromDetail(${product.id})" class="btn btn-primary btn-full">
                        🛒 Додати в кошик
                    </button>
                ` : `
                    <button disabled class="btn btn-full" style="background: #bdc3c7; cursor: not-allowed;">
                        ❌ Товар закінчився
                    </button>
                `}
            `;
            navigateTo('product');
        }
    }
}

window.increaseQuantity = function (maxQuantity = 99) {
    const input = document.getElementById('quantityInput');
    input.value = Math.min(parseInt(input.value) + 1, maxQuantity);
}

window.decreaseQuantity = function () {
    const input = document.getElementById('quantityInput');
    input.value = Math.max(parseInt(input.value) - 1, 1);
}

window.addToCartFromDetail = function (productId) {
    const quantity = parseInt(document.getElementById('quantityInput').value) || 1;
    const product = products.getProductById(productId);

    if (!product) {
        showToast('❌ Товар не знайдено');
        return;
    }

    if (product.stockQuantity <= 0) {
        showToast('❌ Товар закінчився');
        return;
    }

    if (quantity > product.stockQuantity) {
        showToast(`❌ Доступно лише ${product.stockQuantity} шт.`);
        return;
    }

    cart.addItem(product, quantity);
}

// Функція для фільтрування товарів
window.filterProducts = function (category) {
    products.filterByCategory(category);

    // Оновлення активної кнопки фільтра
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    products.renderProducts();
}
