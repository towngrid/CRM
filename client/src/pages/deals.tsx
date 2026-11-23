import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import DealForm from "@/components/deals/deal-form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit, Trash2, Calendar, DollarSign, Handshake, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, RotateCcw, Download, Users, Mail, MessageSquare, Send, Clock, CheckCircle, XCircle, AlertCircle, CalendarClock, Play, Search, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { Deal, Contact, User, EmailSequenceLog, EmailSequence, InboxMessage } from "@shared/schema";
import { getCommissionAmounts } from "@shared/utils";
import { useDealPlans } from "@/hooks/useDealPlans";
import { matchesPipelineEmailFilters, pipelineSequenceLabels } from "@shared/pipelineEmailSummary";
import type { PipelineEmailSummaries } from "@shared/pipelineEmailSummary";
import PipelineEmailStatus from "@/components/deals/pipeline-email-status";
import { DEAL_STAGES, stageLabel, stagePillClass } from "@shared/dealStages";

type ViewType = "card" | "table";
type SortColumn = "title" | "value" | "expectedCloseDate" | "stage" | "contact" | "probability";
type SortDirection = "asc" | "desc";

export default function Deals() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const { toast } = useToast();
  const dealPlanList = useDealPlans();
  const [, setLocation] = useLocation();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | undefined>();
  const [viewType, setViewType] = useState<ViewType>("table");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [emailHistoryContactId, setEmailHistoryContactId] = useState<string | null>(null);
  const [rescheduleLogId, setRescheduleLogId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [initiateDate, setInitiateDate] = useState("");
  const [initiateTime, setInitiateTime] = useState("09:00");
  const [showInitiateForm, setShowInitiateForm] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [sequenceFilter, setSequenceFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const initialFilterUserId = isAdmin ? new URLSearchParams(window.location.search).get("filterUserId") || "" : "";
  const [filterUserId, setFilterUserId] = useState(initialFilterUserId);

  const [wonPopupOpen, setWonPopupOpen] = useState(false);
  const [wonPopupDealId, setWonPopupDealId] = useState<string>("");
  const [wonPlanChoice, setWonPlanChoice] = useState("");

  const handleFilterChange = (value: string) => {
    setFilterUserId(value === "all" ? "" : value);
  };

  const { data: adminUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: deals, isLoading, isError: dealsError, refetch: refetchDeals } = useQuery<Deal[]>({
    queryKey: ["/api/deals", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/deals?${queryString}` : "/api/deals";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load pipeline deals.");
      return response.json();
    },
  });

  const { data: contacts, isLoading: isLoadingContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const url = queryString ? `/api/contacts?${queryString}` : "/api/contacts";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load contacts.");
      return response.json();
    },
  });

  const { data: emailSummaries, isLoading: isLoadingEmailSummaries, isError: emailSummariesError, refetch: refetchEmailSummaries } = useQuery<PipelineEmailSummaries>({
    queryKey: ["/api/deals/email-summaries", filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUserId) params.set("filterUserId", filterUserId);
      const queryString = params.toString();
      const response = await fetch(`/api/deals/email-summaries${queryString ? `?${queryString}` : ""}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load Pipeline email summaries.");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const { data: sequenceLogs, isLoading: isLoadingLogs, isFetching: isFetchingLogs, isError: isLogsError, isSuccess: isLogsSuccess, refetch: refetchSequenceLogs } = useQuery<EmailSequenceLog[]>({
    queryKey: ["/api/email-sequence-logs", emailHistoryContactId, filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams({ contactId: emailHistoryContactId || "" });
      if (filterUserId) params.set("filterUserId", filterUserId);
      const response = await fetch(`/api/email-sequence-logs?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load email history.");
      return response.json();
    },
    enabled: !!emailHistoryContactId,
    staleTime: 0,
    refetchInterval: showInitiateForm || rescheduleLogId ? false : 30_000,
  });

  const { data: sequences } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences"],
    enabled: !!emailHistoryContactId,
  });

  const { data: inboxMessages, isLoading: isLoadingInbox, isError: isInboxError, refetch: refetchInbox } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox", emailHistoryContactId, filterUserId],
    queryFn: async () => {
      const params = new URLSearchParams({ contactId: emailHistoryContactId || "" });
      if (filterUserId) params.set("filterUserId", filterUserId);
      const response = await fetch(`/api/inbox?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load replies.");
      return response.json();
    },
    enabled: !!emailHistoryContactId,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const { data: unreadReplyDealIds } = useQuery<string[]>({
    queryKey: ["/api/deals/unread-replies"],
    refetchInterval: 60000,
  });
  const unreadReplySet = new Set(unreadReplyDealIds ?? []);

  const rescheduleMutation = useMutation({
    mutationFn: async ({ logId, scheduledSendAt }: { logId: string; scheduledSendAt: string }) => {
      return apiRequest("PATCH", `/api/email-sequence-logs/${logId}/reschedule`, { scheduledSendAt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals/email-summaries"] });
      setRescheduleLogId(null);
      setRescheduleDate("");
      setRescheduleTime("09:00");
      toast({ title: "Rescheduled", description: "Email has been rescheduled successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reschedule email", variant: "destructive" });
    },
  });

  const initiateMutation = useMutation({
    mutationFn: async ({ contactId, scheduledSendAt }: { contactId: string; scheduledSendAt: string }) => {
      return apiRequest("POST", `/api/email-sequence-logs/initiate`, { contactId, scheduledSendAt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals/email-summaries"] });
      setShowInitiateForm(false);
      setInitiateDate("");
      setInitiateTime("09:00");
      toast({ title: "Sequence Started", description: "Email Sequence 1 has been scheduled successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to start email sequence", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/deals/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete deal");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    },
  });

  const stageChangeMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      return apiRequest("PATCH", `/api/deals/${id}`, { stage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Stage updated",
        description: "Deal stage has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update deal stage",
        variant: "destructive",
      });
    },
  });

  const commissionMutation = useMutation({
    mutationFn: ({ dealId, planName }: { dealId: string; planName: string }) =>
      apiRequest("POST", "/api/commissions", { dealId, planName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions"] });
      setWonPopupOpen(false);
      setWonPopupDealId("");
      setWonPlanChoice("");
      toast({ title: "Deal marked as Won!", description: "Commission has been recorded." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to record commission", variant: "destructive" });
    },
  });

  const getContactName = (contactId: string | null) => {
    if (!contactId || !contacts) return "No contact";
    const contact = contacts.find(c => c.id === contactId);
    return contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company || "Unnamed contact" : "Contact unavailable";
  };

  const getContactAddress = (contactId: string | null) => {
    if (!contactId || !contacts) return "";
    const contact = contacts.find(c => c.id === contactId);
    return contact?.address || "";
  };

  const getPipelineSummary = (contactId: string | null) =>
    contactId ? emailSummaries?.[contactId] : undefined;

  const getPipelineEmail = (contactId: string | null) => {
    if (!contactId) return null;
    const summary = getPipelineSummary(contactId);
    if (summary) return summary.email;
    const contact = contacts?.find((item) => item.id === contactId);
    return contact?.email ?? null;
  };

  const getStageLabel = (stage: string) => {
    return stageLabel(stage);
  };

  const handleStageChange = (dealId: string, newStage: string) => {
    if (newStage === "won") {
      const deal = deals?.find(d => d.id === dealId);
      setWonPopupDealId(dealId);
      setWonPlanChoice(deal?.plan ?? "");
      setWonPopupOpen(true);
    } else {
      stageChangeMutation.mutate({ id: dealId, stage: newStage });
    }
  };

  const getStageColor = (stage: string) => {
    return stagePillClass(stage);
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "Not specified";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Not set";
    return new Date(date).toLocaleDateString();
  };

  const formatDateTime = (date: string | Date | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleString();
  };

  const isDateExpired = (date: string | Date | null) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const closeDate = new Date(date);
    closeDate.setHours(0, 0, 0, 0);
    return closeDate < today;
  };

  const handleContactClick = (contactId: string | null) => {
    if (contactId) {
      setEmailHistoryContactId(contactId);
    }
  };

  const getSequenceSubject = (sequenceId: string) => {
    if (!sequences) return "Unknown Sequence";
    const seq = sequences.find(s => s.id === sequenceId);
    return seq?.subject || "Unknown Sequence";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "processing":
        return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
      case "replied":
        return <MessageSquare className="h-4 w-4 text-purple-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTrackLabel = (track: string) => {
    const labels: Record<string, string> = {
      directory_general: "Directory — General",
      directory_has_software: "Directory — Has Software",
      directory_no_software: "Directory — No Software",
      salon_no_software: "Salon — No Software",
      salon_uses_competitor: "Salon — Uses Competitor",
      mobile_no_software: "Mobile — No Software",
      mobile_uses_competitor: "Mobile — Uses Competitor",
      no_software: "No Software", uses_competitor: "Uses Competitor",
    };
    return labels[track] || track.replace(/_/g, " ");
  };

  const emailHistoryContact = emailHistoryContactId
    ? contacts?.find(c => c.id === emailHistoryContactId)
    : null;

  const handleReschedule = (logId: string) => {
    const log = sequenceLogs?.find(l => l.id === logId);
    if (log?.scheduledSendAt) {
      const d = new Date(log.scheduledSendAt);
      setRescheduleDate(d.toISOString().split("T")[0]);
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      setRescheduleTime(`${h}:${m}`);
    } else {
      setRescheduleDate("");
      setRescheduleTime("09:00");
    }
    setRescheduleLogId(logId);
  };

  const submitReschedule = () => {
    if (!rescheduleLogId || !rescheduleDate || !rescheduleTime) return;
    const scheduledSendAt = new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString();
    rescheduleMutation.mutate({ logId: rescheduleLogId, scheduledSendAt });
  };

  const submitInitiate = () => {
    if (!emailHistoryContactId || !initiateDate || !initiateTime) return;
    const scheduledSendAt = new Date(`${initiateDate}T${initiateTime}:00`).toISOString();
    initiateMutation.mutate({ contactId: emailHistoryContactId, scheduledSendAt });
  };

  const hasActiveOutreach = sequenceLogs?.some(
    l => ["pending", "processing", "needs_review"].includes(l.status)
  ) ?? false;
  const canInitiateSequence = !!emailHistoryContactId
    && !!emailHistoryContact
    && !!getPipelineEmail(emailHistoryContactId)
    && isLogsSuccess
    && !isFetchingLogs
    && !isLogsError
    && !hasActiveOutreach;

  const handleEdit = (deal: Deal) => {
    setSelectedDeal(deal);
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this deal?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    window.open('/api/export/deals', '_blank');
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedDeal(undefined);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/deals/email-summaries"] });
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const isStageOpen = (stage: string) => {
    return !["won", "lost"].includes(stage);
  };

  const sortedDeals = useMemo(() => {
    if (!deals) return [];

    let sorted = [...deals];

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      sorted = sorted.filter(deal => {
        const contactName = getContactName(deal.contactId).toLowerCase();
        const email = deal.contactId ? emailSummaries?.[deal.contactId]?.email?.toLowerCase() || "" : "";
        return (
          deal.title?.toLowerCase().includes(q) ||
          contactName.includes(q) ||
          email.includes(q) ||
          deal.description?.toLowerCase().includes(q)
        );
      });
    }

    sorted = sorted.filter((deal) =>
      matchesPipelineEmailFilters(
        deal.contactId ? emailSummaries?.[deal.contactId] : undefined,
        sequenceFilter,
        historyFilter,
      )
    );

    // Default sort: open deals first (by stage), then newest first (by createdAt)
    if (!sortColumn) {
      sorted.sort((a, b) => {
        const aIsOpen = isStageOpen(a.stage);
        const bIsOpen = isStageOpen(b.stage);
        
        if (aIsOpen !== bIsOpen) {
          return aIsOpen ? -1 : 1; // Open deals first
        }
        
        // Within the same category (open or closed), newest first
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      });
      return sorted;
    }

    // Custom column sorting
    sorted.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case "title":
          aValue = a.title?.toLowerCase() || "";
          bValue = b.title?.toLowerCase() || "";
          break;
        case "value":
          aValue = parseFloat(a.value || "0");
          bValue = parseFloat(b.value || "0");
          break;
        case "expectedCloseDate":
          aValue = a.expectedCloseDate ? new Date(a.expectedCloseDate).getTime() : 0;
          bValue = b.expectedCloseDate ? new Date(b.expectedCloseDate).getTime() : 0;
          break;
        case "stage":
          aValue = a.stage?.toLowerCase() || "";
          bValue = b.stage?.toLowerCase() || "";
          break;
        case "contact":
          aValue = getContactName(a.contactId).toLowerCase();
          bValue = getContactName(b.contactId).toLowerCase();
          break;
        case "probability":
          aValue = a.probability ?? 0;
          bValue = b.probability ?? 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [deals, sortColumn, sortDirection, contacts, searchTerm, emailSummaries, sequenceFilter, historyFilter]);

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="ml-2 h-4 w-4" />
      : <ArrowDown className="ml-2 h-4 w-4" />;
  };

  if (isLoading) {
    return (
      <>
        <Header title="Pipeline" onAddNew={() => setIsFormOpen(true)} addButtonText="New Deal" />
        <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                    <div className="h-6 bg-muted rounded w-1/3"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header 
        title="Pipeline" 
        onAddNew={() => setIsFormOpen(true)}
        addButtonText="New Deal"
        onSearch={setSearchTerm}
        searchValue={searchTerm}
        wrapActions
        customActions={
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={sequenceFilter} onValueChange={setSequenceFilter}>
              <SelectTrigger className="w-[180px]" aria-label="Filter by sequence status" data-testid="filter-sequence-status">
                <SelectValue placeholder="All sequence statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sequence statuses</SelectItem>
                <SelectItem value="enrolled">Any sequence history</SelectItem>
                {Object.entries(pipelineSequenceLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={historyFilter} onValueChange={setHistoryFilter}>
              <SelectTrigger className="w-[190px]" aria-label="Filter by recorded sends" data-testid="filter-recorded-sends">
                <SelectValue placeholder="All send history" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All send history</SelectItem>
                <SelectItem value="sent">Has recorded sends</SelectItem>
                <SelectItem value="none">No recorded sends</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Select value={filterUserId || "all"} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-[200px]" data-testid="select-filter-user-deals">
                    <SelectValue placeholder="All Salespeople" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Salespeople</SelectItem>
                    {adminUsers?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email || "Unknown"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                data-testid="button-export"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
            {sortColumn && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSortColumn(null);
                  setSortDirection("asc");
                }}
                data-testid="reset-sort"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Sort
              </Button>
            )}
            <div className="flex gap-1 border border-border rounded-md">
              <Button
                variant={viewType === "card" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewType("card")}
                data-testid="view-card"
                className="rounded-r-none"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewType === "table" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewType("table")}
                data-testid="view-table"
                className="rounded-l-none"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />
      
      <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30" data-testid="deals-content">
        <p className="mb-4 text-sm text-muted-foreground">Pipeline tracks sales opportunities and next steps for your contacts. Research and approve businesses in Leads first; choosing and scheduling an outreach sequence is a separate confirmed action.</p>
        {dealsError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span>Pipeline deals could not be loaded.</span>
            <Button variant="outline" size="sm" onClick={() => refetchDeals()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        )}
        {emailSummariesError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="text-foreground">Pipeline email status could not be loaded. Sequence and send filters may not show all matching deals.</span>
            <Button variant="outline" size="sm" onClick={() => refetchEmailSummaries()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry status
            </Button>
          </div>
        )}
        {dealsError ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Pipeline deals are unavailable until the request succeeds.
            </CardContent>
          </Card>
        ) : !deals?.length ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Handshake className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">No deals found</h3>
              <p className="text-muted-foreground">
                Start tracking your sales pipeline by creating your first deal.
              </p>
            </CardContent>
          </Card>
        ) : emailSummariesError && (sequenceFilter !== "all" || historyFilter !== "all") ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-8">
              <p className="text-sm text-muted-foreground">Email filters can’t be applied while Pipeline activity is unavailable.</p>
              <Button variant="outline" size="sm" onClick={() => refetchEmailSummaries()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry status
              </Button>
            </CardContent>
          </Card>
        ) : isLoadingEmailSummaries && (sequenceFilter !== "all" || historyFilter !== "all") ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
              <span className="h-5 w-32 animate-pulse rounded bg-muted" />
              Loading email activity before applying these filters…
            </CardContent>
          </Card>
        ) : sortedDeals.length === 0 && (searchTerm || sequenceFilter !== "all" || historyFilter !== "all") ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-2">No deals match these filters</h3>
              <p className="text-muted-foreground">Try a different search or reset the email status filters.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchTerm(""); setSequenceFilter("all"); setHistoryFilter("all"); }}>Clear filters</Button>
            </CardContent>
          </Card>
        ) : viewType === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedDeals.map((deal) => (
              <Card 
                key={deal.id} 
                className={`hover:shadow-md transition-shadow${unreadReplySet.has(deal.id) ? " unread-reply-row" : ""}`}
                data-testid={`deal-card-${deal.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3
                      className="font-semibold text-lg text-primary hover:underline cursor-pointer line-clamp-2"
                      onClick={() => setLocation(`/deal/${deal.id}`)}
                      data-testid={`link-deal-workspace-card-${deal.id}`}
                    >
                      {deal.title}
                    </h3>
                    <div className="flex space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(deal)}
                        data-testid={`edit-deal-${deal.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(deal.id)}
                        className="text-destructive hover:text-destructive"
                        data-testid={`delete-deal-${deal.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {formatCurrency(deal.value)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Expected: {formatDate(deal.expectedCloseDate)}
                      </span>
                    </div>

                    <div>
                      <Select
                        value={deal.stage}
                        onValueChange={(value) => handleStageChange(deal.id, value)}
                        disabled={stageChangeMutation.isPending}
                      >
                        <SelectTrigger 
                          className={`w-full ${getStageColor(deal.stage)}`}
                          data-testid={`select-stage-card-${deal.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEAL_STAGES.map(s => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="pt-2 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        Contact:{" "}
                        <button
                          className="text-primary hover:underline cursor-pointer font-medium"
                          onClick={(e) => { e.stopPropagation(); handleContactClick(deal.contactId); }}
                          data-testid={`contact-link-card-${deal.id}`}
                        >
                          {getContactName(deal.contactId)}
                        </button>
                      </p>
                      {getContactAddress(deal.contactId) && (
                        <p className="text-sm text-muted-foreground truncate" title={getContactAddress(deal.contactId)}>
                          Address: {getContactAddress(deal.contactId)}
                        </p>
                      )}
                      {deal.probability !== null && (
                        <p className="text-sm text-muted-foreground">
                          Probability: {deal.probability}%
                        </p>
                      )}
                    </div>

                    <PipelineEmailStatus
                      contactId={deal.contactId}
                      summary={getPipelineSummary(deal.contactId)}
                      email={getPipelineEmail(deal.contactId)}
                      contactKnown={!!contacts?.some((contact) => contact.id === deal.contactId)}
                      contactsLoading={isLoadingContacts}
                      loading={isLoadingEmailSummaries}
                      failed={emailSummariesError}
                      onRetry={() => refetchEmailSummaries()}
                      onOpenHistory={() => handleContactClick(deal.contactId)}
                      compact
                    />

                    {deal.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {deal.description}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <div className="w-full overflow-x-auto">
            <Table className="min-w-[1320px]">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("contact")}
                      data-testid="sort-contact"
                    >
                      Contact
                      <SortIcon column="contact" />
                    </Button>
                  </TableHead>
                  <TableHead>Email outreach</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("title")}
                      data-testid="sort-title"
                    >
                      Deal Name
                      <SortIcon column="title" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("value")}
                      data-testid="sort-value"
                    >
                      Value
                      <SortIcon column="value" />
                    </Button>
                  </TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("expectedCloseDate")}
                      data-testid="sort-expectedCloseDate"
                    >
                      Expected Close
                      <SortIcon column="expectedCloseDate" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("stage")}
                      data-testid="sort-stage"
                    >
                      Stage
                      <SortIcon column="stage" />
                    </Button>
                  </TableHead>
                  <TableHead>Stage Changed</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2"
                      onClick={() => handleSort("probability")}
                      data-testid="sort-probability"
                    >
                      Probability
                      <SortIcon column="probability" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDeals.map((deal) => {
                  const isExpired = isDateExpired(deal.expectedCloseDate) && !["won", "lost"].includes(deal.stage);
                  const hasUnreadReply = unreadReplySet.has(deal.id);
                  return (
                    <TableRow 
                      key={deal.id} 
                      data-testid={`deal-row-${deal.id}`}
                      className={isExpired ? "bg-[#E96161] hover:bg-[#E96161]/90" : hasUnreadReply ? "unread-reply-row" : ""}
                    >
                      <TableCell>
                        <button
                          className="text-primary hover:underline cursor-pointer font-medium"
                          onClick={() => handleContactClick(deal.contactId)}
                          data-testid={`contact-link-table-${deal.id}`}
                        >
                          {getContactName(deal.contactId)}
                        </button>
                      </TableCell>
                      <TableCell className="min-w-[300px]">
                        <PipelineEmailStatus
                          contactId={deal.contactId}
                          summary={getPipelineSummary(deal.contactId)}
                          email={getPipelineEmail(deal.contactId)}
                          contactKnown={!!contacts?.some((contact) => contact.id === deal.contactId)}
                          contactsLoading={isLoadingContacts}
                          loading={isLoadingEmailSummaries}
                          failed={emailSummariesError}
                          onRetry={() => refetchEmailSummaries()}
                          onOpenHistory={() => handleContactClick(deal.contactId)}
                          compact
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          className="text-primary hover:underline cursor-pointer font-medium text-left"
                          onClick={() => setLocation(`/deal/${deal.id}`)}
                          data-testid={`link-deal-workspace-${deal.id}`}
                        >
                          {deal.title}
                        </button>
                      </TableCell>
                      <TableCell>{formatCurrency(deal.value)}</TableCell>
                      <TableCell>{deal.plan || "—"}</TableCell>
                      <TableCell>{formatDate(deal.expectedCloseDate)}</TableCell>
                      <TableCell>
                        <Select
                          value={deal.stage}
                          onValueChange={(value) => handleStageChange(deal.id, value)}
                          disabled={stageChangeMutation.isPending}
                        >
                          <SelectTrigger 
                            className={`w-[200px] ${getStageColor(deal.stage)}`}
                            data-testid={`select-stage-${deal.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEAL_STAGES.map(s => (
                              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(deal.stageChangedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[150px] truncate" title={getContactAddress(deal.contactId)}>
                          {getContactAddress(deal.contactId) || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {deal.probability !== null ? `${deal.probability}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(deal)}
                            data-testid={`edit-deal-${deal.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(deal.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`delete-deal-${deal.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </Card>
        )}
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedDeal ? "Edit Deal" : "Add New Deal"}
            </DialogTitle>
          </DialogHeader>
          <DealForm
            deal={selectedDeal}
            onSuccess={handleFormSuccess}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!emailHistoryContactId} onOpenChange={(open) => { if (!open) { setEmailHistoryContactId(null); setRescheduleLogId(null); setShowInitiateForm(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="email-history-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email History — {getContactName(emailHistoryContactId)}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                This view shows email and reply activity recorded in this CRM. It is not a delivery receipt from the recipient’s mail provider.
              </p>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Email Sequences
                  </h3>
                  {canInitiateSequence && !showInitiateForm && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowInitiateForm(true)}
                      data-testid="button-initiate-sequence"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Start Sequence 1
                    </Button>
                  )}
                </div>

                {showInitiateForm && canInitiateSequence && (
                  <Card className="mb-3 border-primary/50">
                    <CardContent className="p-4">
                      <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                        <Play className="h-4 w-4" />
                        Start Email Sequence 1
                      </h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Schedule when Sequence 1 should be sent to this contact. Time is in Eastern Time.
                      </p>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-[140px]">
                          <Label htmlFor="initiate-date" className="text-xs">Date</Label>
                          <Input
                            id="initiate-date"
                            type="date"
                            value={initiateDate}
                            onChange={(e) => setInitiateDate(e.target.value)}
                            data-testid="input-initiate-date"
                          />
                        </div>
                        <div className="w-[120px]">
                          <Label htmlFor="initiate-time" className="text-xs">Time (ET)</Label>
                          <Input
                            id="initiate-time"
                            type="time"
                            value={initiateTime}
                            onChange={(e) => setInitiateTime(e.target.value)}
                            data-testid="input-initiate-time"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={submitInitiate}
                            disabled={!initiateDate || !initiateTime || !canInitiateSequence || initiateMutation.isPending}
                            data-testid="button-submit-initiate"
                          >
                            {initiateMutation.isPending ? "Scheduling..." : "Schedule"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setShowInitiateForm(false); setInitiateDate(""); setInitiateTime("09:00"); }}
                            data-testid="button-cancel-initiate"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {isLogsError ? (
                  <Card role="alert" className="border-destructive/30">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <p className="text-sm text-muted-foreground">Email history could not be loaded. No sequence state can be confirmed.</p>
                      <Button variant="outline" size="sm" onClick={() => refetchSequenceLogs()}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Retry
                      </Button>
                    </CardContent>
                  </Card>
                ) : isLoadingLogs ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : isLogsSuccess && !sequenceLogs?.length ? (
                  <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                      No CRM-recorded sequence activity for this contact.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {(sequenceLogs ?? []).map((log, index) => (
                      <Card key={log.id} className={index === 0 ? "border-primary/50 shadow-sm" : ""} data-testid={`sequence-log-${log.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              {getStatusIcon(log.status)}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {getSequenceSubject(log.sequenceId)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    Seq #{log.sequenceNumber}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {getTrackLabel(log.sequenceTrack)}
                                  </Badge>
                                  <Badge
                                    variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                                    className="text-xs"
                                  >
                                    {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                                  </Badge>
                                  {index === 0 && (
                                    <Badge variant="default" className="text-xs bg-primary">
                                      Latest
                                    </Badge>
                                  )}
                                </div>
                                {log.scheduledSendAt && log.status === "pending" && (
                                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                    <CalendarClock className="h-3 w-3" />
                                    Scheduled: {new Date(log.scheduledSendAt).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {log.sentAt ? new Date(log.sentAt).toLocaleString() : log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                              </span>
                              {log.status === "pending" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleReschedule(log.id)}
                                  data-testid={`button-reschedule-${log.id}`}
                                >
                                  <CalendarClock className="h-3 w-3 mr-1" />
                                  Reschedule
                                </Button>
                              )}
                            </div>
                          </div>

                          {rescheduleLogId === log.id && (
                            <div className="mt-3 pt-3 border-t border-border">
                              <p className="text-xs text-muted-foreground mb-2">Set new date and time (Eastern Time):</p>
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="flex-1 min-w-[130px]">
                                  <Label htmlFor={`reschedule-date-${log.id}`} className="text-xs">Date</Label>
                                  <Input
                                    id={`reschedule-date-${log.id}`}
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={(e) => setRescheduleDate(e.target.value)}
                                    data-testid={`input-reschedule-date-${log.id}`}
                                  />
                                </div>
                                <div className="w-[110px]">
                                  <Label htmlFor={`reschedule-time-${log.id}`} className="text-xs">Time (ET)</Label>
                                  <Input
                                    id={`reschedule-time-${log.id}`}
                                    type="time"
                                    value={rescheduleTime}
                                    onChange={(e) => setRescheduleTime(e.target.value)}
                                    data-testid={`input-reschedule-time-${log.id}`}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    onClick={submitReschedule}
                                    disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}
                                    data-testid={`button-submit-reschedule-${log.id}`}
                                  >
                                    {rescheduleMutation.isPending ? "Saving..." : "Save"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => { setRescheduleLogId(null); setRescheduleDate(""); setRescheduleTime("09:00"); }}
                                    data-testid={`button-cancel-reschedule-${log.id}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4" />
                  Replies
                </h3>
                {isInboxError ? (
                  <Card role="alert" className="border-destructive/30">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <p className="text-sm text-muted-foreground">Reply history could not be loaded.</p>
                      <Button variant="outline" size="sm" onClick={() => refetchInbox()}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Retry
                      </Button>
                    </CardContent>
                  </Card>
                ) : isLoadingInbox ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => (
                      <div key={i} className="h-20 bg-muted rounded animate-pulse" />
                    ))}
                  </div>
                ) : !inboxMessages?.length ? (
                  <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                      No CRM-recorded replies for this contact.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {inboxMessages.map((msg) => (
                      <Card key={msg.id} data-testid={`inbox-msg-${msg.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                              <p className="text-sm font-medium text-foreground truncate">
                                {msg.subject}
                              </p>
                              {msg.isRead === "false" && (
                                <Badge variant="default" className="text-xs bg-blue-500 shrink-0">
                                  New
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {msg.receivedAt ? new Date(msg.receivedAt).toLocaleString() : "—"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-1">From: {msg.from}</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">
                            {msg.bodyText || "(No text content)"}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ─── Won Commission Popup ────────────────────────────────────────────── */}
      <Dialog open={wonPopupOpen} onOpenChange={(open) => { if (!commissionMutation.isPending) setWonPopupOpen(open); }}>
        <DialogContent className="max-w-md" data-testid="dialog-won-commission-deals">
          <DialogHeader>
            <DialogTitle className="text-green-600 flex items-center gap-2">
              <DollarSign className="h-5 w-5" /> Deal Won — Confirm Commission Plan
            </DialogTitle>
            <DialogDescription>
              Select the plan to calculate and record the salesperson's commission.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-2 block">Deal Plan</Label>
              <Select value={wonPlanChoice} onValueChange={setWonPlanChoice}>
                <SelectTrigger data-testid="select-won-plan-deals">
                  <SelectValue placeholder="Select plan…" />
                </SelectTrigger>
                <SelectContent>
                  {dealPlanList.choices().map(plan => (
                    <SelectItem key={plan} value={plan}>{plan}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {wonPlanChoice && (() => {
              const { upfront, monthly } = getCommissionAmounts(wonPlanChoice);
              if (upfront === 0 && monthly === 0) return null;
              return (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 space-y-1">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">Commission Breakdown</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Upfront</span>
                    <span className="font-bold text-green-700 dark:text-green-400">${upfront.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly recurring</span>
                    <span className="font-semibold text-green-700 dark:text-green-400">${monthly.toFixed(2)}/mo</span>
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWonPopupOpen(false)} disabled={commissionMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => { if (wonPopupDealId && wonPlanChoice) commissionMutation.mutate({ dealId: wonPopupDealId, planName: wonPlanChoice }); }}
              disabled={!wonPlanChoice || commissionMutation.isPending}
              data-testid="button-confirm-won-deals"
            >
              {commissionMutation.isPending ? "Saving…" : "Mark as Won"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
