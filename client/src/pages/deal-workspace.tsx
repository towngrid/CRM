import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { refreshPipelineQueries } from "@/lib/pipeline-query-refresh";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft, Phone, Mail, Globe, MapPin, Building2, Users, Monitor,
  Pencil, ChevronDown, ChevronLeft, ChevronRight, PhoneCall, FileText,
  StickyNote, Home, Calendar, DollarSign, TrendingUp, Send,
  AlertCircle, User, ExternalLink, Facebook, Instagram, Link2, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@/components/ui/select";
import type { Deal, Contact } from "@shared/schema";
import { getCommissionAmounts } from "@shared/utils";
import { useDealPlans } from "@/hooks/useDealPlans";
import { pipelineContactOwnerName } from "@shared/pipelineContactName";
import ContactForm from "@/components/contacts/contact-form";
import ContactOwnerNameSearch from "@/components/contacts/contact-owner-name-search";
import DealTaskPanel from "@/components/tasks/deal-task-panel";
import DealSequencePanel from "@/components/email-sequences/deal-sequence-panel";
import { leadListLabel, leadTypeLabel } from "@shared/leadTypes";
import { DEAL_STAGES, stageDotClass, stagePillClass } from "@shared/dealStages";

// ─── Stage helpers ────────────────────────────────────────────────────────────
const STAGES = DEAL_STAGES;

function stageInfo(value: string) {
  return STAGES.find(s => s.value === value) ?? STAGES[0];
}

function StagePill({ stage }: { stage: string }) {
  const s = stageInfo(stage);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stagePillClass(s.value)}`}>
      {s.label}
    </span>
  );
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────
const PLAN_PILL = "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";

// ─── Contact info row ─────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, link }: { icon: React.ReactNode; label: string; value?: string | null; link?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 break-all">
            {value} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <p className="text-sm break-words">{value}</p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Activity type config ─────────────────────────────────────────────────────
type LogType = "call" | "email_note" | "note" | "site_visit";

const ACTIVITY_CONFIG: Record<string, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  call:         { label: "Call",       Icon: PhoneCall,   color: "text-green-700 dark:text-green-300",   bg: "bg-green-100 dark:bg-green-900" },
  email_note:   { label: "Email Note", Icon: Mail,        color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-100 dark:bg-indigo-900" },
  note:         { label: "Note",       Icon: StickyNote,  color: "text-blue-700 dark:text-blue-300",     bg: "bg-blue-100 dark:bg-blue-900" },
  site_visit:   { label: "Site Visit", Icon: Home,        color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-900" },
  stage_change: { label: "Stage",      Icon: TrendingUp,  color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900" },
};

const CALL_OUTCOMES = ["Answered", "Left Voicemail", "No Answer", "Busy", "Wrong Number", "Callback Requested"];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DealWorkspace() {
  const [, params] = useRoute("/deal/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const dealPlanList = useDealPlans();
  const { user } = useAuth();
  const dealId = params?.id ?? "";
  const returnToPipeline = () => {
    void refreshPipelineQueries(queryClient);
    setLocation("/deals");
  };
  const [activeTab, setActiveTab] = useState("activity");
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [wonPopupOpen, setWonPopupOpen] = useState(false);
  const [wonPlanChoice, setWonPlanChoice] = useState("");
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [editPlanValue, setEditPlanValue] = useState("");
  const [editDealOpen, setEditDealOpen] = useState(false);
  const [editDealTitle, setEditDealTitle] = useState("");
  const [editDealValue, setEditDealValue] = useState("");
  const [editDealProbability, setEditDealProbability] = useState("");
  const [editDealCloseDate, setEditDealCloseDate] = useState("");

  // Log activity form state
  const [logType, setLogType] = useState<LogType | null>(null);
  const [logNotes, setLogNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [callDuration, setCallDuration] = useState("");
  const [visitDate, setVisitDate] = useState("");


  function resetLogForm() {
    setLogNotes(""); setCallOutcome(""); setCallDuration(""); setVisitDate("");
  }
  // Fetch workspace data (deal + contact + activities)
  const { data, isLoading, error } = useQuery<{ deal: Deal; contact: Contact | null; activities: any[] }>({
    queryKey: ["/api/deal-workspace", dealId],
    queryFn: () => fetch(`/api/deal-workspace/${dealId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!dealId,
  });

  // Email sequence logs for this contact (loaded lazily when tab is active)
  const contactId = data?.contact?.id;
  const { data: emailLogs } = useQuery<any[]>({
    queryKey: ["/api/email-sequence-logs", contactId],
    queryFn: () => fetch(`/api/email-sequence-logs?contactId=${contactId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!contactId && activeTab === "email-history",
  });

  // Update plan mutation
  const planMutation = useMutation({
    mutationFn: (newPlan: string) =>
      apiRequest("PATCH", `/api/deals/${dealId}`, { plan: newPlan }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setIsEditingPlan(false);
      toast({ title: "Plan updated", description: "The deal plan has been changed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const dealEditMutation = useMutation({
    mutationFn: (data: { title?: string; value?: string; probability?: number | null; expectedCloseDate?: string | null }) =>
      apiRequest("PATCH", `/api/deals/${dealId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setEditDealOpen(false);
      toast({ title: "Deal updated", description: "Deal details have been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update deal.", variant: "destructive" });
    },
  });

  function openEditDeal() {
    if (!deal) return;
    setEditDealTitle(deal.title ?? "");
    setEditDealValue(deal.value ?? "");
    setEditDealProbability(deal.probability != null ? String(deal.probability) : "");
    setEditDealCloseDate(deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), "yyyy-MM-dd") : "");
    setEditDealOpen(true);
  }

  function submitEditDeal() {
    const probability = editDealProbability !== "" ? parseInt(editDealProbability, 10) : null;
    dealEditMutation.mutate({
      title: editDealTitle.trim() || undefined,
      value: editDealValue.trim() || undefined,
      probability,
      expectedCloseDate: editDealCloseDate || null,
    });
  }

  // Move stage mutation
  const stageMutation = useMutation({
    mutationFn: (newStage: string) =>
      apiRequest("PATCH", `/api/deals/${dealId}`, { stage: newStage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({ title: "Stage updated" });
    },
    onError: () => toast({ title: "Failed to update stage", variant: "destructive" }),
  });

  const markRepliesReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/deals/${dealId}/mark-replies-read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals/unread-replies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  // Commission confirmation mutation (used when stage = "won")
  const commissionMutation = useMutation({
    mutationFn: ({ planName }: { planName: string }) =>
      apiRequest("POST", "/api/commissions", { dealId, planName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commissions"] });
      setWonPopupOpen(false);
      setWonPlanChoice("");
      toast({ title: "Deal marked as Won!", description: "Commission has been recorded." });
    },
    onError: () => toast({ title: "Failed to confirm commission", variant: "destructive" }),
  });

  function handleStageSelect(stageValue: string) {
    if (stageValue === "won") {
      setWonPlanChoice(data?.deal?.plan ?? "");
      setWonPopupOpen(true);
    } else {
      stageMutation.mutate(stageValue);
    }
  }


  // Log activity mutation
  const logActivityMutation = useMutation({
    mutationFn: (payload: { activityType: string; contactId: string; notes?: string; metadata?: string }) =>
      apiRequest("POST", `/api/deal-activities/${dealId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
      setLogType(null);
      resetLogForm();
      toast({ title: "Activity logged" });
    },
    onError: () => toast({ title: "Failed to log activity", variant: "destructive" }),
  });

  function handleSubmitLog() {
    if (!logType || !data?.contact) return;
    const meta: Record<string, string> = {};
    if (logType === "call") {
      if (callOutcome) meta.callOutcome = callOutcome;
      if (callDuration) meta.callDuration = callDuration;
    }
    if (logType === "site_visit" && visitDate) meta.visitDate = visitDate;
    logActivityMutation.mutate({
      activityType: logType,
      contactId: data.contact.id,
      notes: logNotes || undefined,
      metadata: Object.keys(meta).length ? JSON.stringify(meta) : undefined,
    });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading deal workspace…</div>
      </div>
    );
  }

  if (error || !data?.deal) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">Deal not found</p>
        <Button variant="outline" onClick={returnToPipeline}>Back to Pipeline</Button>
      </div>
    );
  }

  const { deal, contact } = data;
  const stage = stageInfo(deal.stage);

  const contactInitials = contact
    ? `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase()
    : "?";

  const probabilityColor =
    (deal.probability ?? 0) >= 70 ? "text-green-600 dark:text-green-400" :
    (deal.probability ?? 0) >= 40 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-600 dark:text-red-400";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ─── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Button
          variant="ghost"
          size="sm"
          onClick={returnToPipeline}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="button-back-pipeline"
        >
          <ArrowLeft className="h-4 w-4" />
          Pipeline
        </Button>

        <Separator orientation="vertical" className="h-5" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-muted-foreground truncate hidden sm:block">
            {stage.label}
          </span>
          <span className="text-muted-foreground hidden sm:block">›</span>
          <span className="text-sm font-medium truncate">
            {deal.title}
            {contact && (
              <span className="text-muted-foreground font-normal"> — {contact.firstName} {contact.lastName}</span>
            )}
          </span>
        </div>

        {/* Stage pill */}
        <StagePill stage={deal.stage} />

        {/* Probability */}
        {deal.probability != null && (
          <span className={`text-sm font-semibold ${probabilityColor} shrink-0`} data-testid="text-probability">
            {deal.probability}%
          </span>
        )}

        {/* Move Stage dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="shrink-0" data-testid="button-move-stage">
              Move Stage <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {STAGES.map(s => (
              <DropdownMenuItem
                key={s.value}
                onClick={() => handleStageSelect(s.value)}
                disabled={s.value === deal.stage || stageMutation.isPending || commissionMutation.isPending}
                className={s.value === deal.stage ? "opacity-50 cursor-default" : ""}
                data-testid={`menu-stage-${s.value}`}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${stageDotClass(s.value)}`} />
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ─── 3-Panel body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Contact Info ──────────────────────────────────────────────── */}
        <div className={`shrink-0 border-r flex flex-col bg-card transition-all duration-200 ${leftCollapsed ? "w-10 overflow-hidden" : "w-72 overflow-y-auto"}`}>
          {/* Collapse / expand toggle bar */}
          <div className={`shrink-0 flex items-center border-b ${leftCollapsed ? "justify-center py-2" : "justify-end px-2 py-1.5"}`}>
            {leftCollapsed ? (
              <button
                onClick={() => setLeftCollapsed(false)}
                className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Expand contact panel"
                data-testid="button-expand-left"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => setLeftCollapsed(true)}
                className="flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Collapse contact panel"
                data-testid="button-collapse-left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="p-4 flex-1" style={{ display: leftCollapsed ? "none" : undefined }}>
            {contact ? (
              <>
                {/* Avatar + Name */}
                <div className="flex flex-col items-center text-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center text-white text-xl font-bold mb-2">
                    {contactInitials}
                  </div>
                  <h2 className="text-base font-semibold leading-tight" data-testid="text-contact-name">
                    {contact.firstName} {contact.lastName}
                  </h2>
                  {contact.company && (
                    <p className="text-sm text-muted-foreground" data-testid="text-contact-company">{contact.company}</p>
                  )}
                  {/* Lead type badge */}
                  {contact.leadType && (
                    <Badge className="mt-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs" data-testid="badge-lead-type">
                      {leadTypeLabel(contact.leadType)}
                    </Badge>
                  )}
                  {/* Interest Level */}
                  {contact.interestLevel && (
                    <Badge className={`mt-1 text-xs ${
                      contact.interestLevel === "High"   ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                      contact.interestLevel === "Medium" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}>
                      {contact.interestLevel} Interest
                    </Badge>
                  )}
                </div>

                {/* Primary Contact */}
                <SectionHeader>Primary Contact</SectionHeader>
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Owner’s Name" value={pipelineContactOwnerName(contact) || "Not confirmed"} />
                <ContactOwnerNameSearch contact={contact} />
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Cell Phone" value={contact.phoneCell ?? contact.phone} link={(contact.phoneCell ?? contact.phone) ? `tel:${contact.phoneCell ?? contact.phone}` : undefined} />
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Work Phone" value={contact.phoneWork} link={contact.phoneWork ? `tel:${contact.phoneWork}` : undefined} />
                <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} link={contact.email ? `mailto:${contact.email}` : undefined} />
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Job Title" value={contact.jobTitle} />

                {/* Location */}
                <SectionHeader>Location</SectionHeader>
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={contact.address} />
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="City" value={contact.city} />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="# of Locations" value={contact.numberOfLocations?.toString()} />
                <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="# of Employees" value={contact.numberOfEmployees?.toString()} />

                {/* TownGrid list and lead type */}
                <SectionHeader>Lead</SectionHeader>
                <InfoRow icon={<Monitor className="h-3.5 w-3.5" />} label="List" value={contact.leadList ? leadListLabel(contact.leadList) : "Not set"} />
                <InfoRow icon={<Monitor className="h-3.5 w-3.5" />} label="Lead type" value={contact.leadType ? leadTypeLabel(contact.leadType) : "Not set"} />

                {/* Digital Presence */}
                <SectionHeader>Digital Presence</SectionHeader>
                <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="Website" value={contact.websiteUrl} link={contact.websiteUrl ?? undefined} />
                <InfoRow icon={<Link2 className="h-3.5 w-3.5" />} label="Contact Form URL" value={contact.contactRequestFormUrl} link={contact.contactRequestFormUrl ?? undefined} />
                <InfoRow icon={<Facebook className="h-3.5 w-3.5" />} label="Facebook" value={contact.facebookUrl} link={contact.facebookUrl ?? undefined} />
                <InfoRow icon={<Instagram className="h-3.5 w-3.5" />} label="Instagram" value={contact.instagramHandle} />

                {/* Secondary Contact */}
                {(contact.secondaryFirstName || contact.secondaryLastName) && (
                  <>
                    <SectionHeader>Secondary Contact</SectionHeader>
                    <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Name" value={[contact.secondaryFirstName, contact.secondaryLastName].filter(Boolean).join(" ")} />
                  </>
                )}

                {/* Pain Points */}
                {contact.painPoints && (
                  <>
                    <SectionHeader>Pain Points</SectionHeader>
                    <p className="text-sm text-foreground py-1 whitespace-pre-line">{contact.painPoints}</p>
                  </>
                )}

                {/* Notes */}
                {contact.notes && (
                  <>
                    <SectionHeader>Notes</SectionHeader>
                    <p className="text-sm text-foreground py-1 whitespace-pre-line">{contact.notes}</p>
                  </>
                )}

                {/* Lead Info */}
                <SectionHeader>Lead Info</SectionHeader>
                <InfoRow icon={<TrendingUp className="h-3.5 w-3.5" />} label="Lead Source" value={contact.leadSource} />
                <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="Status" value={contact.status} />
                {contact.lastContactDate && (
                  <div className="flex items-start gap-2 py-1.5">
                    <span className="text-muted-foreground mt-0.5 shrink-0"><Calendar className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground leading-none mb-0.5">Last Contact</p>
                      <p className="text-sm">{format(new Date(contact.lastContactDate), "MMM d, yyyy")}</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <User className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No contact linked to this deal</p>
              </div>
            )}
          </div>

          {/* Edit Contact button */}
          {contact && !leftCollapsed && (
            <div className="p-4 border-t shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setEditContactOpen(true)}
                data-testid="button-edit-contact"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit Contact
              </Button>
            </div>
          )}
        </div>

        {/* ── CENTER: Activity Feed ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r">
          <Tabs value={activeTab} onValueChange={(tab) => { setActiveTab(tab); if (tab === "email-history") markRepliesReadMutation.mutate(); }} className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 border-b px-4 pt-3">
              <TabsList className="h-8">
                <TabsTrigger value="activity" className="text-xs" data-testid="tab-activity">Activity Feed</TabsTrigger>
                <TabsTrigger value="email-history" className="text-xs" data-testid="tab-email-history">Email History</TabsTrigger>
                <TabsTrigger value="sequences" className="text-xs" data-testid="tab-sequences">Sequences</TabsTrigger>
                <TabsTrigger value="notes" className="text-xs" data-testid="tab-notes">Notes</TabsTrigger>
              </TabsList>
            </div>

            {/* Feed area */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Activity Feed ───────────────────────────────────────── */}
              <TabsContent value="activity" className="m-0 p-4 min-h-full">
                {data?.activities && data.activities.length > 0 ? (
                  <div className="space-y-3">
                    {data.activities.map((act: any) => {
                      const cfg = ACTIVITY_CONFIG[act.activityType] ?? ACTIVITY_CONFIG.note;
                      let meta: Record<string, string> = {};
                      try { if (act.metadata) meta = JSON.parse(act.metadata); } catch {}
                      return (
                        <div key={act.id} className="flex gap-3" data-testid={`activity-${act.id}`}>
                          <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${cfg.bg} ${cfg.color}`}>
                            <cfg.Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                              {meta.callOutcome && (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{meta.callOutcome}</span>
                              )}
                              {meta.callDuration && (
                                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />{meta.callDuration}
                                </span>
                              )}
                              {meta.visitDate && (
                                <span className="text-xs text-muted-foreground">on {format(new Date(meta.visitDate), "MMM d, yyyy")}</span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatDistanceToNow(new Date(act.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            {act.notes && (
                              <p className="text-sm text-foreground whitespace-pre-wrap">{act.notes}</p>
                            )}
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              {act.createdBy === (user as any)?.id ? "You" : "Teammate"} · {format(new Date(act.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <PhoneCall className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No activities logged yet</p>
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                      Log your first call, email note, or site visit using the buttons below.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* ── Email History ───────────────────────────────────────── */}
              <TabsContent value="email-history" className="m-0 p-4 min-h-full">
                {emailLogs && emailLogs.length > 0 ? (
                  <div className="space-y-2">
                    {emailLogs.map((log: any) => {
                      const statusColor =
                        log.status === "sent"    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        log.status === "replied" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                        log.status === "failed"  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
                      const trackLabel = log.sequenceTrack === "uses_competitor" ? "Competitor Track" : "No Software Track";
                      return (
                        <div key={log.id} className="flex items-start gap-3 p-3 rounded-md border bg-card" data-testid={`email-log-${log.id}`}>
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center shrink-0 mt-0.5">
                            <Send className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <span className="text-xs font-semibold">Sequence #{log.sequenceNumber}</span>
                              <span className="text-xs text-muted-foreground">{trackLabel}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ml-auto ${statusColor}`}>
                                {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {log.sentAt
                                ? `Sent ${format(new Date(log.sentAt), "MMM d, yyyy 'at' h:mm a")}`
                                : log.scheduledSendAt
                                ? `Scheduled ${format(new Date(log.scheduledSendAt), "MMM d, yyyy 'at' h:mm a")}`
                                : "Pending"}
                            </p>
                            {log.emailResponseReceived === "true" && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 font-medium">Reply received</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Mail className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground mb-1">No emails sent yet</p>
                    <p className="text-xs text-muted-foreground/60 max-w-xs">
                      Email sequence history for this contact will appear here once sequences are started.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="sequences" className="m-0 p-4 min-h-full">
                {contact ? (
                  <DealSequencePanel contact={contact} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <TrendingUp className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm text-muted-foreground">No contact linked to this deal.</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="notes" className="m-0 p-4 min-h-full">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <StickyNote className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">No notes yet</p>
                  <p className="text-xs text-muted-foreground/60 max-w-xs">
                    Use the Note button below to pin important info about this deal.
                  </p>
                </div>
              </TabsContent>
            </div>

            {/* Log action bar */}
            <div className="shrink-0 border-t p-3 flex gap-2 flex-wrap bg-card">
              <Button variant="outline" size="sm" onClick={() => { setLogType("call"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-call">
                <PhoneCall className="h-3.5 w-3.5" /> Log Call
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("email_note"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-email-note">
                <Mail className="h-3.5 w-3.5" /> Email Note
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("note"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-note">
                <StickyNote className="h-3.5 w-3.5" /> Note
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setLogType("site_visit"); setActiveTab("activity"); }} className="flex items-center gap-1.5 text-xs" data-testid="button-log-site-visit">
                <Home className="h-3.5 w-3.5" /> Site Visit
              </Button>
            </div>
          </Tabs>
        </div>

        {/* ── RIGHT: Deal Info + Tasks ──────────────────────────────────────────── */}
        <div className="w-80 shrink-0 overflow-y-auto bg-card">
          <div className="p-4">

            {/* Deal Info */}
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Deal Info
            </h3>

            <div className="space-y-2.5">
              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-muted-foreground">Title</p>
                  <button
                    onClick={openEditDeal}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit deal"
                    data-testid="button-edit-deal"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                <button
                  onClick={openEditDeal}
                  className="text-sm font-medium text-left hover:text-primary transition-colors w-full"
                  data-testid="text-deal-title"
                >
                  {deal.title}
                </button>
              </div>

              {/* Plan */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-muted-foreground">Plan</p>
                  {!isEditingPlan && (
                    <button
                      onClick={() => { setEditPlanValue(deal.plan ?? ""); setIsEditingPlan(true); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Change plan"
                      data-testid="button-edit-plan"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {isEditingPlan ? (
                  <div className="space-y-1.5">
                    <UiSelect value={editPlanValue} onValueChange={setEditPlanValue}>
                      <UiSelectTrigger className="h-7 text-xs" data-testid="select-edit-plan">
                        <UiSelectValue placeholder="Select plan…" />
                      </UiSelectTrigger>
                      <UiSelectContent>
                        {dealPlanList.choices(deal.plan).map(plan => (
                          <UiSelectItem key={plan} value={plan}>{plan}</UiSelectItem>
                        ))}
                      </UiSelectContent>
                    </UiSelect>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2 flex-1"
                        onClick={() => { if (editPlanValue) planMutation.mutate(editPlanValue); }}
                        disabled={!editPlanValue || planMutation.isPending}
                        data-testid="button-save-plan"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        onClick={() => setIsEditingPlan(false)}
                        data-testid="button-cancel-plan"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {deal.plan ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PLAN_PILL}`} data-testid="text-deal-plan">
                        {deal.plan}
                      </span>
                    ) : (
                      <button
                        onClick={() => { setEditPlanValue(""); setIsEditingPlan(true); }}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline"
                        data-testid="button-set-plan"
                      >
                        Not set — click to add
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Value */}
              {deal.value && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Value</p>
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-deal-value">
                    ${parseFloat(deal.value).toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </p>
                </div>
              )}

              {/* Stage */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stage</p>
                <StagePill stage={deal.stage} />
              </div>

              {/* Probability */}
              {deal.probability != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Probability</p>
                  <p className={`text-sm font-semibold ${probabilityColor}`} data-testid="text-deal-probability">
                    {deal.probability}%
                  </p>
                </div>
              )}

              {/* Expected Close */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-muted-foreground">Expected Close</p>
                  <button
                    onClick={openEditDeal}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit deal"
                    data-testid="button-edit-deal-close"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                <button
                  onClick={openEditDeal}
                  className="text-sm text-left hover:text-primary transition-colors w-full"
                  data-testid="text-deal-close-date"
                >
                  {deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), "MMM d, yyyy") : <span className="text-muted-foreground">Not set — click to add</span>}
                </button>
              </div>

              {/* Demo Scheduled */}
              {deal.demoScheduledDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Demo Scheduled</p>
                  <p className="text-sm">{format(new Date(deal.demoScheduledDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Demo Completed */}
              {deal.demoCompletedDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Demo Completed</p>
                  <p className="text-sm">{format(new Date(deal.demoCompletedDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Won Date */}
              {deal.wonDate && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Won Date</p>
                  <p className="text-sm">{format(new Date(deal.wonDate), "MMM d, yyyy")}</p>
                </div>
              )}

              {/* Commission */}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Commission</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  deal.approved === "approved" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                  deal.approved === "rejected"  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                }`}>
                  {deal.approved === "approved" ? "Approved" : deal.approved === "rejected" ? "Rejected" : "Pending"}
                </span>
              </div>

              {/* Description */}
              {deal.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{deal.description}</p>
                </div>
              )}
            </div>

            <Separator className="my-4" />

            {/* Tasks — powered by DealTaskPanel */}
            <DealTaskPanel dealId={dealId} contactId={contact?.id ?? null} />
          </div>
        </div>
      </div>

      {/* ── Log Activity dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!logType} onOpenChange={(open) => { if (!open) { setLogType(null); resetLogForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logType && ACTIVITY_CONFIG[logType] && (() => {
                const cfg = ACTIVITY_CONFIG[logType];
                return (
                  <span className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
                    <cfg.Icon className="h-4 w-4" />
                    {cfg.label}
                  </span>
                );
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Call-specific fields */}
            {logType === "call" && (
              <>
                <div className="space-y-1.5">
                  <Label>Call Outcome</Label>
                  <UiSelect value={callOutcome} onValueChange={setCallOutcome}>
                    <UiSelectTrigger data-testid="select-call-outcome">
                      <UiSelectValue placeholder="Select outcome…" />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      {CALL_OUTCOMES.map(o => (
                        <UiSelectItem key={o} value={o}>{o}</UiSelectItem>
                      ))}
                    </UiSelectContent>
                  </UiSelect>
                </div>
                <div className="space-y-1.5">
                  <Label>Duration <span className="text-muted-foreground text-xs">(optional, e.g. "5 min")</span></Label>
                  <Input
                    value={callDuration}
                    onChange={e => setCallDuration(e.target.value)}
                    placeholder="e.g. 5 min"
                    data-testid="input-call-duration"
                  />
                </div>
              </>
            )}
            {/* Site visit date */}
            {logType === "site_visit" && (
              <div className="space-y-1.5">
                <Label>Visit Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  type="date"
                  value={visitDate}
                  onChange={e => setVisitDate(e.target.value)}
                  data-testid="input-visit-date"
                />
              </div>
            )}
            {/* Notes */}
            <div className="space-y-1.5">
              <Label>
                Notes
                {logType !== "call" && <span className="text-muted-foreground text-xs ml-1">(required)</span>}
              </Label>
              <Textarea
                value={logNotes}
                onChange={e => setLogNotes(e.target.value)}
                placeholder={
                  logType === "call"       ? "What was discussed?" :
                  logType === "email_note" ? "Describe the email you sent or received…" :
                  logType === "site_visit" ? "Notes from the visit…" :
                  "Add your note…"
                }
                rows={4}
                data-testid="textarea-log-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setLogType(null); resetLogForm(); }}>Cancel</Button>
              <Button
                onClick={handleSubmitLog}
                disabled={logActivityMutation.isPending || (!logNotes.trim() && logType !== "call")}
                data-testid="button-submit-log"
              >
                {logActivityMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Won Commission Popup ─────────────────────────────────────────────── */}
      <Dialog open={wonPopupOpen} onOpenChange={(open) => { if (!commissionMutation.isPending) setWonPopupOpen(open); }}>
        <DialogContent className="max-w-md" data-testid="dialog-won-commission">
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
              <UiSelect value={wonPlanChoice} onValueChange={setWonPlanChoice}>
                <UiSelectTrigger data-testid="select-won-plan">
                  <UiSelectValue placeholder="Select plan…" />
                </UiSelectTrigger>
                <UiSelectContent>
                  {dealPlanList.choices(deal.plan).map(plan => (
                    <UiSelectItem key={plan} value={plan}>{plan}</UiSelectItem>
                  ))}
                </UiSelectContent>
              </UiSelect>
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
              onClick={() => { if (wonPlanChoice) commissionMutation.mutate({ planName: wonPlanChoice }); }}
              disabled={!wonPlanChoice || commissionMutation.isPending}
              data-testid="button-confirm-won"
            >
              {commissionMutation.isPending ? "Saving…" : "Mark as Won"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Deal modal */}
      <Dialog open={editDealOpen} onOpenChange={setEditDealOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Deal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-deal-title">Title</Label>
              <Input
                id="edit-deal-title"
                value={editDealTitle}
                onChange={e => setEditDealTitle(e.target.value)}
                placeholder="Deal title"
                data-testid="input-edit-deal-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-deal-value">Value ($)</Label>
              <Input
                id="edit-deal-value"
                type="number"
                min="0"
                step="0.01"
                value={editDealValue}
                onChange={e => setEditDealValue(e.target.value)}
                placeholder="0.00"
                data-testid="input-edit-deal-value"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-deal-probability">Probability (%)</Label>
              <Input
                id="edit-deal-probability"
                type="number"
                min="0"
                max="100"
                value={editDealProbability}
                onChange={e => setEditDealProbability(e.target.value)}
                placeholder="0–100"
                data-testid="input-edit-deal-probability"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-deal-close-date">Expected Close Date</Label>
              <Input
                id="edit-deal-close-date"
                type="date"
                value={editDealCloseDate}
                onChange={e => setEditDealCloseDate(e.target.value)}
                data-testid="input-edit-deal-close-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDealOpen(false)} data-testid="button-cancel-edit-deal">
              Cancel
            </Button>
            <Button
              onClick={submitEditDeal}
              disabled={!editDealTitle.trim() || dealEditMutation.isPending}
              data-testid="button-save-edit-deal"
            >
              {dealEditMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact modal */}
      <Dialog open={editContactOpen} onOpenChange={setEditContactOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>
          {contact && (
            <ContactForm
              contact={contact}
              onSuccess={() => {
                setEditContactOpen(false);
                queryClient.invalidateQueries({ queryKey: ["/api/deal-workspace", dealId] });
              }}
              onCancel={() => setEditContactOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
