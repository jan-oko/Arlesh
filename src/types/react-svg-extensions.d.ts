export {};

declare module "react" {
  interface SVGAttributes<T> {
    draggable?: boolean;
  }
}
