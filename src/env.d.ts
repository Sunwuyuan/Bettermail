interface Env {
  /** Optional. When set, /mails requires Bearer / X-API-Key / ?token= */
  API_TOKEN?: string;
  /**
   * Optional. When set to "1" / "true" / "yes", /mails may omit `to` and list all mailboxes.
   * Default: listing all is denied; `to` (or email/mailbox) is required.
   */
  ALLOW_LIST_ALL?: string;
  /**
   * D1 database binding (preferred when present).
   * Variable name must be: DB
   */
  DB?: D1Database;
  /**
   * KV namespace binding (used when DB is not bound).
   * Variable name must be: BMAIL
   */
  BMAIL?: KVNamespace;
}
