export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function polygonCenter(points: Array<[number, number]>): [number, number] {
  const total = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return points.length ? [total[0] / points.length, total[1] / points.length] : [0, 0];
}
