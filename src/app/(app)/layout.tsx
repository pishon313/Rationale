import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { DocumentTitle } from "@/components/document-title";
import { DataRecovery } from "@/components/data-recovery";
import { AutomaticBackup } from "@/features/settings/automatic-backup";
import { AccountMigrationGate } from "@/features/accounts/account-migration-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AccountMigrationGate><DocumentTitle /><AutomaticBackup /><DataRecovery /><div className="app-shell"><AppSidebar /><div className="app-workspace"><AppHeader /><div className="app-canvas">{children}</div></div></div></AccountMigrationGate>;
}
