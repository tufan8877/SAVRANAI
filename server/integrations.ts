export const integrationCatalog = [
  'Gmail','Outlook','Google Kalender','Microsoft Kalender','Google Kontakte',
  'Erinnerungen','Wetterdienste','Internetrecherche','Smart Home','Desktop-App','Smartphone-App',
] as const
export type IntegrationName = typeof integrationCatalog[number]
// Credentials and confirmation proofs must originate from trusted server-side services.
export interface AuthorizedIntegration {
  name: IntegrationName
  scopes: readonly string[]
  execute(action: {
    userId: string; operation: string; parameters: Readonly<Record<string,unknown>>;
    confirmationId: string;
  }): Promise<unknown>
}
