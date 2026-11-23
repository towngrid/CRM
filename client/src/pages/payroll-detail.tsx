import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer, Download, Send, Loader2, X, User, Calendar, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

function fmtAmt(val: string | number) {
  return `$${parseFloat(String(val)).toFixed(2)}`;
}

function planBadgeClass(planName: string) {
  return planName ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700";
}

function exportCSV(period: PayrollPeriodFull) {
  const startFmt = format(new Date(period.startDate), "MMM d, yyyy");
  const endFmt = format(new Date(period.endDate), "MMM d, yyyy");

  const rows = [
    ["Commission Pay Statement"],
    ["Employee", period.salespersonName],
    ["Pay Period", `${startFmt} – ${endFmt}`],
    ["Generated", format(new Date(), "MMM d, yyyy")],
    [],
    ["Date", "Contact", "Deal", "Plan", "Type", "Original Amount", "Pay Amount", "Notes"],
    ...period.items.map(item => [
      format(new Date(item.date), "MMM d, yyyy"),
      item.contactName,
      item.dealTitle,
      item.planName,
      item.type === "upfront" ? "New Sale" : "Recurring",
      parseFloat(item.originalAmount).toFixed(2),
      parseFloat(item.adjustedAmount).toFixed(2),
      item.notes || "",
    ]),
    [],
    ["", "", "", "", "", "Total Pay:", parseFloat(period.totalAmount).toFixed(2), ""],
    ...(period.notes ? [[], ["Notes:", period.notes]] : []),
  ];

  const csv = rows.map(row =>
    row.map(cell => {
      const s = String(cell);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-${period.salespersonName.replace(/\s+/g, "-")}-${format(new Date(period.startDate), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = (user as any)?.role === "admin";

  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [additionalEmail, setAdditionalEmail] = useState("");

  const { data: period, isLoading, isError } = useQuery<PayrollPeriodFull>({
    queryKey: ["/api/payroll", id],
    queryFn: () => fetch(`/api/payroll/${id}`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!id,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const extras = additionalEmail ? [additionalEmail] : [];
      const resp = await apiRequest("POST", `/api/payroll/${id}/send`, { additionalEmails: extras });
      return await resp.json();
    },
    onSuccess: (data) => {
      toast({ title: "Email sent", description: `Sent to ${data.sentTo}` });
      setIsSendDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/payroll", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });
    },
    onError: () => toast({ title: "Failed to send email", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !period) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Pay period not found.</p>
          <Button variant="outline" onClick={() => navigate("/commissions")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Commissions
          </Button>
        </div>
      </div>
    );
  }

  const startFmt = format(new Date(period.startDate), "MMM d, yyyy");
  const endFmt = format(new Date(period.endDate), "MMM d, yyyy");
  const periodLabel = `${startFmt} – ${endFmt}`;

  const upfrontItems = period.items.filter(i => i.type === "upfront");
  const recurringItems = period.items.filter(i => i.type === "recurring");
  const upfrontTotal = upfrontItems.reduce((s, i) => s + parseFloat(i.adjustedAmount), 0);
  const recurringTotal = recurringItems.reduce((s, i) => s + parseFloat(i.adjustedAmount), 0);

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      {/* Toolbar — hidden when printing */}
      <div className="no-print bg-background border-b px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/commissions")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="h-4 border-l" />
          <h1 className="font-semibold text-sm">Pay Statement — {period.salespersonName} — {periodLabel}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(period)} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print">
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setIsSendDialogOpen(true)} data-testid="button-send-email">
              <Send className="h-4 w-4 mr-2" /> {period.status === "sent" ? "Resend" : "Send"} Email
            </Button>
          )}
        </div>
      </div>

      {/* ── Printable Content ─────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto p-6 space-y-6 print-area">
        {/* Header */}
        <div className="print:block">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Commission Pay Statement</h2>
              <p className="text-muted-foreground mt-1">{periodLabel}</p>
            </div>
            <Badge variant={period.status === "sent" ? "default" : "secondary"} className={`no-print text-sm px-3 py-1 ${period.status === "sent" ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}`}>
              {period.status === "sent" ? "Sent" : "Draft"}
            </Badge>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-full">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Employee</p>
                  <p className="font-semibold text-sm">{period.salespersonName}</p>
                  <p className="text-xs text-muted-foreground">{period.salespersonEmail}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-full">
                  <Calendar className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pay Period</p>
                  <p className="font-semibold text-sm">{periodLabel}</p>
                  {period.sentAt && (
                    <p className="text-xs text-muted-foreground">Sent {format(new Date(period.sentAt), "MMM d, yyyy")}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-full">
                  <DollarSign className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Pay</p>
                  <p className="font-bold text-lg text-green-600">{fmtAmt(period.totalAmount)}</p>
                  <p className="text-xs text-muted-foreground">{period.items.length} line item{period.items.length !== 1 ? "s" : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Breakdown Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">New Sales (Upfront)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{upfrontItems.length} deal{upfrontItems.length !== 1 ? "s" : ""} won this period</p>
                </div>
                <p className="text-xl font-bold text-green-600">{fmtAmt(upfrontTotal)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Recurring (10% Monthly)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{recurringItems.length} recurring payment{recurringItems.length !== 1 ? "s" : ""}</p>
                </div>
                <p className="text-xl font-bold text-blue-600">{fmtAmt(recurringTotal)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Full Line Items Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Earnings Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Date</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Deal</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Pay Amount</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {period.items.map(item => {
                  const adj = parseFloat(item.adjustedAmount);
                  const orig = parseFloat(item.originalAmount);
                  const wasAdjusted = Math.abs(adj - orig) > 0.001;
                  return (
                    <TableRow key={item.id} data-testid={`item-row-${item.id}`}>
                      <TableCell className="text-sm whitespace-nowrap">{format(new Date(item.date), "MMM d, yyyy")}</TableCell>
                      <TableCell className="font-medium text-sm">{item.contactName}</TableCell>
                      <TableCell className="text-sm">{item.dealTitle}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${planBadgeClass(item.planName)}`}>{item.planName}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${item.type === "upfront" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"}`}>
                          {item.type === "upfront" ? "New Sale" : "Recurring"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {wasAdjusted ? <span className="line-through">{fmtAmt(orig)}</span> : fmtAmt(orig)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-sm">
                        {fmtAmt(adj)}
                        {wasAdjusted && <span className="ml-1 text-xs text-amber-600">(adj)</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.notes || ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Total Row */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t">
              <span className="font-semibold text-sm">Total Pay for Period</span>
              <span className="font-bold text-lg text-green-600">{fmtAmt(period.totalAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        {period.notes && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-1">Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{period.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer — shown on print */}
        <div className="print:block hidden text-center text-xs text-muted-foreground pt-4 border-t">
          Generated by TownGrid CRM • {format(new Date(), "MMMM d, yyyy")}
        </div>
      </div>

      {/* ── Send Email Dialog ──────────────────────────────────────────────── */}
      <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{period.status === "sent" ? "Resend" : "Send"} Pay Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This pay statement will be emailed to <strong>{period.salespersonEmail}</strong>.
              Add an additional recipient below (e.g., your bookkeeper).
            </p>
            <div className="space-y-1">
              <Label>Additional Email (optional)</Label>
              <Input
                type="email"
                placeholder="bookkeeper@company.com"
                value={additionalEmail}
                onChange={e => setAdditionalEmail(e.target.value)}
                data-testid="input-additional-email"
              />
            </div>
            {period.sentToEmails && (
              <p className="text-xs text-muted-foreground">Previously sent to: {period.sentToEmails}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsSendDialogOpen(false)}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} data-testid="button-confirm-send">
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
