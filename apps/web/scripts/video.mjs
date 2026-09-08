import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent('<canvas id="film" width="1280" height="720"></canvas>');
const base64 = await page.evaluate(async () => {
  const canvas = document.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 900000,
  });
  const chunks = [];
  const titles = [
    "Tài liệu của bạn",
    "Trích xuất riêng tư",
    "AI tạo bản nháp",
    "Giảng viên rà soát",
    "Con người phê duyệt",
    "Assessment DRAFT",
  ];
  const captions = [
    "PDF · DOCX · TXT",
    "Xác minh nội dung trước khi xử lý",
    "Câu hỏi có cấu trúc objective-v1",
    "Kiểm tra câu hỏi và đáp án",
    "Chỉ duyệt nội dung phù hợp",
    "AI không tự xuất bản quiz",
  ];
  const result = new Promise((resolve) => {
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
    };
  });
  const start = performance.now();
  function frame(now) {
    const seconds = (now - start) / 1000;
    const active = Math.min(5, Math.floor(seconds / 3));
    ctx.fillStyle = "#060d20";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = "#77dfff";
    ctx.font = "bold 32px Arial";
    ctx.fillText("NVD / AILSS", 80, 95);
    ctx.fillStyle = "#b9c5da";
    ctx.font = "20px Arial";
    ctx.fillText("MINH HỌA QUY TRÌNH AI", 80, 144);
    ctx.fillStyle = "white";
    ctx.font = "bold 60px Arial";
    ctx.fillText(titles[active], 80, 275);
    ctx.fillStyle = "#77dfff";
    ctx.font = "28px Arial";
    ctx.fillText(captions[active], 80, 332);
    ctx.strokeStyle = "#2c3b58";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(130, 460);
    ctx.lineTo(1130, 460);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i <= active ? "#1760ef" : "#101c35";
      ctx.beginPath();
      ctx.arc(130 + i * 200, 460, i === active ? 34 : 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "24px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), 130 + i * 200, 469);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#b9c5da";
    ctx.font = "22px Arial";
    ctx.fillText("AI hỗ trợ. Giảng viên quyết định.", 80, 600);
    ctx.fillStyle = "#1760ef";
    ctx.fillRect(80, 650, 1120 * Math.min(seconds / 18, 1), 4);
    if (seconds < 18) requestAnimationFrame(frame);
    else {
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    }
  }
  recorder.start();
  requestAnimationFrame(frame);
  return result;
});
await fs.writeFile("public/assets/media/ailss-workflow.webm", Buffer.from(base64, "base64"));
await browser.close();
console.log("Original 18 second workflow WebM generated.");
