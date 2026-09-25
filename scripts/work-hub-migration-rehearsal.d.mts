export type WorkHubMigrationSnapshot = {
  fields: string[];
  gateIndex: boolean;
  originalRows: string;
};
export function rehearseWorkHubMigrations(input: {
  inspect(): Promise<WorkHubMigrationSnapshot>;
  migrate(command: string): Promise<void>;
}): Promise<void>;
