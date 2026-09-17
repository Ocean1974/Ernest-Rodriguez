import type { ReactNode } from "react";

export type LiveTileMapBackgroundProps = {
  children?: ReactNode;
};

export function LiveTileMapBackground({ children }: LiveTileMapBackgroundProps) {
  return <div>{children}</div>;
}
