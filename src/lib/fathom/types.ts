export interface FathomInstallationDoc {
  _id: string;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  fathomUserId?: string | null;
  webhookId?: string | null;
  webhookUrl?: string | null;
  webhookEvent?: string | null;
  webhookSecret?: string | null;
  webhooks?: Array<{
    id?: string | null;
    url?: string | null;
    createdAt?: string | Date | null;
    include_transcript?: boolean | null;
    include_summary?: boolean | null;
    include_action_items?: boolean | null;
    include_crm_matches?: boolean | null;
    triggered_for?: string[] | null;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
}
