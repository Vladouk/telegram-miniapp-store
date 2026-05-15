// Analytics and Export Functions for Admin Panel

window.sendOutOfStockReport = async function() {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/analytics/out-of-stock-report`, {
            headers: adminHeaders
        });
        
        if (!response.ok) throw new Error('Failed to fetch out of stock report');
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ Звіт отправлено в чат (${data.messagesSent} повідомлень)`);
        } else {
            showToast(`❌ Помилка: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('❌ Помилка при отправці звіту');
    } finally {
        showLoading(false);
    }
};

window.downloadOutOfStock = async function() {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/analytics/out-of-stock`, {
            headers: adminHeaders
        });
        
        if (!response.ok) throw new Error('Failed to fetch out of stock data');
        const data = await response.json();
        downloadCSV(data, 'out-of-stock');
    } catch (error) {
        console.error('Error:', error);
        showToast('❌ Помилка при експорті');
    } finally {
        showLoading(false);
    }
};

window.downloadPopularProducts = async function() {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/analytics/popular`, {
            headers: adminHeaders
        });
        
        if (!response.ok) throw new Error('Failed to fetch popular products');
        const data = await response.json();
        downloadCSV(data, 'popular-products');
    } catch (error) {
        console.error('Error:', error);
        showToast('❌ Помилка при експорті');
    } finally {
        showLoading(false);
    }
};

window.downloadFastSelling = async function() {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/analytics/velocity`, {
            headers: adminHeaders
        });
        
        if (!response.ok) throw new Error('Failed to fetch fast selling products');
        const data = await response.json();
        downloadCSV(data, 'fast-selling');
    } catch (error) {
        console.error('Error:', error);
        showToast('❌ Помилка при експорті');
    } finally {
        showLoading(false);
    }
};

window.downloadAllAnalytics = async function() {
    try {
        showLoading(true);
        const adminHeaders = getAdminHeaders();
        const response = await fetch(`${CONFIG.API_URL}/analytics/all`, {
            headers: adminHeaders
        });
        
        if (!response.ok) throw new Error('Failed to fetch all analytics');
        const data = await response.json();
        downloadJSON(data, 'analytics-report');
    } catch (error) {
        console.error('Error:', error);
        showToast('❌ Помилка при експорті');
    } finally {
        showLoading(false);
    }
};

function downloadCSV(data, filename) {
    if (!data || !data.products || data.products.length === 0) {
        showToast('❌ Немає даних для експорту');
        return;
    }

    const products = data.products;
    let csv = '';

    // Headers
    const keys = Object.keys(products[0]);
    csv += keys.map(k => `"${k}"`).join(',') + '\n';

    // Data rows
    products.forEach(product => {
        csv += keys.map(k => {
            let value = product[k];
            if (value === null || value === undefined) value = '';
            if (typeof value === 'string') {
                value = value.replace(/"/g, '""'); // Escape quotes
                value = `"${value}"`;
            }
            return value;
        }).join(',') + '\n';
    });

    downloadFile(csv, `${filename}-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    showToast(`✅ Експортовано ${products.length} записів`);
}

function downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${filename}-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    showToast('✅ Звіт експортовано');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

window.loadAnalyticsData = async function() {
    try {
        const adminHeaders = getAdminHeaders();
        const statsContainer = document.getElementById('analyticsStats');
        
        if (!statsContainer) return;

        // Load analytics summary
        const response = await fetch(`${CONFIG.API_URL}/analytics/summary`, {
            headers: adminHeaders
        });

        if (!response.ok) {
            statsContainer.innerHTML = '<p style="color: red;">Помилка при завантаженні даних</p>';
            return;
        }

        const data = response.json();
        
        statsContainer.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div style="background: var(--bg); padding: 16px; border-radius: 8px;">
                    <div style="font-size: 12px; color: var(--text-light); margin-bottom: 8px;">Закінчилось товарів</div>
                    <div style="font-size: 24px; font-weight: bold; color: #ff6b6b;">
                        ${data.outOfStockCount || 0}
                    </div>
                </div>
                <div style="background: var(--bg); padding: 16px; border-radius: 8px;">
                    <div style="font-size: 12px; color: var(--text-light); margin-bottom: 8px;">Всього товарів</div>
                    <div style="font-size: 24px; font-weight: bold; color: #4ecdc4;">
                        ${data.totalProductsCount || 0}
                    </div>
                </div>
                <div style="background: var(--bg); padding: 16px; border-radius: 8px;">
                    <div style="font-size: 12px; color: var(--text-light); margin-bottom: 8px;">Замовлень сьогодні</div>
                    <div style="font-size: 24px; font-weight: bold; color: #95e1d3;">
                        ${data.ordersToday || 0}
                    </div>
                </div>
                <div style="background: var(--bg); padding: 16px; border-radius: 8px;">
                    <div style="font-size: 12px; color: var(--text-light); margin-bottom: 8px;">Загальна виручка</div>
                    <div style="font-size: 24px; font-weight: bold; color: #ffeaa7;">
                        ${(data.totalRevenue || 0).toFixed(2)} zł
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading analytics:', error);
        const statsContainer = document.getElementById('analyticsStats');
        if (statsContainer) {
            statsContainer.innerHTML = '<p style="color: red;">Помилка при завантаженні даних</p>';
        }
    }
};
