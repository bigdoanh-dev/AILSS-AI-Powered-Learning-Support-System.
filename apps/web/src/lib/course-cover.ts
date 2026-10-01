export async function readCourseCover(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error("Chọn ảnh PNG/JPG/WEBP tối đa 5 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(960, image.width);
    canvas.height = Math.max(1, Math.round((image.height * canvas.width) / image.width));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không thể đọc ảnh.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const value = canvas.toDataURL("image/jpeg", 0.65);
    if (value.length > 350000) throw new Error("Ảnh còn quá lớn sau khi thu nhỏ. Hãy chọn ảnh khác.");
    return value;
  } finally {
    URL.revokeObjectURL(source);
  }
}
