export type DiffLine = {text: string; kind: "same" | "remove" | "add"};

/** Preserve both snapshots; bound the matching work for large knowledge documents. */
export function knowledgeDiff(before: string, after: string): DiffLine[] {
  const lines = (text: string) => text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
  const left = lines(before), right = lines(after);
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
  const result: DiffLine[] = left.slice(0, prefix).map(text => ({text, kind: "same"}));
  if ((a.length + 1) * (b.length + 1) > 1_000_000) {
    result.push(...a.map(text => ({text, kind: "remove" as const})), ...b.map(text => ({text, kind: "add" as const})));
  } else {
    const width = b.length + 1;
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] = a[i] === b[j] ? 1 + lengths[(i + 1) * width + j + 1] : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {result.push({text: a[i++], kind: "same"}); j++;}
      else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) result.push({text: a[i++], kind: "remove"});
      else result.push({text: b[j++], kind: "add"});
    }
  }
  result.push(...left.slice(left.length - suffix).map(text => ({text, kind: "same" as const})));
  return result;
}
