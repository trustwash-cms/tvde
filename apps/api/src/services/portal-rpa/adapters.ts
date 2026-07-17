import type { PortalKind } from '@tvde/shared';
import type { PortalAdapter, PortalLoginPhase, PortalSyncPhase } from './types';
import { viaVerdeAdapter } from './via-verde.adapter';
import { myprioAdapter } from './myprio.adapter';
import { uberAdapter } from './uber.adapter';

const mockStorage = JSON.stringify({
  cookies: [],
  origins: [{ origin: 'https://tvde.local', localStorage: [] }],
});

function mockAdapter(portal: PortalKind): PortalAdapter {
  return {
    portal,
    async login(_page, _username, _password): Promise<PortalLoginPhase> {
      if (portal === 'via_verde') {
        return { status: 'connected', storageState: mockStorage };
      }
      return {
        status: 'awaiting_otp',
        otpHint: `Modo mock: introduza qualquer código OTP para ${portal}`,
        storageState: mockStorage,
      };
    },
    async submitOtp(_page, code): Promise<PortalLoginPhase> {
      if (!code.trim()) return { status: 'failed', message: 'OTP em falta' };
      return { status: 'connected', storageState: mockStorage };
    },
    async sync(): Promise<PortalSyncPhase> {
      return {
        status: 'failed',
        message:
          'Modo mock activo (PORTAL_RPA_MOCK=true): ligação OK, mas sync não descarrega ficheiros reais. Desactive o mock e instale Chromium (npx playwright install) para sync real.',
      };
    },
    async refresh() {
      return 'ok';
    },
  };
}

export function getPortalAdapter(portal: PortalKind, mock: boolean): PortalAdapter {
  if (mock) return mockAdapter(portal);
  switch (portal) {
    case 'via_verde':
      return viaVerdeAdapter;
    case 'myprio':
      return myprioAdapter;
    case 'uber':
      return uberAdapter;
    default:
      return mockAdapter(portal);
  }
}
