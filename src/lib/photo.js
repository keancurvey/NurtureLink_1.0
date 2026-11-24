// The profile photo (PAT-P-01) is made smaller on the phone before it is saved: a square of at most PHOTO_SIZE pixels,
// cut from the middle of the picture. Nothing leaves the phone and the original is never kept.
export const PHOTO_SIZE = 256;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** The square cut from the middle of a picture, and the size it is drawn at: { sx, sy, side, size }. */
export function squareCrop(width, height, max = PHOTO_SIZE) {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side, size: Math.min(max, side) };
}

/** Why a file cannot be used, or null: 'type' (not a picture of a kind the phone shows everywhere) or 'size'. */
export function photoProblem(file) {
  if (!file || !PHOTO_TYPES.includes(file.type)) return 'type';
  if (file.size > PHOTO_MAX_BYTES) return 'size';
  return null;
}

/** Browser only: the chosen file as a small JPEG data URL. Rejects with an Error whose message is 'unreadable' when it cannot be read. */
export async function downscalePhoto(file, max = PHOTO_SIZE) {
  try {
    const bitmap = await createImageBitmap(file);
    const { sx, sy, side, size } = squareCrop(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, size, size);
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    throw new Error('unreadable');
  }
}

/** A picture scaled down to fit inside max by max, keeping its shape and never made larger: { width, height }. */
export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Browser only: a photo for a chat message, as a small JPEG data URL no larger than `max` on its long side. */
export async function downscaleAttachment(file, max, quality) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    throw new Error('unreadable');
  }
}
