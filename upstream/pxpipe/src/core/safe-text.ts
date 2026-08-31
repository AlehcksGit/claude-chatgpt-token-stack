/** Linear scans for text that may contain arbitrarily long model input. */
export function stripVariantTags(value: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = value.indexOf('[', cursor);
    if (open < 0) break;
    const close = value.indexOf(']', open + 1);
    if (close < 0) break;
    pieces.push(value.slice(cursor, open));
    cursor = close + 1;
  }
  pieces.push(value.slice(cursor));
  return pieces.join('');
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}
