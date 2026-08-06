export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 19) return 'Boa tarde';
  return 'Boa noite';
}

/** Capitalize first letter of a name segment (email local-part fallback). */
export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const segment = local.split(/[._-]/)[0] ?? local;
  if (!segment) return 'Utilizador';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * First name for greetings: prefer profile fullName / username, else email local-part.
 */
export function greetingFirstName(user: {
  fullName?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  const fromProfile = (user.fullName?.trim() || user.username?.trim() || '').split(/\s+/)[0];
  if (fromProfile) return fromProfile;
  if (user.email?.trim()) return displayNameFromEmail(user.email.trim());
  return 'Utilizador';
}
