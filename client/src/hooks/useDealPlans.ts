import { useQuery } from "@tanstack/react-query";
import { planChoices, planPriceForLabel, type DealPlanRecord } from "@shared/dealPlans";

/** The editable TownGrid plan list (Settings → Plans & prices). */
export function useDealPlans() {
  const { data: plans = [], isLoading } = useQuery<DealPlanRecord[]>({ queryKey: ["/api/deal-plans"] });
  return {
    plans,
    isLoading,
    /** Labels for a plan picker; pass the deal's current plan so an old label stays selectable. */
    choices: (current?: string | null) => planChoices(plans, current),
    priceFor: (label: string) => planPriceForLabel(plans, label),
  };
}
