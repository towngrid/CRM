import { Switch, Route, useLocation, useParams } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import Deals from "@/pages/deals";
import Tasks from "@/pages/tasks";
import Reports from "@/pages/reports";
import Commissions from "@/pages/commissions";
import EmailSequences from "@/pages/email-sequences";
import Inbox from "@/pages/inbox";
import Settings from "@/pages/settings";
import AdminUsers from "@/pages/admin-users";
import AdminSequenceTest from "@/pages/admin-sequence-test";
import DealWorkspace from "@/pages/deal-workspace";
import PayrollDetail from "@/pages/payroll-detail";
import BusinessSearch from "@/pages/business-search";
import PreVisitBrief from "@/pages/previsit-brief";
import Sidebar from "@/components/layout/sidebar";

function LegacyDiscoveryRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/search"); }, [setLocation]);
  return null;
}

// Silently ping the server every 10 minutes so the auth token stays refreshed
function useSessionKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const ping = () => {
      fetch("/api/auth/user", { credentials: "include" }).catch(() => {});
    };

    // Ping every 10 minutes
    const interval = setInterval(ping, 10 * 60 * 1000);

    // Also ping immediately when the tab becomes visible again
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}

// From Replit Auth blueprint - Conditional routing based on auth state
function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  useSessionKeepAlive(!!isAuthenticated);

  // Show landing page for unauthenticated users
  if (isLoading || !isAuthenticated) {
    return <Landing />;
  }

  // The printable Pre-visit brief is a page of its own, without the menu.
  if (/^\/deal\/[^/]+\/brief\/?$/.test(location)) {
    return <Route path="/deal/:id/brief" component={PreVisitBrief} />;
  }

  // Show authenticated app with sidebar
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/search" component={BusinessSearch} />
          <Route path="/leads/search" component={LegacyDiscoveryRedirect} />
          <Route path="/lead-discovery" component={LegacyDiscoveryRedirect} />
          <Route path="/leads/:rest*" component={LegacyDiscoveryRedirect} />
          <Route path="/leads" component={LegacyDiscoveryRedirect} />
          <Route path="/salon-enrichment/:rest*" component={LegacyDiscoveryRedirect} />
          <Route path="/salon-enrichment" component={LegacyDiscoveryRedirect} />
          <Route path="/salon-search-report" component={LegacyDiscoveryRedirect} />
          <Route path="/form-outreach" component={LegacyDiscoveryRedirect} />
          <Route path="/contacts" component={Contacts} />
          <Route path="/deal/:id" component={DealWorkspace} />
          <Route path="/deals" component={Deals} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/email-sequences" component={EmailSequences} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/commissions" component={Commissions} />
          <Route path="/payroll/:id" component={PayrollDetail} />
          <Route path="/reports" component={Reports} />
          <Route path="/settings" component={Settings} />
          <Route path="/admin/users" component={AdminUsers} />
          <Route path="/admin/sequence-test" component={AdminSequenceTest} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
