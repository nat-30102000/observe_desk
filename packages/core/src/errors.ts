/** Obsidian (or the REST plugin) could not be reached. Captures should wait in the queue. */
export class OfflineError extends Error {
  constructor(message = 'Obsidian is not reachable') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** The API key was rejected. Retrying will not help until the user fixes it. */
export class AuthError extends Error {
  constructor(message = 'Obsidian rejected the API key') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Any other non-success response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Obsidian responded ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
  }
}
