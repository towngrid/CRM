import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Mail, Edit, CheckCircle, XCircle, Users, Plus, Clock, Trash2 } from "lucide-react";
import type { EmailSequence, EmailSequenceLog, Contact, ContactGroup, User } from "@shared/schema";
import EmailSequenceForm from "@/components/email-sequences/email-sequence-form";
import AddContactsToSequenceDialog from "@/components/email-sequences/add-contacts-to-sequence-dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type BusinessType = "salon" | "mobile";
type SubTrack = "no_software" | "uses_competitor" | "custom";
type SequenceTrack = `${BusinessType}_${SubTrack}`;
type AnySequenceTrack = SequenceTrack;

export default function EmailSequences() {
  const [reconciliationId,setReconciliationId]=useState("");
  const [reconciliationRecipient,setReconciliationRecipient]=useState("");
  const [providerMessageId,setProviderMessageId]=useState("");
  const [providerAcceptedAt,setProviderAcceptedAt]=useState("");
  const [providerNote,setProviderNote]=useState("");
  const [providerConfirmed,setProviderConfirmed]=useState(false);
  const [providerError,setProviderError]=useState("");
  const reconciliation=useMutation({
    mutationFn:async(outcome:"accepted"|"not_accepted")=>{
      if(!providerConfirmed)throw new Error("Confirm that you inspected the provider history for this actual recipient.");
      const response=await apiRequest("POST",`/api/recipient-outreach/${reconciliationId}/reconcile`,{confirmed:true,outcome,
        recipient:reconciliationRecipient,providerMessageId,note:providerNote,
        ...(outcome==="accepted" ? {acceptedAt:new Date(providerAcceptedAt).toISOString()} : {})});
      return response.json();
    },
    onSuccess:()=>{setReconciliationId("");setProviderConfirmed(false);queryClient.invalidateQueries({queryKey:["/api/email-sequence-logs"]});},
    onError:error=>setProviderError(error.message),
  });
  const [activeBiz, setActiveBiz] = useState<BusinessType>("salon");
  const [activeSub, setActiveSub] = useState<SubTrack>("no_software");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<EmailSequence | undefined>();
  const [isAddContactsOpen, setIsAddContactsOpen] = useState(false);
  const [sequenceForContacts, setSequenceForContacts] = useState<EmailSequence | undefined>();
  const [queueViewerSequence, setQueueViewerSequence] = useState<EmailSequence | undefined>();
  const [isQueueViewerOpen, setIsQueueViewerOpen] = useState(false);
  const { toast } = useToast();

  const { data: salonNoSoftware,         isLoading: loadingSNS  } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=salon_no_software"] });
  const { data: salonCompetitor,         isLoading: loadingSC   } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=salon_uses_competitor"] });
  const { data: salonCustom,             isLoading: loadingSCu  } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=salon_custom"] });
  const { data: mobileNoSoftware,        isLoading: loadingMNS  } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=mobile_no_software"] });
  const { data: mobileCompetitor,        isLoading: loadingMC   } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=mobile_uses_competitor"] });
  const { data: mobileCustom,            isLoading: loadingMCu  } = useQuery<EmailSequence[]>({ queryKey: ["/api/email-sequences?track=mobile_custom"] });

  const trackData: Record<SequenceTrack, { data: EmailSequence[] | undefined; loading: boolean }> = {
    salon_no_software:            { data: salonNoSoftware,   loading: loadingSNS  },
    salon_uses_competitor:        { data: salonCompetitor,   loading: loadingSC   },
    salon_custom:                 { data: salonCustom,       loading: loadingSCu  },
    mobile_no_software:           { data: mobileNoSoftware,  loading: loadingMNS  },
    mobile_uses_competitor:       { data: mobileCompetitor,  loading: loadingMC   },
    mobile_custom:                { data: mobileCustom,      loading: loadingMCu  },
  };

  const activeTrack: SequenceTrack = `${activeBiz}_${activeSub}`;

  const { data: logs, isLoading: isLogsLoading, isError: isLogsError } = useQuery<(EmailSequenceLog & { recipientAddress?: string | null; recipientEvidence?: string })[]>({
    queryKey: ["/api/email-sequence-logs"],
  });

  const handleEdit = (sequence: EmailSequence) => {
    setSelectedSequence(sequence);
    setIsFormOpen(true);
  };

  const handleCreateNew = (sequenceNumber: number, track: string) => {
    setSelectedSequence({ sequenceNumber, sequenceTrack: track } as EmailSequence);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setSelectedSequence(undefined);
  };

  const handleAddContacts = (sequence: EmailSequence) => {
    setSequenceForContacts(sequence);
    setIsAddContactsOpen(true);
  };

  const handleViewQueue = (sequence: EmailSequence) => {
    setQueueViewerSequence(sequence);
    setIsQueueViewerOpen(true);
  };

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: groups } = useQuery<ContactGroup[]>({
    queryKey: ["/api/contact-groups"],
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const cancelLogMutation = useMutation({
    mutationFn: async (logId: string) => {
      const res = await apiRequest("DELETE", `/api/email-sequence-logs/${logId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to cancel" }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      toast({ title: "Email cancelled", description: "Removed from queue." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getQueueCount = (sequenceId: string | undefined) => {
    if (!sequenceId) return null;
    if (!logs) return null;
    return logs.filter(log => 
      log.sequenceId === sequenceId && 
      (log.status === "pending" || log.status === "processing" || log.status === "needs_review")
    ).length;
  };

  const renderSequenceTable = (sequences: EmailSequence[] | undefined, isLoading: boolean, track: AnySequenceTrack, stepCount = 5) => {
    const sequenceMap = new Map<number, EmailSequence>();
    sequences?.forEach(seq => {
      sequenceMap.set(seq.sequenceNumber, seq);
    });

    const allSequences = Array.from({ length: stepCount }, (_, index) => sequenceMap.get(index + 1));

    return (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Sequence</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Subject</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Schedule Rule</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Status</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">Queue</th>
                <th className="text-right px-6 py-4 text-sm font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    Loading sequences...
                  </td>
                </tr>
              ) : (
                allSequences.map((sequence, index) => {
                  const sequenceNumber = index + 1;
                  const scheduleText = sequence
                    ? sequenceNumber === 1 
                      ? `Send on ${sequence.scheduledDate ? new Date(sequence.scheduledDate).toLocaleDateString() : 'Not set'} at ${sequence.scheduledTime || 'Not set'}`
                      : `${sequence.daysAfterNoReply || 0} days after no reply to Sequence ${sequenceNumber - 1}`
                    : sequenceNumber === 1
                    ? "Not configured"
                    : `After Sequence ${sequenceNumber - 1}`;

                  return (
                    <tr 
                      key={sequenceNumber} 
                      className="hover:bg-muted/50 transition-colors"
                      data-testid={`row-sequence-${track}-${sequenceNumber}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            sequence?.isActive === "true" ? "bg-primary" : "bg-muted"
                          }`}>
                            <Mail className={`h-5 w-5 ${
                              sequence?.isActive === "true" ? "text-primary-foreground" : "text-muted-foreground"
                            }`} />
                          </div>
                          <span className="font-semibold text-foreground">
                            Sequence {sequenceNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-foreground" data-testid={`text-subject-${track}-${sequenceNumber}`}>
                          {sequence?.subject || "Not configured"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-muted-foreground" data-testid={`text-schedule-${track}-${sequenceNumber}`}>
                          {scheduleText}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {sequence?.isActive === "true" ? (
                          <div className="flex items-center space-x-2 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-sm font-medium" data-testid={`status-active-${track}-${sequenceNumber}`}>Active</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 text-muted-foreground">
                            <XCircle className="h-4 w-4" />
                            <span className="text-sm font-medium" data-testid={`status-inactive-${track}-${sequenceNumber}`}>Inactive</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {sequence ? (
                          <button
                            className="flex items-center space-x-2 hover:text-primary transition-colors group"
                            onClick={() => handleViewQueue(sequence)}
                            data-testid={`queue-count-${track}-${sequenceNumber}`}
                            title="Click to view queue"
                          >
                            <Users className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                            <span className="text-sm font-medium underline-offset-2 group-hover:underline">
                              {isLogsLoading ? (
                                "Loading..."
                              ) : isLogsError ? (
                                <span className="text-destructive">Error</span>
                              ) : (
                                `${getQueueCount(sequence.id) ?? 0} queued`
                              )}
                            </span>
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (sequence) {
                                handleEdit(sequence);
                              } else {
                                handleCreateNew(sequenceNumber, track);
                              }
                            }}
                            data-testid={`button-edit-${track}-${sequenceNumber}`}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            {sequence ? "Edit" : "Configure"}
                          </Button>
                          {sequence && sequence.isActive === "true" && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleAddContacts(sequence)}
                              data-testid={`button-add-contacts-${track}-${sequenceNumber}`}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Contacts
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  return (
    <>
      <Header 
        title="Email Sequences" 
        showAddButton={false}
      />
      
      <main className="flex-1 min-h-0 overflow-auto p-6 bg-muted/30" data-testid="email-sequences-content">
        <div className="max-w-6xl mx-auto">
          <p className="mb-4 text-sm text-muted-foreground">Outreach controls which messages and follow-ups are scheduled. Leads are researched and approved separately; Contacts store the business record, and Pipeline tracks the sales opportunity. Review recipient history and confirm enrollment before scheduling.</p>
          {/* Outer: Business Type */}
          <Tabs value={activeBiz} onValueChange={(v) => setActiveBiz(v as BusinessType)} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 max-w-xs" data-testid="tabs-business-type">
              <TabsTrigger value="salon" data-testid="tab-salon">Salon</TabsTrigger>
              <TabsTrigger value="mobile" data-testid="tab-mobile">Mobile</TabsTrigger>
            </TabsList>

            {(["salon", "mobile"] as BusinessType[]).map((biz) => (
              <TabsContent key={biz} value={biz} className="space-y-4">
                {/* Inner: Software track */}
                <Tabs value={activeSub} onValueChange={(v) => setActiveSub(v as SubTrack)} className="space-y-4">
                  <TabsList className="grid w-full grid-cols-3 max-w-2xl" data-testid={`tabs-sub-${biz}`}>
                    <TabsTrigger value="no_software" data-testid={`tab-${biz}-no-software`}>No Software</TabsTrigger>
                    <TabsTrigger value="uses_competitor" data-testid={`tab-${biz}-uses-competitor`}>Uses Competitor - Any</TabsTrigger>
                                                            <TabsTrigger value="custom" data-testid={`tab-${biz}-general`}>General</TabsTrigger>
                  </TabsList>

                  <TabsContent value="no_software" className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">{biz === "salon" ? "Salon" : "Mobile"} — No Software Track</h3>
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        Sent to {biz} contacts who don't currently use any booking software. Focus on pain points and benefits of adopting software.
                      </p>
                    </div>
                    {renderSequenceTable(trackData[`${biz}_no_software`].data, trackData[`${biz}_no_software`].loading, `${biz}_no_software`)}
                  </TabsContent>

                  <TabsContent value="uses_competitor" className="space-y-4">
                    <div className="p-4 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-1">{biz === "salon" ? "Salon" : "Mobile"} — Uses Competitor (Any) Track</h3>
                      <p className="text-sm text-orange-800 dark:text-orange-200">
                        Sent to {biz} contacts using any competitor software (Vagaro, 123Pets, Pawfinity, etc.). Focus on switching benefits and competitive advantages.
                      </p>
                    </div>
                    {renderSequenceTable(trackData[`${biz}_uses_competitor`].data, trackData[`${biz}_uses_competitor`].loading, `${biz}_uses_competitor`)}
                  </TabsContent>

                  <TabsContent value="custom" className="space-y-4">
                    <div className="p-4 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg">
                      <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-1">{biz === "salon" ? "Salon" : "Mobile"} — General Track</h3>
                      <p className="text-sm text-purple-800 dark:text-purple-200">
                        Accepts any {biz} contact regardless of software status. Write a unique email per contact for personalized one-on-one outreach.
                      </p>
                    </div>
                    {renderSequenceTable(trackData[`${biz}_custom`].data, trackData[`${biz}_custom`].loading, `${biz}_custom`)}
                  </TabsContent>
                </Tabs>
              </TabsContent>
            ))}
          </Tabs>

          <div className="mt-6 p-4 bg-muted border border-border rounded-lg">
            <h3 className="font-semibold text-foreground mb-2">How Email Sequences Work</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Choose a recipient and audience track explicitly</li>
              <li>• Sequence 1 sends on your chosen date and time (Eastern Time)</li>
              <li>• Sequences 2-5 send automatically after specified days if no reply received</li>
              <li>• Use [Contact_Greeting] for an automatic personal or business-team greeting. Other placeholders: [Contact_First_Name], [Sales_Person], [Business_Name], and [City]</li>
              <li>• Requires Reserved VM deployment for 24/7 automation</li>
            </ul>
          </div>
        </div>
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSequence?.id 
                ? `Edit Sequence ${selectedSequence.sequenceNumber}` 
                : `Configure Sequence ${selectedSequence?.sequenceNumber || 1}`}
              {selectedSequence?.sequenceTrack && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({selectedSequence.sequenceTrack
                    .replace("salon_", "Salon — ")
                    .replace("mobile_", "Mobile — ")
                    .replace("uses_competitor", "Uses Competitor - Any")
                    .replace("no_software", "No Software")
                    .replace("custom", "General")} Track)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <EmailSequenceForm
            sequence={selectedSequence}
            onSuccess={handleFormClose}
            onCancel={handleFormClose}
          />
        </DialogContent>
      </Dialog>

      {sequenceForContacts && (
        <AddContactsToSequenceDialog
          sequence={sequenceForContacts}
          open={isAddContactsOpen}
          onOpenChange={setIsAddContactsOpen}
        />
      )}

      {/* Queue Viewer Dialog */}
      <Dialog open={isQueueViewerOpen} onOpenChange={setIsQueueViewerOpen}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Queue — Sequence {queueViewerSequence?.sequenceNumber}
              {queueViewerSequence?.sequenceTrack && (
                <Badge variant="outline" className="text-xs">
                  {queueViewerSequence.sequenceTrack
                    .replace("salon_", "Salon — ")
                    .replace("mobile_", "Mobile — ")
                    .replace("uses_competitor", "Uses Competitor - Any")
                    .replace("no_software", "No Software")
                    .replace("custom", "General")}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Pending emails scheduled for this sequence. Click the trash icon to cancel individual sends.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const queueLogs = queueViewerSequence
              ? (logs ?? []).filter(
                  l =>
                    l.sequenceId === queueViewerSequence.id &&
                    (l.status === "pending" || l.status === "processing" || l.status === "needs_review")
                )
              : [];

            const getContact = (contactId: string) =>
              contacts?.find(x => x.id === contactId);

            const getContactName = (contactId: string) => {
              const c = getContact(contactId);
              if (!c) return "Unknown Contact";
              return `${c.firstName} ${c.lastName}`.trim() || c.email || "Unknown Contact";
            };

            const getContactEmail = (contactId: string) => {
              return getContact(contactId)?.email ?? "";
            };

            const getGroupName = (contactId: string) => {
              const c = getContact(contactId);
              if (!c?.groupId) return null;
              return groups?.find(g => g.id === c.groupId)?.name ?? null;
            };

            const allSequences = [
              ...Object.values(trackData).flatMap(t => t.data ?? []),
            ];

            const getSubject = (log: EmailSequenceLog) => {
              if (log.customSubject) return log.customSubject;
              return allSequences.find(s => s.id === log.sequenceId)?.subject ?? "";
            };

            const getSalesperson = (userId: string) => {
              const u = allUsers?.find(u => u.id === userId);
              if (!u) return null;
              return u.firstName && u.lastName
                ? `${u.firstName} ${u.lastName}`
                : u.email ?? null;
            };

            if (queueLogs.length === 0) {
              return (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No emails pending in the queue for this sequence.
                </div>
              );
            }

            return (
              <ScrollArea className="max-h-[420px]">
                <div className="divide-y">
                  {queueLogs.map(log => {
                    const groupName = getGroupName(log.contactId);
                    const subject = getSubject(log);
                    const salesperson = getSalesperson(log.userId);
                    return (
                    <div key={log.id} className="flex items-start gap-3 px-1 py-3" data-testid={`queue-item-${log.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                          {getContactName(log.contactId)}
                          {groupName && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
                              {groupName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {log.recipientAddress || "Historical recipient unknown — current contact email is not historical send evidence."}
                        </div>
                        {log.status === "needs_review" && <div className="space-y-2 mt-1 text-xs">
                          <p className="text-destructive">Delivery needs review: {log.errorMessage || "Inspect provider history before retrying. Nothing has been resent."}</p>
                          {reconciliationId!==log.id?<Button size="sm" variant="outline" onClick={()=>{setReconciliationId(log.id);setReconciliationRecipient(log.recipientAddress||"");setProviderConfirmed(false);setProviderNote("");setProviderMessageId("");setProviderError("");}}>Review provider outcome</Button>:<div className="space-y-2 rounded border p-2">
                            <p>Inspect the email provider's records. Uncertain delivery must remain on hold. These actions record evidence only; they do not resend or delete anything.</p>
                            <input className="w-full rounded border p-2" aria-label="Actual recipient from provider history" placeholder="Actual recipient from provider history" value={reconciliationRecipient} onChange={e=>setReconciliationRecipient(e.target.value)}/>
                            <input className="w-full rounded border p-2" aria-label="Provider message ID" placeholder="Provider message ID (required for accepted delivery)" value={providerMessageId} onChange={e=>setProviderMessageId(e.target.value)}/>
                            <label>Actual provider acceptance time (your browser's local timezone)<input type="datetime-local" className="w-full rounded border p-2" value={providerAcceptedAt} onChange={e=>setProviderAcceptedAt(e.target.value)}/></label>
                            <textarea className="w-full rounded border p-2" aria-label="Provider review evidence" placeholder="Record what you inspected and the definitive outcome" value={providerNote} onChange={e=>setProviderNote(e.target.value)}/>
                            <label className="flex gap-2"><input type="checkbox" checked={providerConfirmed} onChange={e=>setProviderConfirmed(e.target.checked)}/>I inspected provider history for this exact recipient and confirmed the stated outcome.</label>
                            <div className="flex gap-2 flex-wrap"><Button size="sm" disabled={!providerConfirmed||!providerNote.trim()||!providerMessageId.trim()||!providerAcceptedAt||reconciliation.isPending} onClick={()=>reconciliation.mutate("accepted")}>Record provider acceptance</Button><Button size="sm" variant="outline" disabled={!providerConfirmed||!providerNote.trim()||reconciliation.isPending} onClick={()=>reconciliation.mutate("not_accepted")}>Record confirmed non-acceptance</Button><Button size="sm" variant="ghost" onClick={()=>setReconciliationId("")}>Cancel review</Button></div>
                            {providerError&&<p className="text-destructive">{providerError}</p>}
                          </div>}
                        </div>}
                        {subject && (
                          <div className="text-xs text-foreground mt-1 font-medium truncate" title={subject}>
                            Subject: {subject}
                          </div>
                        )}
                        {salesperson && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Salesperson: {salesperson}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {log.scheduledSendAt
                            ? new Date(log.scheduledSendAt).toLocaleString("en-US", {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: "America/New_York",
                              }) + " ET"
                            : "No send time set"}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          log.status === "processing"
                            ? "text-blue-600 border-blue-300"
                            : "text-amber-600 border-amber-300"
                        }
                      >
                        {log.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        disabled={cancelLogMutation.isPending || log.status !== "pending"}
                        onClick={() => cancelLogMutation.mutate(log.id)}
                        data-testid={`button-cancel-log-${log.id}`}
                        title={log.status !== "pending" ? "Can only cancel pending emails" : "Cancel this email"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    );
                  })}
                </div>
              </ScrollArea>
            );
          })()}

          <div className="flex justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => setIsQueueViewerOpen(false)} data-testid="button-close-queue">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
