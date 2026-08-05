export function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}
