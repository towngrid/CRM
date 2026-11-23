import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Mail, Plus, CalendarClock, Pencil, Building2, Phone,
  Trash2, Clock, CheckCircle2, XCircle, Loader2, SendHorizontal, User, Save, Link2, Info
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { Contact, EmailSequence, EmailSequenceLog } from "@shared/schema";

const QUICK_LINKS: { label: string; html: string; description?: string }[] = [
  { label: "Visit TownGrid", html: '<a href="https://towngrid.net/">Visit TownGrid</a>' },
];

interface DealSequencePanelProps {
  contact: Contact;
}

const TRACK_LABELS: Record<string, string> = {
  salon_no_software: "Salon - No Software",
  salon_uses_competitor: "Salon - Uses Competitor (Any)",
  salon_custom: "Salon - General",
  mobile_no_software: "Mobile - No Software",
  mobile_uses_competitor: "Mobile - Uses Competitor (Any)",
  mobile_custom: "Mobile - General",
  // Legacy fallbacks
  no_software: "No Software",
  uses_competitor: "Uses Competitor",
  custom: "Custom / General",
};

const TRACK_COLORS: Record<string, string> = {
  salon_no_software: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  salon_uses_competitor: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  salon_custom: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  mobile_no_software: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  mobile_uses_competitor: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  mobile_custom: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  // Legacy fallbacks
  no_software: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  uses_competitor: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  custom: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

const STATUS_ICONS: Record<string, JSX.Element> = {
  pending:    <Clock className="h-3.5 w-3.5 text-amber-500" />,
  processing: <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  sent:       <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  failed:     <XCircle className="h-3.5 w-3.5 text-destructive" />,
  replied:    <CheckCircle2 className="h-3.5 w-3.5 text-purple-500" />,
};

const STATUS_LABELS: Record<string, string> = {
  pending:    "Scheduled",
  processing: "Sending…",
  sent:       "Sent",
  failed:     "Failed",
  replied:    "Replied",
};

function formatET(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(dateStr)) + " ET";
  } catch {
    return "—";
  }
}

function toETDateTimeInputs(dateStr: string | Date | null | undefined): { date: string; time: string } {
  if (!dateStr) return { date: "", time: "09:00" };
  try {
    const d = new Date(dateStr);
    const etParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const get = (t: string) => etParts.find(p => p.type === t)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = get("hour") === "24" ? "00" : get("hour");
    const time = `${hour}:${get("minute")}`;
    return { date, time };
  } catch {
    return { date: "", time: "09:00" };
  }
}

function buildETISOString(date: string, time: string): string {
  const refUtc = new Date(`${date}T12:00:00Z`);
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).format(refUtc),
    10
  );
  const offsetHours = etHour - 12;
  const sign = offsetHours >= 0 ? "+" : "-";
  const etOffsetStr = `${sign}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`;
  return `${date}T${time}:00${etOffsetStr}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Update Dialog — edit subject, body, and reschedule a pending email
// ──────────────────────────────────────────────────────────────────────────────
interface UpdateDialogProps {
  log: EmailSequenceLog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function UpdateSequenceDialog({ log, open, onOpenChange, onSuccess }: UpdateDialogProps) {
  const { toast } = useToast();

  const { data: sequence } = useQuery<EmailSequence>({
    queryKey: ["/api/email-sequences", log.sequenceId],
    queryFn: () => fetch(`/api/email-sequences/${log.sequenceId}`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const initialDT = toETDateTimeInputs(log.scheduledSendAt);
  const [sendDate, setSendDate] = useState(initialDT.date);
  const [sendTime, setSendTime] = useState(initialDT.time);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function insertQuickLinkUpdate(html: string) {
    const currentBody = body ?? (log.customBody || sequence?.body || "");
    const el = bodyRef.current;
    const pos = el ? el.selectionStart : currentBody.length;
    const newVal = currentBody.slice(0, pos) + html + currentBody.slice(pos);
    setBody(newVal);
    if (el) {
      const newPos = pos + html.length;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newPos, newPos); });
    }
  }

  const effectiveSubject = subject ?? (log.customSubject || sequence?.subject || "");
  const effectiveBody = body ?? (log.customBody || sequence?.body || "");

  const reset = () => {
    const dt = toETDateTimeInputs(log.scheduledSendAt);
    setSendDate(dt.date);
    setSendTime(dt.time);
    setSubject(null);
    setBody(null);
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!sendDate) throw new Error("Please pick a send date");
      const scheduledSendAt = buildETISOString(sendDate, sendTime);
      const payload: Record<string, unknown> = { scheduledSendAt };
      if (subject !== null) payload.customSubject = subject;
      if (body !== null) payload.customBody = body;
      const res = await apiRequest("PATCH", `/api/email-sequence-logs/${log.id}/reschedule`, payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to update" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      toast({ title: "Updated", description: "Sequence email has been updated." });
      handleOpenChange(false);
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" />
            Update Scheduled Email — Sequence #{log.sequenceNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Track badge */}
          <div className="flex items-center gap-2">
            <Badge className={`text-xs ${TRACK_COLORS[log.sequenceTrack] ?? "bg-muted text-muted-foreground"}`}>
              {TRACK_LABELS[log.sequenceTrack] ?? log.sequenceTrack}
            </Badge>
            <span className="text-xs text-muted-foreground">track</span>
          </div>

          {/* Date & time */}
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              Send Date &amp; Time <span className="text-xs text-muted-foreground font-normal">(Eastern Time)</span>
            </p>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={sendDate}
                  onChange={e => setSendDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  data-testid="input-update-date"
                />
              </div>
              <div className="w-32 space-y-1">
                <Label className="text-xs">Time (ET)</Label>
                <Input
                  type="time"
                  value={sendTime}
                  onChange={e => setSendTime(e.target.value)}
                  data-testid="input-update-time"
                />
              </div>
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Subject
              {!log.customSubject && log.sequenceTrack !== "custom" && (
                <span className="text-muted-foreground font-normal ml-1">(from template — edit to override)</span>
              )}
            </Label>
            <Input
              value={effectiveSubject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Email subject…"
              data-testid="input-update-subject"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">
                Body
                {!log.customBody && log.sequenceTrack !== "custom" && (
                  <span className="text-muted-foreground font-normal ml-1">(from template — edit to override)</span>
                )}
              </Label>
              <TooltipProvider delayDuration={200}>
                <div className="flex gap-1 flex-wrap justify-end">
                  {QUICK_LINKS.map(link => (
                    <Tooltip key={link.label}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => insertQuickLinkUpdate(link.html)}
                          className="h-6 text-xs gap-1 px-2"
                        >
                          <Link2 className="h-3 w-3" />
                          {link.label}
                          {link.description && <Info className="h-3 w-3 text-muted-foreground" />}
                        </Button>
                      </TooltipTrigger>
                      {link.description && (
                        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                          {link.description}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              Tokens: <code className="bg-muted px-1 rounded text-xs">[Contact_Greeting]</code>{" "}
              <code className="bg-muted px-1 rounded text-xs">[Contact_First_Name]</code>{" "}
              <code className="bg-muted px-1 rounded text-xs">[Sales_Person]</code>{" "}
              <code className="bg-muted px-1 rounded text-xs">[Business_Name]</code>
            </p>
            <Textarea
              ref={bodyRef}
              value={effectiveBody}
              onChange={e => setBody(e.target.value)}
              rows={10}
              className="resize-none text-sm font-mono"
              data-testid="textarea-update-body"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t mt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-update-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !sendDate}
            data-testid="button-update-save"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Composer Dialog
// ──────────────────────────────────────────────────────────────────────────────
interface ComposerProps {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function SequenceComposerDialog({ contact, open, onOpenChange, onSuccess }: ComposerProps) {
  const { toast } = useToast();
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("09:00");
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState(
    `[Contact_Greeting]\n\n\n\nBest regards,\n[Sales_Person]`
  );
  const customBodyRef = useRef<HTMLTextAreaElement | null>(null);

  function insertQuickLink(html: string) {
    const el = customBodyRef.current;
    const pos = el ? el.selectionStart : customBody.length;
    const newVal = customBody.slice(0, pos) + html + customBody.slice(pos);
    setCustomBody(newVal);
    if (el) {
      const newPos = pos + html.length;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newPos, newPos); });
    }
  }

  const { data: allSequences, isLoading: isLoadingSeq } = useQuery<EmailSequence[]>({
    queryKey: ["/api/email-sequences"],
    queryFn: () => fetch("/api/email-sequences", { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const seqOptions = useMemo(() => {
    if (!allSequences) return [];
    return allSequences.filter(s => s.sequenceNumber === 1);
  }, [allSequences]);

  const selectedSeq = useMemo(
    () => seqOptions.find(s => s.id === selectedSequenceId),
    [seqOptions, selectedSequenceId]
  );

  const isCustomTrack = selectedSeq?.sequenceTrack === "custom";
  const emailPreview = useQuery<{ renderedSubject: string; renderedBody: string; greetingPreview: string }>({
    queryKey: ["/api/contacts", contact.id, "sequence-preview", selectedSequenceId,
      contact.firstName, contact.lastName, contact.useBusinessNameForEmail,
      isCustomTrack ? customSubject : "", isCustomTrack ? customBody : ""],
    queryFn: async () => (await apiRequest("POST", `/api/contacts/${contact.id}/owner-name/preview`, {
      sequenceId: selectedSequenceId,
      ...(isCustomTrack ? { customSubject: customSubject.trim(), customBody: customBody.trim() } : {}),
    })).json(),
    enabled: open && !!selectedSeq,
    staleTime: 0,
  });

  const reset = () => {
    setSelectedSequenceId("");
    setSendDate("");
    setSendTime("09:00");
    setCustomSubject("");
    setCustomBody(`[Contact_Greeting]\n\n\n\nBest regards,\n[Sales_Person]`);
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSequenceId) throw new Error("Please select a sequence");
      if (!sendDate) throw new Error("Please pick a send date");
      if (isCustomTrack && !customSubject.trim()) throw new Error("Please enter a subject");
      if (isCustomTrack && !customBody.trim()) throw new Error("Please enter an email body");

      const scheduledSendAt = buildETISOString(sendDate, sendTime);

      const payload: Record<string, unknown> = {
        sequenceId: selectedSequenceId,
        contactIds: [contact.id],
        scheduledSendAt,
      };
      if (isCustomTrack) {
        payload.customSubject = customSubject.trim();
        payload.customBody = customBody.trim();
      }

      const res = await apiRequest("POST", "/api/email-sequence-logs/bulk", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to schedule" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
      if (data.successful > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/deals/email-summaries"] });
        toast({
          title: "Sequence scheduled",
          description: `${contact.firstName} will receive Sequence #${selectedSeq?.sequenceNumber} on ${sendDate} at ${sendTime} ET.`,
        });
        handleOpenChange(false);
        onSuccess();
      } else {
        const firstError = data.errors?.[0]?.error ?? "Unknown error";
        toast({ title: "Not scheduled", description: firstError, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isDisabled =
    submitMutation.isPending ||
    !selectedSequenceId ||
    !sendDate ||
    (isCustomTrack && !customSubject.trim()) ||
    (isCustomTrack && !customBody.trim());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl w-full max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <SendHorizontal className="h-4 w-4" />
            Start New Sequence for {contact.firstName} {contact.lastName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* ── LEFT: Contact Summary ──────────────────────────────────── */}
          <div className="w-64 shrink-0 border-r bg-muted/30 p-4 overflow-y-auto space-y-4">
            <div className="flex flex-col items-center text-center gap-2 pt-2">
              <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-xl font-semibold text-primary-foreground">
                {(contact.firstName?.[0] ?? "")}
                {(contact.lastName?.[0] ?? "")}
              </div>
              <div>
                <p className="font-semibold text-sm">{contact.firstName} {contact.lastName}</p>
                {contact.company && (
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                    <Building2 className="h-3 w-3" />{contact.company}
                  </p>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-xs">
              {contact.email && (
                <div className="flex items-start gap-2">
                  <Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <span className="break-all text-foreground">{contact.email}</span>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{contact.phone}</span>
                </div>
              )}
              {contact.jobTitle && (
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{contact.jobTitle}</span>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              {contact.usesSoftware && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Software</p>
                  <Badge variant="outline" className={`text-xs ${
                    contact.usesSoftware === "Yes"
                      ? "border-orange-300 text-orange-600"
                      : contact.usesSoftware === "No"
                        ? "border-green-300 text-green-600"
                        : "border-muted text-muted-foreground"
                  }`}>
                    {contact.usesSoftware === "Yes" ? "Uses Software" : contact.usesSoftware === "No" ? "No Software" : "Unknown"}
                  </Badge>
                </div>
              )}
              {contact.interestLevel && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Interest</p>
                  <Badge variant="outline" className="text-xs">{contact.interestLevel}</Badge>
                </div>
              )}
              {contact.currentSoftware && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Current Software</p>
                  <p className="text-xs font-medium">{contact.currentSoftware}</p>
                </div>
              )}
            </div>

            {contact.painPoints && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pain Points</p>
                  <p className="text-xs leading-relaxed">{contact.painPoints}</p>
                </div>
              </>
            )}
          </div>

          {/* ── RIGHT: Composer ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Sequence to Start</Label>
              {isLoadingSeq ? (
                <p className="text-xs text-muted-foreground">Loading sequences…</p>
              ) : seqOptions.length === 0 ? (
                <p className="text-xs text-amber-600">No Sequence #1 templates found. Configure sequences in Email Sequences first.</p>
              ) : (
                <Select value={selectedSequenceId} onValueChange={setSelectedSequenceId}>
                  <SelectTrigger data-testid="select-sequence">
                    <SelectValue placeholder="Choose a sequence…" />
                  </SelectTrigger>
                  <SelectContent>
                    {seqOptions.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span>{TRACK_LABELS[s.sequenceTrack] ?? s.sequenceTrack}</span>
                          <span className="text-muted-foreground text-xs">— {s.subject || "No subject"}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedSeq && !isCustomTrack && (
              <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs ${TRACK_COLORS[selectedSeq.sequenceTrack] ?? ""}`}>
                    {TRACK_LABELS[selectedSeq.sequenceTrack] ?? selectedSeq.sequenceTrack}
                  </Badge>
                  <span className="text-xs text-muted-foreground">track — template email will be sent</span>
                </div>
                <p className="text-xs font-medium mt-1">Subject: {selectedSeq.subject}</p>
              </div>
            )}

            {selectedSeq && isCustomTrack && (
              <div className="space-y-3 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-3">
                <div className="flex items-center gap-1.5">
                  <Pencil className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  <p className="text-xs font-medium text-purple-800 dark:text-purple-200">
                    Custom Email — write a personalized message for {contact.firstName}
                  </p>
                </div>
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  Tokens: <code className="bg-purple-100 dark:bg-purple-900 px-1 rounded text-xs">[Contact_Greeting]</code>{" "}
                  <code className="bg-purple-100 dark:bg-purple-900 px-1 rounded text-xs">[Contact_First_Name]</code>{" "}
                  <code className="bg-purple-100 dark:bg-purple-900 px-1 rounded text-xs">[Sales_Person]</code>{" "}
                  <code className="bg-purple-100 dark:bg-purple-900 px-1 rounded text-xs">[Business_Name]</code>
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder={`e.g. Quick question about ${contact.company || "[Business_Name]"}`}
                    value={customSubject}
                    onChange={e => setCustomSubject(e.target.value)}
                    data-testid="input-custom-subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Body <span className="text-destructive">*</span></Label>
                    <TooltipProvider delayDuration={200}>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {QUICK_LINKS.map(link => (
                          <Tooltip key={link.label}>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => insertQuickLink(link.html)}
                                className="h-6 text-xs gap-1 px-2"
                              >
                                <Link2 className="h-3 w-3" />
                                {link.label}
                                {link.description && <Info className="h-3 w-3 text-muted-foreground" />}
                              </Button>
                            </TooltipTrigger>
                            {link.description && (
                              <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                                {link.description}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        ))}
                      </div>
                    </TooltipProvider>
                  </div>
                  <Textarea
                    ref={customBodyRef}
                    value={customBody}
                    onChange={e => setCustomBody(e.target.value)}
                    rows={8}
                    className="resize-none text-sm font-mono"
                    data-testid="textarea-custom-body"
                  />
                </div>
              </div>
            )}

            {selectedSeq && (
              <div className="rounded-md border-2 border-slate-400 bg-background p-3 space-y-2" data-testid="sequence-email-preview">
                <p className="text-sm font-semibold">Email preview · current Contact name</p>
                {emailPreview.isLoading ? <p role="status" className="text-xs text-muted-foreground">Rendering email…</p>
                  : emailPreview.isError ? <p role="alert" className="text-xs text-destructive">{(emailPreview.error as Error).message}</p>
                  : emailPreview.data && <>
                    <p className="text-sm font-semibold" data-testid="sequence-greeting-preview">{emailPreview.data.greetingPreview}</p>
                    <p className="text-xs font-medium">Subject: {emailPreview.data.renderedSubject}</p>
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">{emailPreview.data.renderedBody}</pre>
                  </>}
              </div>
            )}
            {selectedSeq && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  Send Date &amp; Time <span className="text-xs text-muted-foreground font-normal">(Eastern Time)</span>
                </p>
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={sendDate}
                      onChange={e => setSendDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      data-testid="input-send-date"
                    />
                  </div>
                  <div className="w-32 space-y-1">
                    <Label className="text-xs">Time (ET)</Label>
                    <Input
                      type="time"
                      value={sendTime}
                      onChange={e => setSendTime(e.target.value)}
                      data-testid="input-send-time"
                    />
                  </div>
                </div>
                {!sendDate && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">A send date is required.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button onClick={() => submitMutation.mutate()} disabled={isDisabled} data-testid="button-schedule">
            <SendHorizontal className="h-4 w-4 mr-2" />
            {submitMutation.isPending ? "Scheduling…" : "Schedule Sequence"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Panel (renders inside the Sequences tab)
// ──────────────────────────────────────────────────────────────────────────────
export default function DealSequencePanel({ contact }: DealSequencePanelProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<EmailSequenceLog | null>(null);
  const { toast } = useToast();

  const { data: logs, isLoading, refetch } = useQuery<EmailSequenceLog[]>({
    queryKey: ["/api/email-sequence-logs", contact.id],
    queryFn: () =>
      fetch(`/api/email-sequence-logs?contactId=${contact.id}`, { credentials: "include" }).then(r => r.json()),
  });

  const cancelMutation = useMutation({
    mutationFn: async (logId: string) => {
      const res = await apiRequest("DELETE", `/api/email-sequence-logs/${logId}`);
      if (!res.ok) throw new Error("Failed to cancel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs", contact.id] });
      toast({ title: "Cancelled", description: "Email removed from queue." });
    },
    onError: () => toast({ title: "Error", description: "Could not cancel email.", variant: "destructive" }),
  });

  const sortedLogs = useMemo(() => {
    if (!logs) return [];
    return [...logs].sort((a, b) => {
      const order = { pending: 0, processing: 1, sent: 2, replied: 3, failed: 4 };
      return (order[a.status as keyof typeof order] ?? 9) - (order[b.status as keyof typeof order] ?? 9);
    });
  }, [logs]);

  return (
    <div className="flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold">Email Sequences</p>
          <p className="text-xs text-muted-foreground">Sequence history for {contact.firstName} {contact.lastName}</p>
        </div>
        <Button size="sm" onClick={() => setComposerOpen(true)} data-testid="button-new-sequence">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Sequence
        </Button>
      </div>

      {/* Sequence log list */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading sequences…
        </div>
      ) : sortedLogs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 gap-3">
          <Mail className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No sequences yet</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs">
            Click "New Sequence" to schedule a personalized outreach email for {contact.firstName}.
          </p>
          <Button size="sm" variant="outline" onClick={() => setComposerOpen(true)} data-testid="button-new-sequence-empty">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Start First Sequence
          </Button>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {sortedLogs.map(log => (
            <div
              key={log.id}
              className="flex items-start gap-3 p-3 rounded-md border bg-card hover:bg-muted/30 transition-colors"
              data-testid={`sequence-log-${log.id}`}
            >
              <div className="mt-0.5">{STATUS_ICONS[log.status] ?? <Clock className="h-3.5 w-3.5 text-muted-foreground" />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">Sequence #{log.sequenceNumber}</span>
                  <Badge className={`text-xs px-1.5 py-0 ${TRACK_COLORS[log.sequenceTrack] ?? "bg-muted text-muted-foreground"}`}>
                    {TRACK_LABELS[log.sequenceTrack] ?? log.sequenceTrack}
                  </Badge>
                  <span className={`text-xs font-medium ${
                    log.status === "sent" || log.status === "replied" ? "text-green-600 dark:text-green-400" :
                    log.status === "failed" ? "text-destructive" :
                    log.status === "pending" ? "text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground"
                  }`}>
                    {STATUS_LABELS[log.status] ?? log.status}
                  </span>
                </div>
                {/* Custom subject override indicator */}
                {log.customSubject && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    <span className="font-medium">Subject:</span> {log.customSubject}
                  </p>
                )}
                {/* Timing */}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {log.status === "pending" && log.scheduledSendAt
                    ? `Scheduled: ${formatET(log.scheduledSendAt)}`
                    : log.status === "sent" && log.createdAt
                      ? `Sent: ${formatET(log.createdAt)}`
                      : log.status === "replied"
                        ? "Contact replied"
                        : log.status === "failed"
                          ? "Failed to send"
                          : log.scheduledSendAt
                            ? formatET(log.scheduledSendAt)
                            : ""}
                </p>
              </div>
              {/* Action buttons (only for pending) */}
              {log.status === "pending" && (
                <div className="flex items-center gap-1.5 mt-0.5 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setEditingLog(log)}
                    data-testid={`button-update-log-${log.id}`}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Update
                  </Button>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => cancelMutation.mutate(log.id)}
                    disabled={cancelMutation.isPending}
                    title="Cancel scheduled email"
                    data-testid={`button-cancel-log-${log.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Composer dialog */}
      <SequenceComposerDialog
        contact={contact}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onSuccess={() => refetch()}
      />

      {/* Update dialog */}
      {editingLog && (
        <UpdateSequenceDialog
          log={editingLog}
          open={!!editingLog}
          onOpenChange={(open) => { if (!open) setEditingLog(null); }}
          onSuccess={() => { refetch(); setEditingLog(null); }}
        />
      )}
    </div>
  );
}
