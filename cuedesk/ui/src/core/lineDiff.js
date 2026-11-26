/**
 * LCS-based line diff with common prefix/suffix trimming.
 * Aligns unchanged lines accurately so inserting or deleting a line at the top
 * does not mark subsequent unchanged lines as modified.
 */
export function computeLineDiff(beforeText, afterText) {
  const a = String(beforeText ?? '').replace(/\r\n/g, '\n').split('\n');
  const b = String(afterText ?? '').replace(/\r\n/g, '\n').split('\n');

  // Trim identical prefix and suffix first for fast O(N*M) DP on only the changed core
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const n = midA.length;
  const m = midB.length;

  const rows = [];
  for (let i = 0; i < prefix; i++) {
    rows.push({ kind: 'same', oldLine: i + 1, newLine: i + 1, line: i + 1, text: a[i] });
  }

  // Guard against extreme pathological files (> 3000x3000 changed lines) by falling back to greedy lookahead
  if (n * m <= 4_000_000) {
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);

    for (let i = n - 1; i >= 0; i--) {
      const row = dp[i];
      const nextRow = dp[i + 1];
      const lineA = midA[i];
      for (let j = m - 1; j >= 0; j--) {
        if (lineA === midB[j]) {
          row[j] = nextRow[j + 1] + 1;
        } else {
          row[j] = nextRow[j] >= row[j + 1] ? nextRow[j] : row[j + 1];
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        const oldLine = prefix + i + 1;
        const newLine = prefix + j + 1;
        rows.push({ kind: 'same', oldLine, newLine, line: newLine, text: midA[i] });
        i++;
        j++;
      } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
        const newLine = prefix + j + 1;
        rows.push({ kind: 'add', oldLine: null, newLine, line: newLine, text: midB[j] });
        j++;
      } else {
        const oldLine = prefix + i + 1;
        rows.push({ kind: 'del', oldLine, newLine: null, line: oldLine, text: midA[i] });
        i++;
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const oldLine = prefix + i + 1;
      rows.push({ kind: 'del', oldLine, newLine: null, line: oldLine, text: midA[i] });
    }
    for (let j = 0; j < m; j++) {
      const newLine = prefix + j + 1;
      rows.push({ kind: 'add', oldLine: null, newLine, line: newLine, text: midB[j] });
    }
  }

  for (let s = 0; s < suffix; s++) {
    const oldLine = a.length - suffix + s + 1;
    const newLine = b.length - suffix + s + 1;
    rows.push({ kind: 'same', oldLine, newLine, line: newLine, text: a[oldLine - 1] });
  }

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  for (const r of rows) {
    if (r.kind === 'add') addedCount++;
    else if (r.kind === 'del') removedCount++;
    else unchangedCount++;
  }

  return { rows, addedCount, removedCount, unchangedCount };
}
