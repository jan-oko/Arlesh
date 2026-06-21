export {};

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface SVGAttributes<T> {
    draggable?: boolean;
  }
}
