interface Env {
  /** Optional. When set, /mails requires Bearer / X-API-Key / ?token= */
  API_TOKEN?: string;
  /**
   * Optional. When set to "1" / "true" / "yes", /mails may omit `to` and list all mailboxes.
   * Default: listing all is denied; `to` (or email/mailbox) is required.
   */
  ALLOW_LIST_ALL?: string;
}
