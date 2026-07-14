'use client';

import { API_PATHS } from '@/lib/api';
import type { AdminMgmtFieldConfig } from '@/components/admin-mgmt/admin-mgmt-entity-panel';
import {
  ADMIN_MGMT_CONTRATO_PERIODICIDADES,
  ADMIN_MGMT_CONTRATO_STATUSES,
  ADMIN_MGMT_CONTRATO_TIPOS,
  ADMIN_MGMT_FISCAL_STATUSES,
} from '@tvde/shared';

export type AdminMgmtEntityKey = 'contratos' | 'segurancaSocial';

export interface AdminMgmtEntityConfig {
  title: string;
  listPath: string;
  createPath: string;
  deletePathForId: (id: string) => string;
  fields: AdminMgmtFieldConfig[];
  emptyLabel?: string;
}

const enumOptions = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));

export const ADMIN_MGMT_ENTITY_CONFIGS: Record<AdminMgmtEntityKey, AdminMgmtEntityConfig> = {
  contratos: {
    title: 'Contratos',
    listPath: API_PATHS.adminMgmt.contratos,
    createPath: API_PATHS.adminMgmt.contratos,
    deletePathForId: API_PATHS.adminMgmt.contratoById,
    fields: [
      { key: 'tipo', label: 'Tipo', type: 'select', options: enumOptions(ADMIN_MGMT_CONTRATO_TIPOS) },
      { key: 'contraparteNome', label: 'Contraparte', type: 'text', required: true, listKeys: ['contraparteNome'] },
      { key: 'contraparteNif', label: 'NIF', type: 'text' },
      { key: 'objeto', label: 'Objeto', type: 'textarea', listKeys: ['objeto'] },
      { key: 'valor', label: 'Valor (€)', type: 'decimal' },
      { key: 'periodicidade', label: 'Periodicidade', type: 'select', options: enumOptions(ADMIN_MGMT_CONTRATO_PERIODICIDADES) },
      { key: 'dataInicio', label: 'Data início', type: 'date', required: true, listKeys: ['dataInicio'] },
      { key: 'dataFim', label: 'Data fim', type: 'date', listKeys: ['dataFim'] },
      { key: 'preAvisoDenunciaDias', label: 'Pré-aviso denúncia (dias)', type: 'number' },
      { key: 'renovacaoAutomatica', label: 'Renovação automática', type: 'boolean' },
      { key: 'status', label: 'Estado', type: 'select', options: enumOptions(ADMIN_MGMT_CONTRATO_STATUSES) },
      { key: 'notas', label: 'Notas', type: 'textarea' },
    ],
  },
  segurancaSocial: {
    title: 'Segurança Social',
    listPath: API_PATHS.adminMgmt.segurancaSocial,
    createPath: API_PATHS.adminMgmt.segurancaSocial,
    deletePathForId: API_PATHS.adminMgmt.segurancaSocialById,
    fields: [
      { key: 'mesReferencia', label: 'Mês referência', type: 'date', required: true, listKeys: ['mesReferencia'] },
      { key: 'valorTotalGuia', label: 'Valor total guia', type: 'decimal', listKeys: ['valorTotalGuia'] },
      { key: 'dataLimitePagamento', label: 'Data limite pagamento', type: 'date', required: true, listKeys: ['dataLimitePagamento'] },
      { key: 'numeroGuia', label: 'N.º guia', type: 'text' },
      { key: 'status', label: 'Estado', type: 'select', options: enumOptions(ADMIN_MGMT_FISCAL_STATUSES) },
    ],
  },
};
