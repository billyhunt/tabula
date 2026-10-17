interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Orders boxes the way a page is read: rows top to bottom, each row left to
 * right. A box joins the current row while its top is above the vertical
 * centre of the row's first box, so hand-placed shapes that are only roughly
 * aligned still read as one row.
 */
export const readingOrder = <T extends Box>(boxes: readonly T[]): T[] => {
  const rows: T[][] = []
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1)
    if (row && box.y < row[0].y + Math.abs(row[0].height) / 2) row.push(box)
    else rows.push([box])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}
