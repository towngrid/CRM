// One Industry filter for Business Search, Contacts and Pipeline: "all", a whole group, or one type.
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { industryGroups, type IndustryRow } from "@shared/industries";

/** value: "all" | "none" | "g:<group>" | "t:<group>|<type>" */
export function matchesIndustry(value: string, group: string | null | undefined, type: string | null | undefined): boolean {
  if (value === "all") return true;
  if (value === "none") return !group && !type;
  if (value.startsWith("g:")) return group === value.slice(2);
  if (value.startsWith("t:")) {
    const [g, t] = value.slice(2).split("|");
    return group === g && type === t;
  }
  return true;
}

export function IndustryFilterSelect({ value, onChange, industries, className }: {
  value: string; onChange: (v: string) => void; industries: readonly IndustryRow[]; className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "w-64 bg-background"} data-testid="filter-industry"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All industries</SelectItem>
        {industryGroups(industries).map(g => (
          <SelectGroup key={g}>
            <SelectLabel>{g}</SelectLabel>
            <SelectItem value={`g:${g}`}>All {g}</SelectItem>
            {industries.filter(i => i.group === g).map(i => (
              <SelectItem key={`${g}|${i.type}`} value={`t:${g}|${i.type}`}>{i.type}</SelectItem>
            ))}
          </SelectGroup>
        ))}
        <SelectItem value="none">No industry yet</SelectItem>
      </SelectContent>
    </Select>
  );
}
