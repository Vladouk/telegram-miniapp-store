// Cart Management
class Cart {
    constructor() {
        this.items = this.loadCart();
    }

    loadCart() {
        const saved = localStorage.getItem('vaper_cart');
        return saved ? JSON.parse(saved) : [];
    }

    saveCart() {
        localStorage.setItem('vaper_cart', JSON.stringify(this.items));
        this.updateCartUI();
    }

    addItem(product, quantity = 1) {
        // Перевірка доступної кількості
        if (product.stockQuantity <= 0) {
            showToast(`❌ ${product.name} закінчився!`);
            return;
        }

        const existing = this.items.find(item => item.id === product.id);
        const totalQuantity = (existing ? existing.quantity : 0) + quantity;

        if (totalQuantity > product.stockQuantity) {
            showToast(`❌ ${product.name}: можна замовити лише ${product.stockQuantity} шт. (вже в кошику ${existing ? existing.quantity : 0})`);
            return;
        }

        if (existing) {
            existing.quantity += quantity;
        } else {
            this.items.push({
                ...product,
                quantity: quantity
            });
        }
        this.saveCart();
        showToast(`${product.name} додано в кошик! ✅`);
    }

    removeItem(productId) {
        this.items = this.items.filter(item => item.id !== productId);
        this.saveCart();
    }

    updateQuantity(productId, quantity) {
        const item = this.items.find(item => item.id === productId);
        if (item) {
            // Перевірка наявності
            if (quantity > item.stockQuantity) {
                showToast(`❌ Ви перевищили ліміт наявності! Доступно: ${item.stockQuantity} шт.`);
                return;
            }

            if (quantity <= 0) {
                this.removeItem(productId);
            } else {
                item.quantity = quantity;
                this.saveCart();
            }
        }
    }

    getTotal() {
        return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }

    getCount() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }

    clear() {
        this.items = [];
        this.saveCart();
    }

    updateCartUI() {
        const count = this.getCount();
        const cartCountBadge = document.getElementById('cartCount');
        const homeCartCount = document.getElementById('homeCartCount');

        if (count > 0) {
            cartCountBadge.textContent = count;
            cartCountBadge.style.display = 'flex';
            homeCartCount.textContent = `${count} позицій`;
        } else {
            cartCountBadge.style.display = 'none';
            homeCartCount.textContent = '0 позицій';
        }

        // Оновлення сторінки кошика
        const cartEmpty = document.getElementById('cartEmpty');
        const cartContent = document.getElementById('cartContent');

        if (count === 0) {
            cartEmpty.style.display = 'block';
            cartContent.style.display = 'none';
        } else {
            cartEmpty.style.display = 'none';
            cartContent.style.display = 'block';
            this.renderCartItems();
            this.updateCartSummary();
        }
    }

    renderCartItems() {
        const cartItemsContainer = document.getElementById('cartItems');
        cartItemsContainer.innerHTML = '';

        this.items.forEach(item => {
            const cartItem = document.createElement('div');
            cartItem.className = 'cart-item';
            cartItem.innerHTML = `
                <div class="cart-item-image">${item.emoji || '📦'}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">${item.price}грн</div>
                    <div class="cart-item-quantity">
                        <button class="cart-item-qty-btn" onclick="cart.updateQuantity(${item.id}, ${item.quantity - 1})">−</button>
                        <span>${item.quantity}</span>
                        <button class="cart-item-qty-btn" onclick="cart.updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                    </div>
                </div>
                <button class="cart-item-remove" onclick="cart.removeItem(${item.id})">🗑️</button>
            `;
            cartItemsContainer.appendChild(cartItem);
        });
    }

    updateCartSummary() {
        const subtotal = this.getTotal();
        const discount = parseFloat(localStorage.getItem('vaper_discount') || 0);
        const deliveryType = localStorage.getItem('vaper_delivery_type');
        const estimateRaw = parseFloat(localStorage.getItem('vaper_delivery_fee_estimate') || 0);
        const deliveryEstimate = deliveryType === 'delivery' && Number.isFinite(estimateRaw) && estimateRaw > 0
            ? estimateRaw
            : 0;
        const total = Math.max(subtotal - discount + deliveryEstimate, 0);

        document.getElementById('subtotal').textContent = `${subtotal.toFixed(2)}грн`;
        document.getElementById('total').textContent = `${total.toFixed(2)}грн`;

        const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value;
        if (paymentMethod === 'card') {
            const exchangeRate = window.currentExchangeRate || 11.6;
            const totalUah = Math.round(total * exchangeRate * 100) / 100;
            document.getElementById('checkoutTotal').textContent = `${total.toFixed(2)}грн (${totalUah.toFixed(2)} грн)`;
        } else {
            document.getElementById('checkoutTotal').textContent = `${total.toFixed(2)}грн`;
        }

        if (discount > 0) {
            document.getElementById('discountItem').style.display = 'flex';
            document.getElementById('discount').textContent = `-${discount.toFixed(2)}грн`;
        } else {
            document.getElementById('discountItem').style.display = 'none';
        }

        const deliveryItem = document.getElementById('deliveryEstimateItem');
        const deliveryAmount = document.getElementById('deliveryEstimateAmount');
        if (deliveryItem && deliveryAmount) {
            if (deliveryEstimate > 0) {
                deliveryItem.style.display = 'flex';
                deliveryAmount.textContent = `${deliveryEstimate.toFixed(2)}грн`;
            } else {
                deliveryItem.style.display = 'none';
            }
        }
    }
}

// Інстанціювання
const cart = new Cart();
window.cart = cart;

// Функція для застосування промокода
window.applyPromo = async function () {
    const promoInput = document.getElementById('promoInput');
    const code = promoInput.value.trim().toUpperCase();

    if (!code) {
        showToast('Введи промокод');
        return;
    }

    showLoading(true);

    try {
        const response = await apiCall('GET', `/promocodes/${code}?purchase_amount=${cart.getTotal()}`);

        if (response.valid) {
            const promo = response.promo;
            let discount = 0;

            if (promo.discount_type === 'percent') {
                discount = cart.getTotal() * (promo.discount_value / 100);
            } else {
                discount = promo.discount_value;
            }

            localStorage.setItem('vaper_discount', discount);
            localStorage.setItem('vaper_promocode', code);

            showToast(`Промокод застосовано! Знижка: ${discount.toFixed(2)}грн ✨`);
            cart.updateCartSummary();
            promoInput.value = '';
        } else {
            showToast(response.message || 'Невалідний промокод');
        }
    } catch (error) {
        console.error('Promo error:', error);
        showToast('Помилка при перевірці промокода');
    } finally {
        showLoading(false);
    }
}
