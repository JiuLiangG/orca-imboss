declare global {
  declare const imb: IMB;

  interface IMB {
    locale: string;
  }

  interface Window {
    imb: IMB;
  }
}

export {};
