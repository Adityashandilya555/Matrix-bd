// skipcq: JS-0833
export function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}
