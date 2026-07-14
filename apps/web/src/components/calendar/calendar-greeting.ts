export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 19) return 'Boa tarde';
  return 'Boa noite';
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const segment = local.split(/[._-]/)[0] ?? local;
  if (!segment) return 'Utilizador';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
