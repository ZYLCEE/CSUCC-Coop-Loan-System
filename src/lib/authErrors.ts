export function getAuthErrorMessage(error: unknown): string {
  const fallbackMessage = 'Login failed. Please try again.';

  if (!error) {
    return fallbackMessage;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes('invalid_credentials') || normalizedMessage.includes('invalid login credential')) {
    return 'No account found or the password is incorrect.';
  }

  if (normalizedMessage.includes('email not confirmed')) {
    return 'Please confirm your email before logging in.';
  }

  if (normalizedMessage.includes('network') || normalizedMessage.includes('fetch')) {
    return 'Cannot connect to the login server. Please check your internet connection.';
  }

  return fallbackMessage;
}
