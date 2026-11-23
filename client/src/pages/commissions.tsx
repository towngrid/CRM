import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Header from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, TrendingUp, Calendar, RefreshCw, Award, Search, Eye, Send, Save, X, Loader2, FileText } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type EnrichedCommission = {
  id: string; dealId: string; userId: string; planName: string;
  upfrontAmount: string; monthlyAmount: string; confirmedAt: string | null;
  dealTitle: string; salespersonName: string;
};

type MonthlyPayment = {
  id: string; commissionId: string; dealId: string; userId: string;
  amount: string; periodNumber: number; paidAt: string;
};

type AdminUser = {
  id: string; firstName: string | null; lastName: string | null; email: string; role: string;
};

type PreviewItem = {
  tempId: string; commissionId: string | null; monthlyPaymentId: string | null;
  type: "upfront" | "recurring"; date: string; contactName: string;
  dealTitle: string; planName: string; originalAmount: string;
};

type PayrollPeriodFull = {
  id: string; userId: string; startDate: string; endDate: string;
  totalAmount: string; status: string; notes: string | null;
  sentAt: string | null; sentToEmails: string | null; createdAt: string;
  salespersonName: string; salespersonEmail: string;
  items: Array<{
    id: string; type: string; contactName: string; dealTitle: string;
    planName: string; originalAmount: string; adjustedAmount: string;
    date: string; notes: string | null;
  }>;
};

function planBadgeClass(planName: string) {
  return planName
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function fmtAmt(val: string | number) {
  return `$${parseFloat(String(val)).toFixed(2)}`;
}

export default function Commissions() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isAdmin = (user as any)?.role === "admin";

  // ── Commission tab queries ───────────────────────────────────────────────
  const { data: commissions, isLoading } = useQuery<EnrichedCommission[]>({ queryKey: ["/api/commissions"] });
  const { data: monthlyPayments } = useQuery<MonthlyPayment[]>({ queryKey: ["/api/commissions/monthly-payments"] });

  // ── Payroll tab queries ──────────────────────────────────────────────────
  const { data: adminUsers } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });
  const { data: payrollHistory, refetch: refetchHistory } = useQuery<PayrollPeriodFull[]>({
    queryKey: ["/api/payroll"],
  });

  // ── Payroll generation state ─────────────────────────────────────────────
  const [selectedUserId, setSelectedUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [previewItems, setPreviewItems] = useState<PreviewItem[] | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [periodNotes, setPeriodNotes] = useState("");
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [bookkeeperEmail, setBookkeeperEmail] = useState("");
  const [savedPeriodId, setSavedPeriodId] = useState<string | null>(null);

  // ── Commissions summary numbers ──────────────────────────────────────────
  const totalUpfront = commissions?.reduce((s, c) => s + parseFloat(c.upfrontAmount || "0"), 0) || 0;
  const totalMonthlyRate = commissions?.reduce((s, c) => s + parseFloat(c.monthlyAmount || "0"), 0) || 0;
  const totalMonthlyAccum = monthlyPayments?.reduce((s, p) => s + parseFloat(p.amount || "0"), 0) || 0;
  const totalEarned = totalUpfront + totalMonthlyAccum;

  const now = new Date();
  const thisMonthPayments = monthlyPayments?.filter(p => {
    const d = new Date(p.paidAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }) || [];
  const thisMonthUpfront = commissions?.filter(c => {
    if (!c.confirmedAt) return false;
    const d = new Date(c.confirmedAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((s, c) => s + parseFloat(c.upfrontAmount || "0"), 0) || 0;
  const thisMonthTotal = thisMonthPayments.reduce((s, p) => s + parseFloat(p.amount || "0"), 0) + thisMonthUpfront;

  function monthsForCommission(id: string) {
    return monthlyPayments?.filter(p => p.commissionId === id).length || 0;
  }
  function monthlyEarnedForCommission(id: string) {
    return monthlyPayments?.filter(p => p.commissionId === id).reduce((s, p) => s + parseFloat(p.amount || "0"), 0) || 0;
  }

  // ── Preview mutation ─────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleGenerate() {
    if (!selectedUserId || !startDate || !endDate) {
      toast({ title: "Please select an employee and date range", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      const resp = await fetch(`/api/payroll/preview?userId=${encodeURIComponent(selectedUserId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, { credentials: "include" });
      if (!resp.ok) throw new Error(await resp.text());
      const data: PreviewItem[] = await resp.json();
      setPreviewItems(data);
      const initAdj: Record<string, string> = {};
      data.forEach(item => { initAdj[item.tempId] = item.originalAmount; });
      setAdjustments(initAdj);
      setItemNotes({});
      setSavedPeriodId(null);
    } catch {
      toast({ title: "Failed to generate preview", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Save payroll mutation ────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!previewItems || !selectedUserId) throw new Error("No preview items");
      const lineItems = previewItems.map(item => ({
        commissionId: item.commissionId,
        monthlyPaymentId: item.monthlyPaymentId,
        type: item.type,
        contactName: item.contactName,
        dealTitle: item.dealTitle,
        planName: item.planName,
        originalAmount: item.originalAmount,
        adjustedAmount: adjustments[item.tempId] ?? item.originalAmount,
        date: item.date,
        notes: itemNotes[item.tempId] || null,
      }));
      const result = await apiRequest("POST", "/api/payroll", {
        userId: selectedUserId,
        startDate,
        endDate,
        notes: periodNotes || null,
        lineItems,
      });
      return await result.json();
    },
    onSuccess: (data) => {
      setSavedPeriodId(data.period.id);
      queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });
      toast({ title: "Payroll saved", description: "You can now email it to the salesperson." });
    },
    onError: () => toast({ title: "Failed to save payroll", variant: "destructive" }),
  });

  // ── Send email mutation ──────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async (periodId: string) => {
      const extras = bookkeeperEmail ? [bookkeeperEmail] : [];
      const resp = await apiRequest("POST", `/api/payroll/${periodId}/send`, { additionalEmails: extras });
      return await resp.json();
    },
    onSuccess: (data) => {
      toast({ title: "Email sent", description: `Sent to ${data.sentTo}` });
      setIsSendDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });
    },
    onError: () => toast({ title: "Failed to send email", variant: "destructive" }),
  });

  const previewTotal = previewItems
    ? previewItems.reduce((s, item) => s + parseFloat(adjustments[item.tempId] ?? item.originalAmount), 0)
    : 0;

  const selectedEmployee = adminUsers?.find(u => u.id === selectedUserId);

  if (isLoading) {
    return (
      <>
        <Header title="Commissions" showAddButton={false} />
        <main className="flex-1 overflow-y-auto p-6 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-8 bg-muted rounded w-16"></div>
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
      <Header title={isAdmin ? "All Commissions" : "My Commissions"} showAddButton={false} />

      <main className="flex-1 overflow-y-auto p-6 bg-muted/30" data-testid="commissions-content">
        <Tabs defaultValue="commissions" className="space-y-6">
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="commissions">Commissions</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
          </TabsList>

          {/* ── Commissions Tab ─────────────────────────────────────────── */}
          <TabsContent value="commissions" className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="total-earned-card">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Earned to Date</p>
                      <p className="text-3xl font-bold">{fmtAmt(totalEarned)}</p>
                    </div>
                    <div className="p-3 bg-green-500/10 rounded-full">
                      <Award className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                  <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Upfront (one-time)</span><span className="font-medium">{fmtAmt(totalUpfront)}</span></div>
                    <div className="flex justify-between"><span>Monthly accumulated</span><span className="font-medium text-blue-600">+{fmtAmt(totalMonthlyAccum)}</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="monthly-rate-card">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Monthly Recurring Rate</p>
                      <p className="text-3xl font-bold">{fmtAmt(totalMonthlyRate)}<span className="text-base font-normal text-muted-foreground">/mo</span></p>
                    </div>
                    <div className="p-3 bg-blue-500/10 rounded-full">
                      <RefreshCw className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-muted-foreground">Added every 30 days per active deal</div>
                </CardContent>
              </Card>

              <Card data-testid="this-month-card">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">This Month</p>
                      <p className="text-3xl font-bold">{fmtAmt(thisMonthTotal)}</p>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-full">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-muted-foreground">{thisMonthPayments.length} recurring + new deals</div>
                </CardContent>
              </Card>
            </div>

            {/* Commission Details Table */}
            {commissions && commissions.length > 0 ? (
              <Card data-testid="commission-details-table">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Commission Details</CardTitle>
                  <p className="text-sm text-muted-foreground">Won deals — upfront on close, then a monthly amount every 30 days</p>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Deal</TableHead>
                        {isAdmin && <TableHead>Salesperson</TableHead>}
                        <TableHead>Plan</TableHead>
                        <TableHead>Won Date</TableHead>
                        <TableHead className="text-right">Upfront</TableHead>
                        <TableHead className="text-right">Rate/mo</TableHead>
                        <TableHead className="text-right">Months Paid</TableHead>
                        <TableHead className="text-right">Total Earned</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissions.map(c => {
                        const monthsPaid = monthsForCommission(c.id);
                        const monthlyEarned = monthlyEarnedForCommission(c.id);
                        const dealTotal = parseFloat(c.upfrontAmount) + monthlyEarned;
                        return (
                          <TableRow key={c.id} data-testid={`commission-row-${c.id}`}>
                            <TableCell className="font-medium">{c.dealTitle}</TableCell>
                            {isAdmin && <TableCell>{c.salespersonName}</TableCell>}
                            <TableCell>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${planBadgeClass(c.planName)}`}>{c.planName}</span>
                            </TableCell>
                            <TableCell>{c.confirmedAt ? format(new Date(c.confirmedAt), "MMM d, yyyy") : "—"}</TableCell>
                            <TableCell className="text-right font-semibold text-green-600">{fmtAmt(c.upfrontAmount)}</TableCell>
                            <TableCell className="text-right text-blue-600">{fmtAmt(c.monthlyAmount)}/mo</TableCell>
                            <TableCell className="text-right text-muted-foreground">{monthsPaid}</TableCell>
                            <TableCell className="text-right font-bold">{fmtAmt(dealTotal)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No commissions yet</h3>
                  <p className="text-muted-foreground">Mark deals as Won and confirm the plan to see commissions here.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Payroll Tab ──────────────────────────────────────────────── */}
          <TabsContent value="payroll" className="space-y-6">

            {/* Admin: Generate Pay Period */}
            {isAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Generate Pay Period</CardTitle>
                  <p className="text-sm text-muted-foreground">Select an employee and date range to preview earnings for that period.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1">
                      <Label htmlFor="emp-select">Employee</Label>
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger id="emp-select" data-testid="select-payroll-employee">
                          <SelectValue placeholder="Select employee…" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminUsers?.filter(u => u.role === "salesperson").map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="start-date">Start Date</Label>
                      <Input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-payroll-start" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="end-date">End Date</Label>
                      <Input id="end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-payroll-end" />
                    </div>
                    <Button onClick={handleGenerate} disabled={isGenerating} data-testid="button-generate-preview" className="w-full">
                      {isGenerating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : <><Search className="h-4 w-4 mr-2" />Generate Preview</>}
                    </Button>
                  </div>

                  {/* Preview Table */}
                  {previewItems !== null && (
                    <div className="space-y-4 pt-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm">
                          Preview — {selectedEmployee ? [selectedEmployee.firstName, selectedEmployee.lastName].filter(Boolean).join(" ") || selectedEmployee.email : ""}{" "}
                          {startDate && endDate ? `(${format(new Date(startDate + "T00:00:00"), "MMM d")} – ${format(new Date(endDate + "T00:00:00"), "MMM d, yyyy")})` : ""}
                        </h3>
                        <Badge variant="outline">{previewItems.length} item{previewItems.length !== 1 ? "s" : ""}</Badge>
                      </div>

                      {previewItems.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border rounded-lg">
                          No commission earnings found for this date range.
                        </div>
                      ) : (
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/30">
                                <TableHead>Date</TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead>Deal</TableHead>
                                <TableHead>Plan</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Orig. Amount</TableHead>
                                <TableHead className="text-right">Pay Amount</TableHead>
                                <TableHead>Line Notes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {previewItems.map(item => (
                                <TableRow key={item.tempId}>
                                  <TableCell className="text-sm whitespace-nowrap">{format(new Date(item.date), "MMM d, yyyy")}</TableCell>
                                  <TableCell className="text-sm font-medium">{item.contactName}</TableCell>
                                  <TableCell className="text-sm">{item.dealTitle}</TableCell>
                                  <TableCell className="text-sm">
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${planBadgeClass(item.planName)}`}>{item.planName}</span>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={item.type === "upfront" ? "default" : "secondary"} className={item.type === "upfront" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"}>
                                      {item.type === "upfront" ? "New Sale" : "Recurring"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground text-sm">{fmtAmt(item.originalAmount)}</TableCell>
                                  <TableCell className="text-right">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="w-24 h-7 text-sm text-right ml-auto"
                                      value={adjustments[item.tempId] ?? item.originalAmount}
                                      onChange={e => setAdjustments(prev => ({ ...prev, [item.tempId]: e.target.value }))}
                                      data-testid={`input-amount-${item.tempId}`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      className="h-7 text-sm min-w-[120px]"
                                      placeholder="Optional note…"
                                      value={itemNotes[item.tempId] ?? ""}
                                      onChange={e => setItemNotes(prev => ({ ...prev, [item.tempId]: e.target.value }))}
                                      data-testid={`input-note-${item.tempId}`}
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="flex items-center justify-end gap-2 px-4 py-3 bg-muted/20 border-t font-semibold text-sm">
                            <span className="text-muted-foreground">Total Pay for Period:</span>
                            <span className="text-green-600 text-base">{fmtAmt(previewTotal)}</span>
                          </div>
                        </div>
                      )}

                      {previewItems.length > 0 && (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label>Period Notes (optional)</Label>
                            <Textarea
                              placeholder="Add any notes for this pay period…"
                              value={periodNotes}
                              onChange={e => setPeriodNotes(e.target.value)}
                              className="h-20"
                              data-testid="textarea-period-notes"
                            />
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              onClick={() => saveMutation.mutate()}
                              disabled={saveMutation.isPending}
                              data-testid="button-save-draft"
                            >
                              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                              Save Draft
                            </Button>
                            <Button
                              onClick={async () => {
                                if (!savedPeriodId) {
                                  await saveMutation.mutateAsync();
                                }
                                setIsSendDialogOpen(true);
                              }}
                              disabled={saveMutation.isPending}
                              data-testid="button-save-and-email"
                            >
                              <Send className="h-4 w-4 mr-2" />
                              Save &amp; Email
                            </Button>
                            {savedPeriodId && (
                              <Button variant="ghost" onClick={() => navigate(`/payroll/${savedPeriodId}`)} data-testid="button-view-saved">
                                <Eye className="h-4 w-4 mr-2" /> View Full Detail
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pay Period History */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> {isAdmin ? "Pay Period History" : "My Pay Periods"}</CardTitle>
              </CardHeader>
              <CardContent>
                {payrollHistory && payrollHistory.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pay Period</TableHead>
                        {isAdmin && <TableHead>Employee</TableHead>}
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent To</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollHistory.map(period => (
                        <TableRow key={period.id} data-testid={`payroll-row-${period.id}`}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {format(new Date(period.startDate), "MMM d")} – {format(new Date(period.endDate), "MMM d, yyyy")}
                          </TableCell>
                          {isAdmin && <TableCell>{period.salespersonName}</TableCell>}
                          <TableCell className="text-right font-semibold text-green-600">{fmtAmt(period.totalAmount)}</TableCell>
                          <TableCell>
                            <Badge variant={period.status === "sent" ? "default" : "secondary"} className={period.status === "sent" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}>
                              {period.status === "sent" ? "Sent" : "Draft"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{period.sentToEmails || "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/payroll/${period.id}`)} data-testid={`button-view-period-${period.id}`}>
                                <Eye className="h-3.5 w-3.5 mr-1" /> View
                              </Button>
                              {isAdmin && (
                                <Button size="sm" variant="ghost" onClick={() => { setSavedPeriodId(period.id); setIsSendDialogOpen(true); }} data-testid={`button-email-period-${period.id}`}>
                                  <Send className="h-3.5 w-3.5 mr-1" /> {period.status === "sent" ? "Resend" : "Send"}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-10 text-muted-foreground">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No pay periods yet</p>
                    {isAdmin && <p className="text-sm mt-1">Use the form above to generate the first pay period.</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Email Send Dialog ─────────────────────────────────────────────── */}
      <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Pay Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              The pay statement will be emailed to the salesperson{selectedEmployee ? ` (${selectedEmployee.email})` : ""}. Add additional recipients below (e.g., a bookkeeper).
            </p>
            <div className="space-y-1">
              <Label>Additional Email Address (optional)</Label>
              <Input
                type="email"
                placeholder="bookkeeper@company.com"
                value={bookkeeperEmail}
                onChange={e => setBookkeeperEmail(e.target.value)}
                data-testid="input-bookkeeper-email"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsSendDialogOpen(false)}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button
              onClick={() => { if (savedPeriodId) sendMutation.mutate(savedPeriodId); }}
              disabled={sendMutation.isPending || !savedPeriodId}
              data-testid="button-confirm-send"
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
