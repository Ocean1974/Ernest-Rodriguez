import type { ReactNode } from "react";

export type SyntheticMapSceneProps = {
  children?: ReactNode;
};

export function SyntheticMapScene({ children }: SyntheticMapSceneProps) {
  return <div>{children}</div>;
}
