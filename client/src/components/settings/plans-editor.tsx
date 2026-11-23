import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDealPlans } from "@/hooks/useDealPlans";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { planLabel, type DealPlanInput } from "@shared/dealPlans";

type Draft = DealPlanInput & { key: string; priceText: string };

let nextKey = 0;
const toDraft = (p: DealPlanInput): Draft => ({
  ...p,
  note: p.note ?? "",
  key: `k${nextKey++}`,
  priceText: p.price == null ? "" : String(p.price),
});

export function PlansEditor() {
  const { toast } = useToast();
  const { plans, isLoading } = useDealPlans();
  const [rows, setRows] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setRows(plans.map(toDraft));
  }, [plans, dirty]);

  const update = (key: string, change: Partial<Draft>) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...change } : r)));
    setDirty(true);
  };
  const move = (index: number, by: number) => {
    setRows(rs => {
      const next = [...rs];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = rows.map(r => ({
        name: r.name,
        price: r.billing === "none" || r.priceText.trim() === "" ? null : Number(r.priceText),
        billing: r.billing,
        kind: r.kind,
        note: r.note || null,
        active: r.active,
      }));
      if (payload.some(p => p.price != null && (Number.isNaN(p.price) || p.price < 0))) {
        throw new Error("Prices must be numbers, like 129 or 49.50");
      }
      const res = await apiRequest("PUT", "/api/admin/deal-plans", { plans: payload });
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/deal-plans"] });
      toast({ title: "Plans saved", description: "New deals will use these names and prices." });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message.replace(/^\d+: /, ""), variant: "destructive" }),
  });

  return (
    <Card data-testid="card-plans">
      <CardHeader>
        <CardTitle>Plans &amp; prices</CardTitle>
        <CardDescription>
          The choices in every deal's plan picker. Changing a price here doesn't change deals already saved.
          Switch a plan off to hide it from new deals without deleting it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[1fr_90px_120px_110px_1fr_60px_96px] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Name</span><span>Price ($)</span><span>Billing</span><span>Type</span><span>Note</span><span>On</span><span />
            </div>
            {rows.map((r, i) => (
              <div key={r.key} className="grid grid-cols-2 md:grid-cols-[1fr_90px_120px_110px_1fr_60px_96px] gap-2 items-center border-b pb-2 md:border-0 md:pb-0" data-testid={`row-plan-${i}`}>
                <Input value={r.name} onChange={e => update(r.key, { name: e.target.value })} placeholder="Plan name" className="col-span-2 md:col-span-1" />
                <Input value={r.priceText} disabled={r.billing === "none"} inputMode="decimal"
                  onChange={e => update(r.key, { priceText: e.target.value.replace(/[^\d.]/g, "") })} placeholder="—" />
                <Select value={r.billing} onValueChange={v => update(r.key, { billing: v as Draft["billing"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Per month</SelectItem>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="none">No price</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={r.kind} onValueChange={v => update(r.key, { kind: v as Draft["kind"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plan">Plan</SelectItem>
                    <SelectItem value="add_on">Add-on</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={r.note ?? ""} onChange={e => update(r.key, { note: e.target.value })} placeholder="Note (optional)" />
                <Switch checked={r.active} onCheckedChange={v => update(r.key, { active: v })} aria-label="Show in plan pickers" />
                <div className="flex gap-1 justify-end">
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setRows(rs => rs.filter(x => x.key !== r.key)); setDirty(true); }} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <p className="col-span-2 md:col-span-7 text-xs text-muted-foreground px-1">
                  Shows as: {planLabel({ ...r, price: r.billing === "none" || r.priceText === "" ? null : Number(r.priceText) }) || "—"}
                </p>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setRows(rs => [...rs, toDraft({ name: "", price: null, billing: "monthly", kind: "plan", active: true })]); setDirty(true); }} data-testid="button-add-plan">
                <Plus className="mr-1 h-4 w-4" /> Add a plan
              </Button>
              <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-save-plans">
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save plans
              </Button>
              {dirty && (
                <Button type="button" variant="ghost" onClick={() => { setDirty(false); setRows(plans.map(toDraft)); }}>Undo changes</Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
