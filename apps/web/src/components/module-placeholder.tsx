export function ModulePlaceholder({
  title,
  description = 'Módulo em preparação.',
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="card py-16 text-center">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}
