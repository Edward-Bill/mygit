const { createCanvas } = require("canvas");
const fs = require("fs");

/**
 * Генерация всех сегментов радиального меню (полые сектора)
 *
 * @param {number} count - количество сегментов (например 3 → по 120°)
 * @param {number} innerOffset - смещение внутреннего радиуса (толщина пустоты)
 * @param {number} size - размер изображения (px × px)
 */
function generateSegment(count, innerOffset, size) {
    const angleSize = 360 / count;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    const finalRotation = 90;
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = size / 2;
    const innerRadius = outerRadius - innerOffset;

    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();

    const half = angleSize / 2;
    const start = (-half + finalRotation) * Math.PI / 180;
    const end = (half + finalRotation) * Math.PI / 180;

    ctx.arc(cx, cy, outerRadius, start, end);

    ctx.arc(cx, cy, innerRadius, end, start, true);

    ctx.closePath();
    ctx.fillStyle = "white";
    ctx.fill();


    const filename = `segment_${count}_${size}.png`;
    fs.writeFileSync(filename, canvas.toBuffer("image/png"));

    console.log("✔ Сегмент сохранён:", filename);
}

for (let count of [3, 4, 5, 6, 7, 8]) {
    generateSegment(count, 200, 1024);
}