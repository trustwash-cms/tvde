'use client';

const DEFAULT_VAT_TAXES = [
  { tax_id: 1, name: 'IVA Normal', value: 23 },
  { tax_id: 2, name: 'IVA Intermédio', value: 13 },
  { tax_id: 3, name: 'IVA Reduzido', value: 6 },
  { tax_id: 4, name: 'Isento', value: 0 },
] as const;

export function SettingsGeneralPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Geral</h2>
        <p className="mt-1 text-sm text-slate-500">
          Definições gerais do workspace. A tabela de IVA é usada em produtos, serviços e documentos de
          facturação.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-medium text-slate-900">Tabela de IVA</h3>
        <p className="mt-1 text-sm text-slate-500">
          Taxas aplicadas ao calcular preços com e sem IVA. A edição personalizada por workspace estará disponível
          numa fase seguinte.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="pb-2 pr-4 font-medium">Código</th>
                <th className="pb-2 pr-4 font-medium">Designação</th>
                <th className="pb-2 font-medium">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_VAT_TAXES.map((tax) => (
                <tr key={tax.tax_id} className="border-b border-slate-50">
                  <td className="py-2.5 pr-4 font-mono text-slate-600">{tax.tax_id}</td>
                  <td className="py-2.5 pr-4 text-slate-800">{tax.name}</td>
                  <td className="py-2.5 text-slate-800">{tax.value}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
