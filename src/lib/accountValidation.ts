/** Client-side checks before hitting the account endpoints. Null means valid. */
export function validateNewPassword(newPassword: string, confirmPassword: string): string | null {
  if (newPassword !== confirmPassword) return 'Passwords do not match';
  if (newPassword.length < 6) return 'Password must be at least 6 characters';
  return null;
}

export function validateEmailAddress(email: string): string | null {
  return email.includes('@') ? null : 'Invalid email address';
}
