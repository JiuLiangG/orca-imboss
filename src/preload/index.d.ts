import type { IMB } from "./index";

declare global {
  declare const imb: IMB;

  interface Window {
    imb: IMB;
  }
}

export {};
