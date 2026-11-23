import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { insertDealSchema, type Deal, type InsertDeal, type Contact } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { getContactDisplay } from "@/lib/contact-display";
import { ToastAction } from "@/components/ui/toast";
import { useLocation } from "wouter";
import { useDealPlans } from "@/hooks/useDealPlans";
import { DEAL_STAGES } from "@shared/dealStages";

interface DealFormProps {
  deal?: Deal;
  initialContact?: Contact;
  onSuccess: () => void | Promise<void>;
  onCancel: () => void;
  onPendingChange?: (isPending: boolean) => void;
}

export default function DealForm({ deal, initialContact, onSuccess, onCancel, onPendingChange }: DealFormProps) {
  const { toast } = useToast();
  const dealPlanList = useDealPlans();
  const [, setLocation] = useLocation();
  
  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });
  const { data: deals } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    enabled: !deal,
  });
  const availableContacts = contacts ?? [];
  const contactOptions = initialContact && !availableContacts.some(contact => contact.id === initialContact.id)
    ? [...availableContacts, initialContact]
    : availableContacts;

  const form = useForm<InsertDeal>({
    resolver: zodResolver(insertDealSchema),
    defaultValues: {
      title: deal?.title || (initialContact ? initialContact.company || getContactDisplay(initialContact).name : ""),
      contactId: deal?.contactId || initialContact?.id || "",
      value: deal?.value || "",
      plan: deal?.plan || "",
      stage: deal?.stage || "new_lead_unqualified",
      probability: deal?.probability || 0,
      expectedCloseDate: deal?.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().split('T')[0] : "",
      demoScheduledDate: deal?.demoScheduledDate ? new Date(deal.demoScheduledDate).toISOString().slice(0, 16) : "",
      demoCompletedDate: deal?.demoCompletedDate ? new Date(deal.demoCompletedDate).toISOString().split('T')[0] : "",
      wonDate: deal?.wonDate ? new Date(deal.wonDate).toISOString().split('T')[0] : "",
      description: deal?.description || "",
    },
  });

  const selectedStage = form.watch("stage");
  const selectedContactId = form.watch("contactId");
  const selectedContact = contactOptions.find(contact => contact.id === selectedContactId);
  const selectedContactDeals = selectedContactId
    ? (deals ?? []).filter(existingDeal => existingDeal.contactId === selectedContactId)
    : [];
  const previousStageRef = useRef(selectedStage);

  // Clear conditional date fields only when stage actually changes during this edit session
  useEffect(() => {
    const previousStage = previousStageRef.current;
    
    // Only clear if stage changed from the triggering stage to a different stage
    if (previousStage === "demo_scheduled" && selectedStage !== "demo_scheduled") {
      form.setValue("demoScheduledDate", "");
    }
    if (previousStage === "demo_completed" && selectedStage !== "demo_completed") {
      form.setValue("demoCompletedDate", "");
    }
    if (previousStage === "won" && selectedStage !== "won") {
      form.setValue("wonDate", "");
    }
    
    // Update the ref for next comparison
    previousStageRef.current = selectedStage;
  }, [selectedStage, form]);

  const mutation = useMutation({
    mutationFn: async (data: InsertDeal) => {
      // Convert date fields to proper format
      const formData = {
        ...data,
        expectedCloseDate: data.expectedCloseDate && data.expectedCloseDate.trim() ? new Date(data.expectedCloseDate).toISOString() : null,
        demoScheduledDate: data.demoScheduledDate && data.demoScheduledDate.trim() ? new Date(data.demoScheduledDate).toISOString() : null,
        demoCompletedDate: data.demoCompletedDate && data.demoCompletedDate.trim() ? new Date(data.demoCompletedDate).toISOString() : null,
        wonDate: data.wonDate && data.wonDate.trim() ? new Date(data.wonDate).toISOString() : null,
      };

      if (deal) {
        return apiRequest("PUT", `/api/deals/${deal.id}`, formData);
      } else {
        return apiRequest("POST", "/api/deals", formData);
      }
    },
    onSuccess: async () => {
      await onSuccess();
      toast({
        title: deal ? "Deal updated" : "Deal created",
        description: `${form.getValues("title")} has been ${deal ? "updated" : "added"} successfully.`,
        ...(!deal && initialContact ? {
          action: (
            <ToastAction altText="View Pipeline" onClick={() => setLocation("/deals")}>
              View Pipeline
            </ToastAction>
          ),
        } : {}),
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${deal ? "update" : "create"} deal`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertDeal) => {
    if (mutation.isPending) return;
    onPendingChange?.(true);
    mutation.mutate(data);
  };

  useEffect(() => {
    onPendingChange?.(mutation.isPending);
  }, [mutation.isPending, onPendingChange]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="deal-form">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Deal Title</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="Acme Corp Website Redesign"
                  data-testid="input-title"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="contactId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value || ""}
                  disabled={!!initialContact || mutation.isPending}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-contact">
                      <SelectValue placeholder="Select a contact" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {contactOptions.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {getContactDisplay(contact).name} - {contact.company || "No company"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="plan"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deal Plan</FormLabel>
                <Select 
                  onValueChange={(value) => {
                    field.onChange(value);
                    const price = dealPlanList.priceFor(value);
                    if (price != null) form.setValue("value", String(price));
                  }} 
                  defaultValue={field.value || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-plan">
                      <SelectValue placeholder="Select a plan" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {dealPlanList.choices(field.value).map(plan => (
                      <SelectItem key={plan} value={plan}>{plan}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {!deal && selectedContact && selectedContactDeals.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground" role="status" data-testid="warning-contact-existing-deals">
            <p className="font-medium">{getContactDisplay(selectedContact).name} already has {selectedContactDeals.length} {selectedContactDeals.length === 1 ? "deal" : "deals"}.</p>
            <p className="mt-0.5 text-muted-foreground">You can still create another opportunity if it represents a separate sale.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pipeline Stage</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-stage">
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DEAL_STAGES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="probability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Probability (%)</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value?.toString() || ""}
                    type="number"
                    min="0"
                    max="100"
                    placeholder="75"
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    data-testid="input-probability"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="expectedCloseDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expected Close Date</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  value={field.value || ""}
                  type="date"
                  data-testid="input-expectedCloseDate"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {selectedStage === "demo_scheduled" && (
          <FormField
            control={form.control}
            name="demoScheduledDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Demo Scheduled Date & Time</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="datetime-local"
                    data-testid="input-demoScheduledDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {selectedStage === "demo_completed" && (
          <FormField
            control={form.control}
            name="demoCompletedDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Demo Completed Date</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="date"
                    data-testid="input-demoCompletedDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {selectedStage === "won" && (
          <FormField
            control={form.control}
            name="wonDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Won Date</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    value={field.value || ""}
                    type="date"
                    data-testid="input-wonDate"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  value={field.value || ""}
                  placeholder="Additional details about this deal..."
                  className="min-h-[100px]"
                  data-testid="textarea-description"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-3">
          {mutation.isError && (
            <p className="mr-auto self-center text-sm text-destructive" role="alert" data-testid="deal-submit-error">
              {mutation.error instanceof Error ? mutation.error.message : `Failed to ${deal ? "update" : "create"} deal. Please try again.`}
            </p>
          )}
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            disabled={mutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={mutation.isPending || (!!initialContact && !!initialContact.archivedAt)}
            data-testid="button-submit"
          >
            {mutation.isPending ? "Saving..." : deal ? "Update Deal" : "Create Deal"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
