/**
 * 头像压缩：统一把照片压到「够用就好」的尺寸再上传。
 *
 * 系统里头像最大只显示 96px（列表 32~36px），480px 已有 5 倍冗余，
 * 压完约 30KB —— 上传从 5 秒降到 1 秒内，肉眼无差别。
 *
 * 用法：
 *   compressImageFile(file)           → Blob（可直接 upload）
 *   compressImageToDataUrl(dataUrl)   → dataURL（批量导入等场景）
 */
export const AVATAR_MAX_DIM = 480;
export const AVATAR_QUALITY = 0.82;
/** 小于该体积的图片不再压缩，省一次编解码（毫秒级，但没必要浪费） */
const SKIP_COMPRESS_BELOW = 60 * 1024;

function drawToCanvas(source: CanvasImageSource, width: number, height: number, maxDim: number) {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  // JPEG 不支持透明，先铺白底，避免 PNG 透明区域变黑
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** 把 File/Blob 压缩成 JPEG Blob（上传用）。小图直接原样返回。 */
export async function compressImageFile(
  file: Blob,
  maxDim = AVATAR_MAX_DIM,
  quality = AVATAR_QUALITY,
): Promise<Blob> {
  if (file.size < SKIP_COMPRESS_BELOW) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height, maxDim);
    if ('close' in bitmap) (bitmap as ImageBitmap).close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file; // 压缩失败就传原图，不阻断流程
  }
}

/** 把 dataURL 压缩成 JPEG dataURL（批量导入等场景） */
export function compressImageToDataUrl(
  dataUrl: string,
  maxDim = AVATAR_MAX_DIM,
  quality = AVATAR_QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = drawToCanvas(img, img.width, img.height, maxDim);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}
