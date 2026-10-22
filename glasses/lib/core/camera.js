// 자동 복사본 — 원본: RokidAI/agent/lib (수정은 원본에서 하고 tools/sync-lifepilot-core.mjs 실행)
// 카메라 캡처. "요청 1회 = 캡처 1회" 원칙. 연속 감시는 하지 않는다.
// 문서: aiui-dev/references/apis/wx.md (CameraContext.takePhoto는 상호작용 호출 지점 필요)

import wx from 'wx';
import { AssistantError, ERR, toAssistantError } from './errors.js';

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return null;
}

/** @returns {Promise<{dataUrl: string, mimeType: string, bytes: number}>} */
export async function captureStill() {
  if (!wx || !wx.media || typeof wx.media.createCameraContext !== 'function') {
    throw new AssistantError(ERR.UNAVAILABLE, 'camera API missing');
  }
  const ctx = wx.media.createCameraContext();
  if (!ctx) throw new AssistantError(ERR.UNAVAILABLE, 'camera context unavailable');

  let photo;
  try {
    photo = await ctx.takePhoto({ quality: 'high' });
  } catch (error) {
    const err = toAssistantError(error);
    // takePhoto 실패는 일반 예외로만 온다. 권한 문제일 가능성이 가장 높다.
    if (err.code === ERR.UNKNOWN) err.code = ERR.PERMISSION;
    throw err;
  }

  const buffer = photo ? toArrayBuffer(photo.data) : null;
  if (!buffer || !buffer.byteLength || !photo.mimeType) throw new AssistantError(ERR.UNCLEAR, 'empty photo');
  if (typeof wx.arrayBufferToBase64 !== 'function') throw new AssistantError(ERR.UNAVAILABLE, 'base64 encoder missing');

  return {
    dataUrl: `data:${photo.mimeType};base64,${wx.arrayBufferToBase64(buffer)}`,
    mimeType: photo.mimeType,
    bytes: buffer.byteLength,
  };
}
