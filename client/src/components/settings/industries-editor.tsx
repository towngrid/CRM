// Settings → Industries: one editable list of groups and types (admin only), next to Plans & prices.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { IndustryRecord } from "@/hooks/useIndustries";

type Row = { group: string; type: string; searchType: string | null; active: boolean };

function errorText(error: unknown): string {
  const raw = String((error as Error)?.message ?? error).replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(raw).message ?? raw; } catch { return raw; }
}

export function IndustriesEditor() {
  const { toast } = useToast();
  const { data } = useQuery<IndustryRecord[]>({ queryKey: ["/api/industries?all=1"] });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (data) setRows(data.map(r => ({ group: r.group, type: r.type, searchType: r.searchType ?? null, active: r.active })));
  }, [data]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/admin/industries", { industries: rows })).json(),
    onSuccess: () => {
      toast({ title: "Industries saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/industries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/industries?all=1"] });
    },
    onError: e => toast({ title: "Not saved", description: errorText(e), variant: "destructive" }),
  });

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  return (
    <Card data-testid="card-industries">
      <CardHeader>
        <CardTitle>Industries</CardTitle>
        <CardDescription>
          The Industry list used on businesses, contacts and the Pipeline filter. Each line is a group and a type of business.
          Untick "Shown" to hide one without losing it on records that already use it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="hidden grid-cols-[1fr_1fr_70px_96px] gap-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Group</span><span>Type of business</span><span>Shown</span><span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 items-center gap-2 border-b pb-2 md:grid-cols-[1fr_1fr_70px_96px] md:border-0 md:pb-0">
            <Input className="h-8" value={r.group} onChange={e => set(i, { group: e.target.value })} aria-label="Group" />
            <Input className="h-8" value={r.type} onChange={e => set(i, { type: e.target.value })} aria-label="Type of business" />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={r.active} onCheckedChange={v => set(i, { active: v === true })} /> <span className="md:hidden">Shown</span></label>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setRows([...rows, { group: rows[rows.length - 1]?.group ?? "", type: "", searchType: null, active: true }])}>
            <Plus className="mr-2 h-4 w-4" />Add an industry
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !data} data-testid="button-save-industries">Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}
