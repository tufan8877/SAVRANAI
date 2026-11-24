import { fileTypeFromBuffer } from 'file-type'
export const audioLimit = 10 * 1024 * 1024
export const fileLimit = 8 * 1024 * 1024
const audioFormats = new Map([['webm','audio/webm'],['mp4','audio/mp4'],['m4a','audio/mp4'],['ogg','audio/ogg'],['wav','audio/wav']])
export async function audioFormat(bytes: Uint8Array) {
  const result = await fileTypeFromBuffer(bytes).catch(() => undefined)
  const mime = result && audioFormats.get(result.ext)
  return result && mime && {extension:result.ext,mime}
}
export async function attachmentFormat(bytes: Uint8Array, declared: string) {
  const result = await fileTypeFromBuffer(bytes).catch(() => undefined)
  if (result && result.mime === declared && ['pdf','docx','png','jpg','webp'].includes(result.ext)) return result.ext
  if (!result && declared === 'text/plain') {
    try {
      const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes)
      if (text.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return 'txt'
    } catch { return undefined }
  }
}
