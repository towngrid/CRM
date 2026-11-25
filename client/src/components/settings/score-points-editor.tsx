// Settings → Opportunity score: every point value in one editable list (admin only).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DEFAULT_SCORE_POINTS, SCORE_GROUP_LABELS, type ScoreGroup, type ScorePoint } from "@shared/leadScore";

function errorText(error: unknown): string {
  const raw = String((error as Error)?.message ?? error).replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(raw).message ?? raw; } catch { return raw; }
}

export function ScorePointsEditor() {
  const { toast } = useToast();
  const { data } = useQuery<ScorePoint[]>({ queryKey: ["/api/score-points"] });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.map(p => [p.key, String(p.points)])));
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: Record<string, number>) => (await apiRequest("PUT", "/api/admin/score-points", { values: next })).json(),
    onSuccess: () => {
      toast({ title: "Saved", description: "Every business has been re-scored with the new values (no searches used)." });
      queryClient.invalidateQueries({ queryKey: ["/api/score-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-search"] });
    },
    onError: e => toast({ title: "Not saved", description: errorText(e), variant: "destructive" }),
  });

  const submit = (next: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(next)) {
      const n = Number(v);
      if (v.trim() === "" || !Number.isInteger(n)) {
        toast({ title: "Check the numbers", description: "Every value must be a whole number.", variant: "destructive" });
        return;
      }
      out[k] = n;
    }
    save.mutate(out);
  };

  const groups = Object.keys(SCORE_GROUP_LABELS) as ScoreGroup[];
  const points = data ?? [];

  return (
    <Card data-testid="card-score-points">
      <CardHeader>
        <CardTitle>Opportunity score</CardTitle>
        <CardDescription>
          Points a business gets for each thing TownGrid could fix or sell it, plus signs it's alive and able to pay.
          Higher = better sales opportunity. Saving re-scores every business right away; it uses no searches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map(group => (
          <div key={group} className="space-y-2">
            <h4 className="text-sm font-semibold">{SCORE_GROUP_LABELS[group]}</h4>
            {points.filter(p => p.group === group).map(p => (
              <div key={p.key} className="flex items-center gap-3">
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="numeric"
                  value={values[p.key] ?? ""}
                  onChange={e => setValues({ ...values, [p.key]: e.target.value.replace(/[^\d-]/g, "") })}
                  aria-label={p.label}
                  data-testid={`input-points-${p.key}`}
                />
                <span className="flex-1 text-sm">{p.label}</span>
                {p.source !== "Pass 1" && p.source !== "Tier" && <Badge variant="outline" className="text-xs">{p.source}</Badge>}
              </div>
            ))}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          "Pass 2" lines count once the Google profile check runs (coming in step 3c). "Hand check" lines count from what you enter on a business.
          Businesses that are closed, part of a chain, or that you set aside get no score.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => submit(values)} disabled={save.isPending || !data} data-testid="button-save-points">Save</Button>
          <Button variant="outline" disabled={save.isPending}
            onClick={() => { const d = Object.fromEntries(DEFAULT_SCORE_POINTS.map(p => [p.key, String(p.points)])); setValues(d); submit(d); }}>
            Back to starting values
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
