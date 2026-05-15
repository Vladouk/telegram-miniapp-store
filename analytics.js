import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// Fix BigInt serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

async function generateAnalyticsReport() {
  try {
    console.log("📊 Генерую аналітичний звіт...\n");

    // 1. Get out of stock products
    console.log("📦 Завантажую дані про продукти...");
    const allProducts = await prisma.product.findMany();
    const outOfStockProducts = allProducts.filter(
      (p) => !p.inStock || p.stockQuantity === 0
    );

    // 2. Get all orders with products
    console.log("📝 Завантажую дані про замовлення...");
    const allOrders = await prisma.order.findMany({
      include: {
        products: true,
      },
    });

    // 3. Calculate statistics
    const productStats = {};

    for (const order of allOrders) {
      for (const orderProduct of order.products) {
        if (!productStats[orderProduct.productId]) {
          const product = allProducts.find((p) => p.id === orderProduct.productId);
          productStats[orderProduct.productId] = {
            id: orderProduct.productId,
            name: product?.name || "Unknown",
            nameUk: product?.name || "Unknown",
            category: product?.category || "Unknown",
            brand: product?.brand || "Unknown",
            price: product?.price || 0,
            totalUnitsSold: 0,
            totalRevenue: 0,
            orderCount: 0,
            lastOrderDate: null,
            ordersPerDay: 0,
          };
        }

        productStats[orderProduct.productId].totalUnitsSold +=
          orderProduct.quantity;
        productStats[orderProduct.productId].totalRevenue +=
          orderProduct.price * orderProduct.quantity;
        productStats[orderProduct.productId].orderCount += 1;

        const orderDate = new Date(order.createdAt);
        if (
          !productStats[orderProduct.productId].lastOrderDate ||
          orderDate > productStats[orderProduct.productId].lastOrderDate
        ) {
          productStats[orderProduct.productId].lastOrderDate = orderDate;
        }
      }
    }

    // Calculate days on market and velocity
    const now = new Date();
    const statsArray = Object.values(productStats).map((stat) => {
      const daysOnMarket = stat.lastOrderDate
        ? Math.max(1, (now - new Date(stat.lastOrderDate)) / (1000 * 60 * 60 * 24))
        : 0;
      const velocity = daysOnMarket > 0 ? stat.totalUnitsSold / daysOnMarket : 0;

      return {
        ...stat,
        daysOnMarket: Math.round(daysOnMarket),
        velocity: parseFloat(velocity.toFixed(2)), // units per day
      };
    });

    // Sort by velocity (speed of sales)
    const byVelocity = [...statsArray].sort((a, b) => b.velocity - a.velocity);

    // Sort by total units sold (popularity)
    const byPopularity = [...statsArray].sort(
      (a, b) => b.totalUnitsSold - a.totalUnitsSold
    );

    // 4. Generate reports
    console.log("\n✅ Генеруємо експорти...\n");

    // Report 1: Out of Stock
    const outOfStockReport = {
      generatedAt: new Date().toISOString(),
      title: "🔴 ПРОДУКТИ ЯКІ ЗАКІНЧИЛИСЯ (Для дозамовки)",
      totalOutOfStock: outOfStockProducts.length,
      products: outOfStockProducts.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        brand: p.brand,
        price: p.price,
        lastStockLevel: p.stockQuantity,
        inStock: p.inStock,
      })),
    };

    // Report 2: Popularity ranking
    const popularityReport = {
      generatedAt: new Date().toISOString(),
      title: "🏆 РЕЙТИНГ ПОПУЛЯРНОСТІ (Найбільше розкупляють)",
      totalProducts: byPopularity.length,
      topProducts: byPopularity.slice(0, 20).map((p, idx) => ({
        rank: idx + 1,
        id: p.id,
        name: p.nameUk,
        category: p.category,
        brand: p.brand,
        price: p.price,
        totalUnitsSold: p.totalUnitsSold,
        orderCount: p.orderCount,
        totalRevenue: parseFloat(p.totalRevenue.toFixed(2)),
        averagePerOrder: parseFloat((p.totalUnitsSold / p.orderCount).toFixed(2)),
      })),
    };

    // Report 3: Velocity ranking
    const velocityReport = {
      generatedAt: new Date().toISOString(),
      title: "⚡ ШВИДКІСТЬ РОЗКУПКИ (За скільки днів розходяться)",
      totalProducts: byVelocity.length,
      topProducts: byVelocity.slice(0, 20).map((p, idx) => ({
        rank: idx + 1,
        id: p.id,
        name: p.nameUk,
        category: p.category,
        brand: p.brand,
        price: p.price,
        unitsPerDay: p.velocity,
        daysOnMarket: p.daysOnMarket,
        totalUnitsSold: p.totalUnitsSold,
        lastOrderDate: p.lastOrderDate,
        estimatedDaysToSellOne: p.velocity > 0 ? parseFloat((1 / p.velocity).toFixed(2)) : "N/A",
      })),
    };

    // Save reports
    const reportsDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split("T")[0];

    fs.writeFileSync(
      path.join(reportsDir, `out-of-stock-${timestamp}.json`),
      JSON.stringify(outOfStockReport, null, 2)
    );

    fs.writeFileSync(
      path.join(reportsDir, `popularity-${timestamp}.json`),
      JSON.stringify(popularityReport, null, 2)
    );

    fs.writeFileSync(
      path.join(reportsDir, `velocity-${timestamp}.json`),
      JSON.stringify(velocityReport, null, 2)
    );

    // Also save as CSV for easy import to Excel
    saveCsvReports(reportsDir, timestamp, outOfStockReport, popularityReport, velocityReport);

    // Print summary
    console.log("═══════════════════════════════════════════════════════");
    console.log("📊 ЗВІТ ЗАВЕРШЕНИЙ\n");

    console.log(`🔴 ЗАКІНЧИЛОСЯ ПРОДУКТІВ: ${outOfStockProducts.length}`);
    console.log(
      `   Перші 5: ${outOfStockProducts
        .slice(0, 5)
        .map((p) => `"${p.name}"`)
        .join(", ")}`
    );

    console.log(`\n🏆 ТОП 5 ПО ПОПУЛЯРНОСТІ (Найбільше розкупляють):`);
    byPopularity.slice(0, 5).forEach((p, i) => {
      console.log(
        `   ${i + 1}. "${p.nameUk}" - ${p.totalUnitsSold} шт. (${p.orderCount} замовлень)`
      );
    });

    console.log(`\n⚡ ТОП 5 ПО ШВИДКОСТІ РОЗКУПКИ:`);
    byVelocity.slice(0, 5).forEach((p, i) => {
      console.log(
        `   ${i + 1}. "${p.nameUk}" - ${p.velocity} шт/день (1 шт за ${(1 / p.velocity).toFixed(1)} днів)`
      );
    });

    console.log(`\n📁 Експорти збережено в папці: ./reports/`);
    console.log("═══════════════════════════════════════════════════════\n");

  } catch (error) {
    console.error("❌ Помилка при генеруванні звіту:", error);
  } finally {
    await prisma.$disconnect();
  }
}

function saveCsvReports(reportsDir, timestamp, outOfStockReport, popularityReport, velocityReport) {
  // Out of stock CSV
  let outOfStockCsv =
    "ID,Назва,Категорія,Бренд,Ціна,Остаток\n";
  outOfStockReport.products.forEach((p) => {
    outOfStockCsv += `${p.id},"${p.name.replace(/"/g, '""')}","${p.category}","${p.brand || ""}",${p.price},${p.lastStockLevel}\n`;
  });

  // Popularity CSV
  let popularityCsv =
    "Ранг,ID,Назва,Категорія,Бренд,Ціна,Продано_Шт,Замовлень,Виручка,Середньо_За_Замовлення\n";
  popularityReport.topProducts.forEach((p) => {
    popularityCsv += `${p.rank},${p.id},"${p.name.replace(/"/g, '""')}","${p.category}","${p.brand || ""}",${p.price},${p.totalUnitsSold},${p.orderCount},${p.totalRevenue},${p.averagePerOrder}\n`;
  });

  // Velocity CSV
  let velocityCsv =
    "Ранг,ID,Назва,Категорія,Бренд,Ціна,Шт_На_День,Днів_На_Ринку,Всього_Продано,Останнє_Замовлення,Днів_На_1_Шт\n";
  velocityReport.topProducts.forEach((p) => {
    velocityCsv += `${p.rank},${p.id},"${p.name.replace(/"/g, '""')}","${p.category}","${p.brand || ""}",${p.price},${p.unitsPerDay},${p.daysOnMarket},${p.totalUnitsSold},"${p.lastOrderDate}",${p.estimatedDaysToSellOne}\n`;
  });

  fs.writeFileSync(
    path.join(reportsDir, `out-of-stock-${timestamp}.csv`),
    outOfStockCsv
  );

  fs.writeFileSync(
    path.join(reportsDir, `popularity-${timestamp}.csv`),
    popularityCsv
  );

  fs.writeFileSync(
    path.join(reportsDir, `velocity-${timestamp}.csv`),
    velocityCsv
  );
}

// Run the analytics
generateAnalyticsReport();
