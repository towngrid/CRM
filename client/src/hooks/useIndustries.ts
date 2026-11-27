import { useQuery } from "@tanstack/react-query";
import { industryGroups, type IndustryRow } from "@shared/industries";

export type IndustryRecord = IndustryRow & { id: string; active: boolean; sortOrder: number };

/** The editable Industry list (Settings → Industries). Hidden industries are left out. */
export function useIndustries() {
  const { data: industries = [], isLoading } = useQuery<IndustryRecord[]>({ queryKey: ["/api/industries"] });
  return {
    industries,
    isLoading,
    groups: industryGroups(industries),
    typesFor: (group: string | null | undefined) => industries.filter(i => i.group === group).map(i => i.type),
  };
}
