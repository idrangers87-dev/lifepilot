// 촬영 이미지를 안경에서 긴 변 1024px JPEG로 줄여 업로드 시간을 줄인다(최선 노력).
// 문서화된 API만 사용: createImageBitmap(Blob), new Canvas(w, h), getContext('2d').drawImage,
// canvas.convertToBlob({ type: 'image/jpeg', quality }), wx.arrayBufferToBase64.
// 하나라도 실패하면 원본을 그대로 보내고, 서버(Pillow)가 줄인다.

import wx from 'wx';

const MAX_EDGE = 1024;

function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

/** @param {{dataUrl: string}} shot core/camera.js captureStill 결과 */
export async function prepareImage(shot) {
  let bitmap = null;
  try {
    if (typeof createImageBitmap !== 'function' || typeof Canvas === 'undefined' || typeof File === 'undefined') {
      return { dataUrl: shot.dataUrl, resized: false };
    }
    const parsed = dataUrlToBytes(shot.dataUrl);
    if (!parsed) return { dataUrl: shot.dataUrl, resized: false };
    bitmap = await createImageBitmap(new File([parsed.bytes], 'photo', { type: parsed.mime }));
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new Canvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const buffer = await blob.arrayBuffer();
    return { dataUrl: `data:image/jpeg;base64,${wx.arrayBufferToBase64(buffer)}`, resized: true, width: w, height: h };
  } catch (_) {
    return { dataUrl: shot.dataUrl, resized: false };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      try {
        bitmap.close();
      } catch (_) {}
    }
  }
}
