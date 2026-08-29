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
    focus(): void;
    sendCredentials(creds: { password?: string }): void;
    addEventListener(
      type: string,
      listener: (event: { detail?: { reason?: string; status?: string } }) => void
    ): void;
    removeEventListener(
      type: string,
      listener: (event: { detail?: { reason?: string; status?: string } }) => void
    ): void;
  }
}

declare module '@xterm/xterm/css/xterm.css';
