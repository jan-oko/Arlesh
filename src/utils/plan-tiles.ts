/**
 * How many columns lay `count` drop tiles out on the phone: up to three in one row, else two rows
 * (4 as 2 + 2, 5 as 3 + 2, 6 as 3 + 3, 7 as 4 + 3).
 */
export function tileColumns(count: number): number {
  return count <= 3 ? Math.max(count, 1) : Math.ceil(count / 2);
}
