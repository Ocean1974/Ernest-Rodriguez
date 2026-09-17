export type ScreenBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function intersectsScreenBounds(a: ScreenBounds, b: ScreenBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
