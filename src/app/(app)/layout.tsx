import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { DocumentTitle } from "@/components/document-title";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <><DocumentTitle /><div className="flex min-h-screen"><AppSidebar /><div className="min-w-0 flex-1"><AppHeader />{children}</div></div></>;
}
