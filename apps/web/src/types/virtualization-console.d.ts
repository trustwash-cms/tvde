declare module '@novnc/novnc' {
  export default class RFB {
    constructor(
      target: HTMLElement,
      url: string,
      options?: {
        wsProtocols?: string[];
        credentials?: { password?: string };
      }
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    disconnect(): void;
    addEventListener(type: string, listener: (event: { detail?: { reason?: string } }) => void): void;
    removeEventListener(type: string, listener: (event: { detail?: { reason?: string } }) => void): void;
  }
}

declare module '@xterm/xterm/css/xterm.css';
